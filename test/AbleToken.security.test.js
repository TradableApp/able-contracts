const { expect } = require("chai");
const hre = require("hardhat");
const { ethers, upgrades } = hre;
const {
  assertStorageUpgradeSafe,
  getStorageLayout,
  getVersion,
} = require("@openzeppelin/upgrades-core");
// Deep import: hardhat-upgrades does not re-export this. If a plugin bump moves it, this throws
// at require time with a clear module-not-found — a loud break, not a silently skipped check.
const {
  readValidations,
} = require("@openzeppelin/hardhat-upgrades/dist/utils/validations");

// The deployment manifest OpenZeppelin wrote for Base mainnet. This is the same artifact
// `upgradeProxy` reads to decide whether an upgrade is safe, so it is the authoritative record
// of what is actually deployed.
const BASE_MANIFEST = require("../.openzeppelin/base.json");
const LIVE_PROXY = "0xD77FF82e661C3838a59ea78bbF31F8c4c2BD8A80";

/** The storage layout of the implementation currently deployed behind the live proxy. */
function deployedLayout() {
  const proxy = BASE_MANIFEST.proxies.find(
    (p) => p.address.toLowerCase() === LIVE_PROXY.toLowerCase(),
  );
  if (!proxy) {
    throw new Error(
      `.openzeppelin/base.json does not describe proxy ${LIVE_PROXY}. ` +
        "This test compares against the live token; it cannot run against another manifest.",
    );
  }
  const impls = Object.values(BASE_MANIFEST.impls);
  if (impls.length !== 1) {
    throw new Error(
      `Expected exactly one implementation in .openzeppelin/base.json, found ${impls.length}. ` +
        "Pick the one the proxy points at rather than guessing.",
    );
  }
  return impls[0].layout;
}

/** The storage layout the current sources compile to. */
async function compiledLayout(contractName) {
  const validations = await readValidations(hre);
  const factory = await ethers.getContractFactory(contractName);
  return getStorageLayout(validations, getVersion(factory.bytecode));
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
    it("passes OpenZeppelin's storage check against the deployed implementation", async function () {
      const deployed = deployedLayout();
      const current = await compiledLayout("AbleToken");

      // Throws with OZ's own diagnosis — "Deleted namespace ...", "Inserted variable ..." — which
      // names the offending change. Re-deleting the erc7201 AbleToken struct reds this.
      assertStorageUpgradeSafe(deployed, current, {});
    });

    it("still declares every storage namespace the deployed implementation declares", async function () {
      const deployed = deployedLayout();
      const current = await compiledLayout("AbleToken");

      // Stated separately from the check above because this is the specific failure that nearly
      // shipped: dropping the inert `AbleTokenStorage` struct deletes a namespace the live
      // implementation declares, and OZ rejects the upgrade even though the struct held no data.
      expect(Object.keys(current.namespaces)).to.include.members(
        Object.keys(deployed.namespaces),
      );
    });

    it("is itself a valid UUPS implementation", async function () {
      const current = await ethers.getContractFactory("AbleToken");

      await upgrades.validateImplementation(current, { kind: "uups" });
    });
  });
});
