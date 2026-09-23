const { expect } = require("chai");
const hre = require("hardhat");
const { ethers, upgrades } = hre;
const {
  assertStorageUpgradeSafe,
  getStorageLayout,
  getVersion,
} = require("@openzeppelin/upgrades-core");
// Deep import, verified against @openzeppelin/hardhat-upgrades@3.9.1 — recheck this path when
// bumping that dependency, since dist/ is internal and carries no semver guarantee.
// hardhat-upgrades does not re-export this. A plugin bump can break it two ways —
// the file moves (MODULE_NOT_FOUND here, obvious) or the file survives but the export is renamed,
// which would otherwise surface much later as an opaque "readValidations is not a function"
// inside a test. The guard collapses both into one failure, at load, that names the cause.
const {
  readValidations,
} = require("@openzeppelin/hardhat-upgrades/dist/utils/validations");

if (typeof readValidations !== "function") {
  throw new Error(
    "readValidations is no longer exported by @openzeppelin/hardhat-upgrades/dist/utils/validations. " +
      "The plugin has been restructured; find its replacement before trusting the storage checks below.",
  );
}

// The deployment manifest OpenZeppelin wrote for Base mainnet. This is the same artifact
// `upgradeProxy` reads to decide whether an upgrade is safe, so it is the authoritative record
// of what is actually deployed.
const BASE_MANIFEST = require("../.openzeppelin/base.json");
const LIVE_PROXY = "0xD77FF82e661C3838a59ea78bbF31F8c4c2BD8A80";

const ABLE_TOKEN_NAMESPACE = "erc7201:openzeppelin.storage.AbleToken";

/**
 * Every AbleToken implementation the manifest records as having been deployed on Base.
 *
 * The v3.2 manifest format stores no proxy -> implementation reference (a proxy entry carries
 * only address, txHash and kind), so there is no machine-readable way to ask which single
 * implementation the proxy currently points at without querying the chain. Rather than guess
 * positionally or pin an address by hand — both of which need a human to remember something
 * after every mainnet upgrade — validate against ALL of them.
 *
 * That needs no maintenance and is not weaker: each deployed implementation was itself a valid
 * upgrade of the one before it, so recorded layouts only ever grow, and compatibility with the
 * newest implies compatibility with the older ones. If a storage-breaking migration is ever done
 * deliberately, this reds loudly and a human looks at it — which is the correct outcome.
 *
 * Implementations are selected by the namespace this token declares, so an unrelated contract
 * deployed to Base through this same manifest cannot drag a foreign layout into the comparison.
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
    .filter((impl) => Object.keys(impl.layout.namespaces || {}).includes(ABLE_TOKEN_NAMESPACE))
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

  return layout;
}

// Security hardening regressions — from the 2026-09-22 cross-repo review.
describe("AbleToken — security hardening", function () {
  const NAME = "ABLE Token";
  const SYMBOL = "ABLE";
  const SUPPLY = ethers.parseEther("1000000000");

  describe("implementation contract cannot be taken over", function () {
    it("reverts when initialize() is called directly on the implementation", async function () {
      const [, attacker] = await ethers.getSigners();

      // Deploy the logic contract on its own, exactly as an attacker would find it
      // on-chain behind the proxy.
      const AbleToken = await ethers.getContractFactory("AbleToken");
      const implementation = await AbleToken.deploy();
      await implementation.waitForDeployment();

      // Without constructor() { _disableInitializers(); } this SUCCEEDS and hands the
      // attacker ownership of a source-verified, identical-bytecode token at a real
      // address — usable for fake pools and phishing.
      await expect(
        implementation
          .connect(attacker)
          .initialize(NAME, SYMBOL, SUPPLY, attacker.address),
      ).to.be.revertedWithCustomError(implementation, "InvalidInitialization");
    });

    it("leaves the implementation with no owner and no supply", async function () {
      const AbleToken = await ethers.getContractFactory("AbleToken");
      const implementation = await AbleToken.deploy();
      await implementation.waitForDeployment();

      expect(await implementation.owner()).to.equal(ethers.ZeroAddress);
      expect(await implementation.totalSupply()).to.equal(0n);
    });
  });

  describe("ownership transfer is two-step", function () {
    it("does not hand ownership over until the recipient accepts", async function () {
      const [owner, newOwner] = await ethers.getSigners();
      const AbleToken = await ethers.getContractFactory("AbleToken");
      const token = await upgrades.deployProxy(
        AbleToken,
        [NAME, SYMBOL, SUPPLY, owner.address],
        { initializer: "initialize", kind: "uups" },
      );
      await token.waitForDeployment();

      await token.connect(owner).transferOwnership(newOwner.address);

      // Single-step Ownable would have already moved it. A mistyped address that can
      // never call acceptOwnership would strand pause() and _authorizeUpgrade forever.
      expect(await token.owner()).to.equal(owner.address);
      expect(await token.pendingOwner()).to.equal(newOwner.address);

      await token.connect(newOwner).acceptOwnership();
      expect(await token.owner()).to.equal(newOwner.address);
    });
  });

  describe("ownership cannot be abandoned", function () {
    it("reverts renounceOwnership so pause and upgrade authority can never be stranded", async function () {
      const [owner] = await ethers.getSigners();
      const AbleToken = await ethers.getContractFactory("AbleToken");
      const token = await upgrades.deployProxy(
        AbleToken,
        [NAME, SYMBOL, SUPPLY, owner.address],
        { initializer: "initialize", kind: "uups" },
      );
      await token.waitForDeployment();

      await expect(
        token.connect(owner).renounceOwnership(),
      ).to.be.revertedWithCustomError(token, "OwnershipCannotBeRenounced");

      expect(await token.owner()).to.equal(owner.address);
    });

    // The two callers get different errors by design (see the @dev note on the function):
    // a non-owner is told they are not the owner, the owner is told the operation is disabled.
    // Pinned because it is a documented choice, not an accident of modifier ordering.
    it("tells a non-owner they are unauthorised rather than that renouncing is disabled", async function () {
      const [owner, stranger] = await ethers.getSigners();
      const AbleToken = await ethers.getContractFactory("AbleToken");
      const token = await upgrades.deployProxy(
        AbleToken,
        [NAME, SYMBOL, SUPPLY, owner.address],
        { initializer: "initialize", kind: "uups" },
      );
      await token.waitForDeployment();

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
