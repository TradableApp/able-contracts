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
// Deep import, verified against @openzeppelin/hardhat-upgrades@3.9.1 — recheck this path when
// bumping that dependency, since dist/ is internal and carries no semver guarantee.
// hardhat-upgrades does not re-export this, so a plugin bump can break it three ways: the file
// moves, the file survives but the export is renamed, or both survive and the signature changes.
// All three abort at load or on first use with a message naming the cause — none of them is
// allowed to leave the storage checks silently comparing nothing. The third is caught in
// compiledLayout below; the two here.
//
// A fourth shape — a layout that is well-formed but wrong — is left to the assertions rather
// than guarded: to reach them it would have to declare all five namespaces the deployed
// implementation declares and be storage-compatible with them, which is what being a correct
// layout for this contract means. Anything less fails the namespace-superset check by name.
const VALIDATIONS_PATH = "@openzeppelin/hardhat-upgrades/dist/utils/validations";

let readValidations;
let importFailure;
try {
  ({ readValidations } = require(VALIDATIONS_PATH));
} catch (error) {
  importFailure = error;
}

/**
 * Both plugin-API guards, deferred to a before() hook rather than run at module load.
 *
 * Throwing at load would abort the whole hardhat run, so one broken import would take every
 * other test file in the repo down with it and report "An unexpected error occurred" instead of
 * a named failure. From a hook, mocha attributes the failure to this describe, skips only its
 * tests, and the rest of the suite still reports — which is what you want when triaging whether
 * a dependency bump broke the tooling or the contract.
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
    // The module loaded, so this is a renamed or withdrawn export rather than a move — say so,
    // and list what the module does export, which is usually enough to spot the new name
    // without anyone having to go and read the plugin.
    const exported = Object.keys(require(VALIDATIONS_PATH)).sort().join(", ");
    throw new Error(
      `${VALIDATIONS_PATH} loaded but does not export a readValidations function. ` +
        `It was renamed or withdrawn, not moved. Available exports: ${exported}. ` +
        "Find its replacement before trusting the storage checks below.",
    );
  }
}

// The deployment manifest OpenZeppelin wrote for Base mainnet. This is the same artifact
// `upgradeProxy` reads to decide whether an upgrade is safe, so it is the authoritative record
// of what is actually deployed.
const BASE_MANIFEST = require("../.openzeppelin/base.json");
const LIVE_PROXY = "0xD77FF82e661C3838a59ea78bbF31F8c4c2BD8A80";

const ABLE_TOKEN_NAMESPACE = "erc7201:openzeppelin.storage.AbleToken";

// Bounds for the initialize() source slice asserted below. Kept as constants so the uniqueness
// check and the slice cannot drift apart.
const START_ANCHOR = "  ) public initializer {";
const END_ANCHOR = "    _mint(_initialOwner, _initialSupply);";

/**
 * Every AbleToken implementation the manifest records as having been deployed on Base.
 *
 * The v3.2 manifest format stores no proxy -> implementation reference (a proxy entry carries
 * only address, txHash and kind), so there is no machine-readable way to ask which single
 * implementation the proxy currently points at without querying the chain. Rather than guess
 * positionally or pin an address by hand — both of which need a human to remember something
 * after every mainnet upgrade — validate against ALL of them.
 *
 * That needs no maintenance, and checking all of them is never weaker than checking only the
 * newest. Be precise about why, because the obvious argument runs the wrong way: IF every
 * historical upgrade was additive, then compatibility with the newest already implies
 * compatibility with the older ones and checking them all is merely redundant. The value is in
 * not having to assume that. Where the assumption fails — a migration done with
 * unsafeSkipStorageCheck, or a layout edited by hand — an older baseline catches what the newest
 * would wave through. So this is equivalent in the good case and stricter in the bad one, which
 * is the right shape for a check whose job is to fail.
 *
 * Implementations are selected by the namespace this token declares, so an unrelated contract
 * deployed to Base through this same manifest cannot drag a foreign layout into the comparison.
 *
 * The LIVE_PROXY lookup below is a manifest-integrity check — it confirms this is the manifest
 * for the token we mean — and NOT a proof that the returned layouts are the ones that proxy
 * points at. No such proof is available offline; do not go looking for proxy-to-implementation
 * mapping logic here, because the v3.2 format does not record the link.
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
 * The storage layout the current sources compile to.
 *
 * The returned layout is sanity-checked rather than trusted. The readValidations import above is
 * an internal one, and a restructuring that kept the name but changed the signature would satisfy
 * the typeof guard while handing back something useless — at which point a storage check that
 * compares nothing against nothing would quietly pass. An empty namespace map is not a valid
 * layout for this contract under any circumstances, so treat it as the plugin having moved.
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

  // Non-empty is not the same as right. Without this, a layout belonging to some other contract
  // would reach assertStorageUpgradeSafe and fail as "Deleted namespace erc7201:...AbleToken" —
  // the identical message you get from actually deleting the struct from the source. A tooling
  // fault would then read as a source fault, and be "fixed" in the wrong file.
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

      // The pending entry is public, so the window between propose and accept is visible to
      // anyone watching. OZ guards it; a hardening suite should say so rather than assume it.
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

    // The two callers get different errors by design (see the @dev note on the function):
    // a non-owner is told they are not the owner, the owner is told the operation is disabled.
    // Pinned because it is a documented choice, not an accident of modifier ordering.
    it("tells a non-owner they are unauthorised rather than that renouncing is disabled", async function () {
      const { token, stranger } = await loadFixture(deployProxyFixture);

      await expect(token.connect(stranger).renounceOwnership())
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
        .withArgs(stranger.address);
    });

    // Reads the on-disk artifact, so it asserts what was last compiled. That is the current
    // source under `bun run test` (plain `hardhat test`, which compiles first) and under CI,
    // which compiles in its own step; `--no-compile` is used nowhere. Running it that way by
    // hand would test a stale artifact — but so would every other test in this suite, which
    // deploys from the same artifacts.
    //
    // solc suggests `view` on an always-reverting override. Taking that suggestion silently
    // changes the ABI: consumers dispatch on `stateMutability`, so ethers v6 would route this
    // through `eth_call` rather than a transaction, and Safe{Wallet} would file it under
    // read-only instead of the admin write panel. The override must stay nonpayable, like the
    // OwnableUpgradeable function it replaces.
    it("keeps the inherited nonpayable ABI rather than taking solc's view suggestion", async function () {
      const { abi } = await hre.artifacts.readArtifact("AbleToken");
      const fn = abi.find(
        (entry) => entry.type === "function" && entry.name === "renounceOwnership",
      );

      expect(fn, "renounceOwnership missing from the ABI").to.not.equal(undefined);
      expect(fn.stateMutability).to.equal("nonpayable");
    });
  });

  // __Ownable2Step_init() is an empty body in OZ v5, so there is nothing observable at runtime
  // to assert — the call is kept purely so that state a future OZ release adds to Ownable2Step
  // is initialised on fresh deployments. That makes it exactly the kind of line a cleanup
  // deletes as dead code, with nothing to red. A source assertion is a blunt instrument and is
  // used deliberately, for the same reason the ABI test exists: a comment saying "do not remove"
  // loses to a reader who can see the function is empty.
  // initialize() calling __Ownable2Step_init() has no observable effect today, so no
  // behavioural test can see it disappear. Asserted against the source text instead.
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

  // The hardening changes the inheritance chain and the contract's declared storage. Neither may
  // break the upgrade path of the token already live on Base mainnet: if it does, the proxy is
  // stranded on its current implementation forever.
  //
  // The comparison is made against the deployment manifest, NOT against a copy of the deployed
  // source. A hand-written Solidity baseline was tried first and was silently wrong: `__gap` was
  // added to AbleToken.sol four months AFTER the deployment (cea89f5) with no redeploy, so the
  // copy carried a variable the live implementation does not have. A copy drifts; the manifest
  // records what was actually deployed and cannot.
  describe("remains a storage-compatible upgrade of the live Base mainnet proxy", function () {
    it("passes OpenZeppelin's storage check against every deployed implementation", async function () {
      const current = await compiledLayout("AbleToken");

      for (const { address, layout } of deployedLayouts()) {
        // Throws with OZ's own diagnosis — "Deleted namespace ...", "Inserted variable ..." —
        // which names the offending change. Re-deleting the erc7201 struct reds this.
        try {
          // {} is strict mode, not a placeholder: unsafeAllowRenames, unsafeSkipStorageCheck
          // and the rest all default to false. Do not add allowances here to unblock a failing
          // test — a failure here means the upgrade is genuinely unsafe.
          assertStorageUpgradeSafe(layout, current, {});
        } catch (error) {
          error.message = `against deployed implementation ${address}:\n${error.message}`;
          throw error;
        }
      }
    });

    it("still declares every storage namespace the deployed implementations declare", async function () {
      const current = await compiledLayout("AbleToken");

      // Stated separately from the check above because this is the specific failure that nearly
      // shipped: dropping the inert `AbleTokenStorage` struct deletes a namespace the live
      // implementation declares, and OZ rejects the upgrade even though the struct held no data.
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
