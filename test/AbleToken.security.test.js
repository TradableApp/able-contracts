const fs = require("node:fs/promises");
const path = require("node:path");
const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const hre = require("hardhat");
const { ethers, upgrades } = hre;
const {
  assertStorageUpgradeSafe,
  getStorageLayout,
  getVersion,
} = require("@openzeppelin/upgrades-core");
// Deep import, verified against @openzeppelin/hardhat-upgrades@3.9.1 — dist/ is internal and
// carries no semver guarantee, so recheck on a plugin bump. A move or a rename aborts here with a
// named failure; a changed signature is caught by compiledLayout below.
const VALIDATIONS_PATH = "@openzeppelin/hardhat-upgrades/dist/utils/validations";

let readValidations;
let importFailure;
try {
  ({ readValidations } = require(VALIDATIONS_PATH));
} catch (error) {
  importFailure = error;
}

/**
 * Both plugin-API guards, in a before() hook rather than at module load: throwing at load would
 * abort the whole hardhat run and take every other test file down with it.
 */
function assertPluginApiIntact() {
  if (importFailure) {
    throw new Error(
      `Cannot load ${VALIDATIONS_PATH}. The plugin has been restructured; find where ` +
        "readValidations moved to before the storage checks can run.",
      { cause: importFailure },
    );
  }

  if (typeof readValidations !== "function") {
    const exported = Object.keys(require(VALIDATIONS_PATH)).sort().join(", ");
    throw new Error(
      `${VALIDATIONS_PATH} loaded but does not export a readValidations function. ` +
        `It was renamed or withdrawn, not moved. Available exports: ${exported}. ` +
        "Find its replacement before trusting the storage checks below.",
    );
  }
}

// The manifest OpenZeppelin wrote for Base mainnet — the same artifact upgradeProxy reads, so it
// is the authoritative record of what is deployed.
const BASE_MANIFEST = require("../.openzeppelin/base.json");
const LIVE_PROXY = "0xD77FF82e661C3838a59ea78bbF31F8c4c2BD8A80";

const ABLE_TOKEN_NAMESPACE = "erc7201:openzeppelin.storage.AbleToken";

// Bounds for the initialize() source slice asserted below. Kept as constants so the uniqueness
// check and the slice cannot drift apart.
const START_ANCHOR = "  ) public initializer {";
const END_ANCHOR = "    _mint(_initialOwner, _initialSupply);";

/**
 * Every AbleToken implementation the manifest records on Base.
 *
 * The v3.2 manifest stores no proxy -> implementation reference, so validate against ALL of them
 * rather than pinning one by hand. Equivalent in the good case and stricter in the bad one: where
 * an upgrade skipped the storage check, an older baseline catches what the newest waves through.
 * Selected by this token's namespace, so a foreign layout cannot enter the comparison.
 */
function deployedLayouts() {
  const proxy = BASE_MANIFEST.proxies.find(
    (p) => p.address.toLowerCase() === LIVE_PROXY.toLowerCase(),
  );
  if (!proxy) {
    throw new Error(
      `.openzeppelin/base.json does not describe proxy ${LIVE_PROXY}. ` +
        "This test compares against the live token; it cannot run against another manifest.",
    );
  }

  const layouts = Object.values(BASE_MANIFEST.impls)
    .filter((impl) => Object.keys(impl.layout?.namespaces || {}).includes(ABLE_TOKEN_NAMESPACE))
    .map((impl) => ({ address: impl.address, layout: impl.layout }));

  if (layouts.length === 0) {
    throw new Error(
      `No implementation in .openzeppelin/base.json declares ${ABLE_TOKEN_NAMESPACE}. ` +
        "Either the manifest is for a different project, or the namespace was dropped from a " +
        "deployed implementation — both mean this check is no longer proving anything.",
    );
  }

  return layouts;
}

/**
 * The storage layout the current sources compile to, sanity-checked rather than trusted: a plugin
 * change that kept the name but altered the signature would leave the checks comparing nothing.
 */
async function compiledLayout(contractName) {
  const validations = await readValidations(hre);
  const factory = await ethers.getContractFactory(contractName);
  const layout = getStorageLayout(validations, getVersion(factory.bytecode));

  if (!layout || Object.keys(layout.namespaces || {}).length === 0) {
    throw new Error(
      `Compiled layout for ${contractName} has no namespaces. getStorageLayout returned ` +
        "something this test cannot use — most likely @openzeppelin/hardhat-upgrades changed " +
        "the signature of readValidations or getStorageLayout. Do not trust the checks below.",
    );
  }

  // Non-empty is not the same as right: another contract's layout would fail as "Deleted namespace
  // erc7201:...AbleToken" — identical to the message for actually deleting the struct.
  if (!layout.namespaces[ABLE_TOKEN_NAMESPACE]) {
    throw new Error(
      `Compiled layout for ${contractName} does not declare ${ABLE_TOKEN_NAMESPACE}. ` +
        "This is a layout for some other contract — readValidations or getStorageLayout is " +
        "returning the wrong thing. The contract source is not the problem; do not edit it.",
    );
  }

  return layout;
}

const NAME = "ABLE Token";
const SYMBOL = "ABLE";
const SUPPLY = ethers.parseEther("1000000000");

/** The logic contract deployed on its own, exactly as an attacker finds it behind the proxy. */
async function deployImplementationFixture() {
  const [, attacker] = await ethers.getSigners();
  const AbleToken = await ethers.getContractFactory("AbleToken");
  const implementation = await AbleToken.deploy();
  await implementation.waitForDeployment();

  return { implementation, attacker };
}

/** An initialised proxy, for the ownership tests. */
async function deployProxyFixture() {
  const [owner, newOwner, stranger] = await ethers.getSigners();
  const AbleToken = await ethers.getContractFactory("AbleToken");
  const token = await upgrades.deployProxy(
    AbleToken,
    [NAME, SYMBOL, SUPPLY, owner.address],
    { initializer: "initialize", kind: "uups" },
  );
  await token.waitForDeployment();

  return { token, owner, newOwner, stranger };
}

// Security hardening regressions — from the 2026-09-22 cross-repo review.
describe("AbleToken — security hardening", function () {
  before(assertPluginApiIntact);

  describe("implementation contract cannot be taken over", function () {
    it("reverts when initialize() is called directly on the implementation", async function () {
      const { implementation, attacker } = await loadFixture(deployImplementationFixture);

      // Without constructor() { _disableInitializers(); } this SUCCEEDS and hands the
      // attacker ownership of a source-verified, identical-bytecode token at a real
      // address — usable for fake pools and phishing.
      await expect(
        implementation.connect(attacker).initialize(NAME, SYMBOL, SUPPLY, attacker.address),
      ).to.be.revertedWithCustomError(implementation, "InvalidInitialization");
    });

    it("leaves the implementation with no owner and no supply", async function () {
      const { implementation } = await loadFixture(deployImplementationFixture);

      expect(await implementation.owner()).to.equal(ethers.ZeroAddress);
      expect(await implementation.totalSupply()).to.equal(0n);
    });
  });

  describe("ownership transfer is two-step", function () {
    it("does not hand ownership over until the recipient accepts", async function () {
      const { token, owner, newOwner } = await loadFixture(deployProxyFixture);

      await token.connect(owner).transferOwnership(newOwner.address);

      // Single-step Ownable would have already moved it. A mistyped address that can
      // never call acceptOwnership would strand pause() and _authorizeUpgrade forever.
      expect(await token.owner()).to.equal(owner.address);
      expect(await token.pendingOwner()).to.equal(newOwner.address);

      await token.connect(newOwner).acceptOwnership();
      expect(await token.owner()).to.equal(newOwner.address);
    });

    it("does not let a stranger claim a pending transfer", async function () {
      const { token, owner, newOwner, stranger } = await loadFixture(deployProxyFixture);

      await token.connect(owner).transferOwnership(newOwner.address);

      // The pending entry is public, so the propose/accept window is visible to anyone watching.
      await expect(token.connect(stranger).acceptOwnership())
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
        .withArgs(stranger.address);

      expect(await token.owner()).to.equal(owner.address);
      expect(await token.pendingOwner()).to.equal(newOwner.address);
    });
  });

  describe("ownership cannot be abandoned", function () {
    it("reverts renounceOwnership so pause and upgrade authority can never be stranded", async function () {
      const { token, owner } = await loadFixture(deployProxyFixture);

      await expect(
        token.connect(owner).renounceOwnership(),
      ).to.be.revertedWithCustomError(token, "OwnershipCannotBeRenounced");

      expect(await token.owner()).to.equal(owner.address);
    });

    // A documented split, not an accident of modifier ordering: see the @dev note on the function.
    it("tells a non-owner they are unauthorised rather than that renouncing is disabled", async function () {
      const { token, stranger } = await loadFixture(deployProxyFixture);

      await expect(token.connect(stranger).renounceOwnership())
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
        .withArgs(stranger.address);
    });

    // solc suggests `view` on an always-reverting override. Taking it changes the ABI: consumers
    // dispatch on stateMutability, so ethers would route this through eth_call rather than a
    // transaction, and wallets would file it under reads instead of admin writes.
    it("keeps the inherited nonpayable ABI rather than taking solc's view suggestion", async function () {
      const { abi } = await hre.artifacts.readArtifact("AbleToken");
      const fn = abi.find(
        (entry) => entry.type === "function" && entry.name === "renounceOwnership",
      );

      expect(fn, "renounceOwnership missing from the ABI").to.not.equal(undefined);
      expect(fn.stateMutability).to.equal("nonpayable");
    });
  });

  // __Ownable2Step_init() is an empty body in OZ v5, so nothing observable at runtime can assert
  // it — exactly the kind of line a cleanup deletes with nothing to red. Hence a source assertion.
  describe("the Ownable2Step initialiser call is not quietly dropped", function () {
    it("initialize() still calls __Ownable2Step_init()", async function () {
      const source = await fs.readFile(
        path.join(__dirname, "..", "contracts", "AbleToken.sol"),
        "utf8",
      );
      const startIndex = source.indexOf(START_ANCHOR);
      const endIndex = source.indexOf(END_ANCHOR);

      // Both bounds checked before slicing: a missing anchor is -1, and slice(start, -1) would
      // silently widen to most of the file and pass while proving nothing.
      expect(startIndex, "could not locate the start of initialize()").to.be.greaterThan(-1);
      expect(endIndex, "could not locate the end of initialize()").to.be.greaterThan(-1);
      expect(endIndex, "initialize() bounds are inverted").to.be.greaterThan(startIndex);
      expect(
        source.split(END_ANCHOR).length - 1,
        `${END_ANCHOR.trim()} appears more than once — the end anchor is no longer unique`,
      ).to.equal(1);

      const initializeBody = source.slice(startIndex, endIndex);
      expect(initializeBody, "slice escaped initialize()").to.not.contain("function pause()");

      // Line-anchored, not substring: `.contain()` is satisfied by a commented-out call.
      expect(initializeBody, "__Ownable_init call missing or commented out").to.match(
        /^\s*__Ownable_init\(_initialOwner\);/m,
      );
      expect(initializeBody, "__Ownable2Step_init call missing or commented out").to.match(
        /^\s*__Ownable2Step_init\(\);/m,
      );
    });
  });

  // Compared against the deployment MANIFEST, not a copy of the deployed source. A hand-written
  // Solidity baseline was tried first and was silently wrong: __gap was added four months after
  // the deployment with no redeploy, so the copy carried a variable the live code does not have.
  describe("remains a storage-compatible upgrade of the live Base mainnet proxy", function () {
    it("passes OpenZeppelin's storage check against every deployed implementation", async function () {
      const current = await compiledLayout("AbleToken");

      for (const { address, layout } of deployedLayouts()) {
        // Throws with OZ's own diagnosis, naming the offending change. {} is strict mode:
        // do not add unsafeAllow* here to unblock a failure — it means the upgrade is unsafe.
        try {
          assertStorageUpgradeSafe(layout, current, {});
        } catch (error) {
          error.message = `against deployed implementation ${address}:\n${error.message}`;
          throw error;
        }
      }
    });

    it("still declares every storage namespace the deployed implementations declare", async function () {
      const current = await compiledLayout("AbleToken");

      // The failure that nearly shipped: dropping the inert AbleTokenStorage struct deletes a
      // namespace the live implementation declares, and OZ rejects the upgrade.
      for (const { address, layout } of deployedLayouts()) {
        expect(
          Object.keys(current.namespaces),
          `namespaces missing versus deployed implementation ${address}`,
        ).to.include.members(Object.keys(layout.namespaces));
      }
    });

    it("is itself a valid UUPS implementation", async function () {
      const current = await ethers.getContractFactory("AbleToken");

      await upgrades.validateImplementation(current, { kind: "uups" });
    });
  });
});
