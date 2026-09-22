const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

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
  });
});
