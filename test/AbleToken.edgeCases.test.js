const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("AbleToken — Edge cases and production readiness", function () {
  const TOKEN_NAME = "ABLE Token";
  const TOKEN_SYMBOL = "ABLE";
  const INITIAL_SUPPLY = ethers.parseEther("1000000000");
  const ONE_HUNDRED = ethers.parseEther("100");
  const ONE_TOKEN = ethers.parseEther("1");

  async function deployFixture() {
    const [owner, addr1, addr2, addr3] = await ethers.getSigners();
    const AbleToken = await ethers.getContractFactory("AbleToken");
    const token = await upgrades.deployProxy(
      AbleToken,
      [TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY, owner.address],
      { initializer: "initialize", kind: "uups" },
    );
    await token.waitForDeployment();
    return { token, owner, addr1, addr2, addr3 };
  }

  describe("Initialization security", function () {
    it("reverts on re-initialization", async function () {
      const { token, addr1 } = await loadFixture(deployFixture);
      await expect(
        token.initialize("Fake", "FAKE", 1n, addr1.address),
      ).to.be.revertedWithCustomError(token, "InvalidInitialization");
    });

    it("reverts when initialOwner is zero address", async function () {
      const AbleToken = await ethers.getContractFactory("AbleToken");
      await expect(
        upgrades.deployProxy(
          AbleToken,
          [TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY, ethers.ZeroAddress],
          { initializer: "initialize", kind: "uups" },
        ),
      ).to.be.revertedWithCustomError(AbleToken, "OwnableInvalidOwner");
    });

    it("deploys correctly with zero initial supply", async function () {
      const [owner] = await ethers.getSigners();
      const AbleToken = await ethers.getContractFactory("AbleToken");
      const token = await upgrades.deployProxy(
        AbleToken,
        [TOKEN_NAME, TOKEN_SYMBOL, 0n, owner.address],
        { initializer: "initialize", kind: "uups" },
      );
      await token.waitForDeployment();
      expect(await token.totalSupply()).to.equal(0n);
      expect(await token.balanceOf(owner.address)).to.equal(0n);
    });
  });

  describe("Zero-amount operations", function () {
    it("transfer of zero tokens succeeds", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await expect(token.connect(owner).transfer(addr1.address, 0n))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, addr1.address, 0n);
    });

    it("approve zero amount succeeds (revoke pattern)", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).approve(addr1.address, ONE_HUNDRED);
      await expect(token.connect(owner).approve(addr1.address, 0n))
        .to.emit(token, "Approval")
        .withArgs(owner.address, addr1.address, 0n);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(0n);
    });

    it("transferFrom of zero tokens succeeds with zero allowance", async function () {
      const { token, owner, addr1, addr2 } = await loadFixture(deployFixture);
      await expect(token.connect(addr1).transferFrom(owner.address, addr2.address, 0n))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, addr2.address, 0n);
    });

    it("burn zero tokens succeeds", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      await expect(token.connect(owner).burn(0n))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, ethers.ZeroAddress, 0n);
    });

    it("burnFrom zero tokens succeeds with zero allowance", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await expect(token.connect(addr1).burnFrom(owner.address, 0n))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, ethers.ZeroAddress, 0n);
    });
  });

  describe("Self-transfer edge cases", function () {
    it("self-transfer does not change balance", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      const balanceBefore = await token.balanceOf(owner.address);
      await token.connect(owner).transfer(owner.address, ONE_HUNDRED);
      expect(await token.balanceOf(owner.address)).to.equal(balanceBefore);
    });

    it("self-transfer emits Transfer event", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      await expect(token.connect(owner).transfer(owner.address, ONE_HUNDRED))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, owner.address, ONE_HUNDRED);
    });

    it("self-transferFrom consumes allowance", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).approve(addr1.address, ONE_HUNDRED);
      await token.connect(addr1).transferFrom(owner.address, owner.address, ONE_HUNDRED);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(0n);
    });
  });

  describe("Pausable — extended coverage", function () {
    it("approve succeeds while paused (not gated by _update)", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).pause();
      await expect(token.connect(owner).approve(addr1.address, ONE_HUNDRED))
        .to.emit(token, "Approval")
        .withArgs(owner.address, addr1.address, ONE_HUNDRED);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(ONE_HUNDRED);
    });

    it("burnFrom reverts while paused", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).approve(addr1.address, ONE_HUNDRED);
      await token.connect(owner).pause();
      await expect(
        token.connect(addr1).burnFrom(owner.address, ONE_HUNDRED),
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("zero-amount transfer reverts while paused", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).pause();
      await expect(token.connect(owner).transfer(addr1.address, 0n)).to.be.revertedWithCustomError(
        token,
        "EnforcedPause",
      );
    });

    it("transfer succeeds after pause-unpause cycle", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).pause();
      await token.connect(owner).unpause();
      await expect(token.connect(owner).transfer(addr1.address, ONE_HUNDRED))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, addr1.address, ONE_HUNDRED);
    });
  });

  describe("Upgrade — full end-to-end state preservation", function () {
    it("preserves totalSupply, balances, and owner through upgrade", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).transfer(addr1.address, ONE_HUNDRED);

      const proxyAddress = await token.getAddress();
      const totalSupplyBefore = await token.totalSupply();
      const ownerBalBefore = await token.balanceOf(owner.address);
      const addr1BalBefore = await token.balanceOf(addr1.address);

      const AbleTokenV2 = await ethers.getContractFactory("AbleTokenV2");
      const upgraded = await upgrades.upgradeProxy(proxyAddress, AbleTokenV2);

      expect(await upgraded.totalSupply()).to.equal(totalSupplyBefore);
      expect(await upgraded.balanceOf(owner.address)).to.equal(ownerBalBefore);
      expect(await upgraded.balanceOf(addr1.address)).to.equal(addr1BalBefore);
      expect(await upgraded.owner()).to.equal(owner.address);
      expect(await upgraded.name()).to.equal(TOKEN_NAME);
      expect(await upgraded.symbol()).to.equal(TOKEN_SYMBOL);
    });

    it("preserves paused state through upgrade", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      await token.connect(owner).pause();

      const proxyAddress = await token.getAddress();
      const AbleTokenV2 = await ethers.getContractFactory("AbleTokenV2");
      const upgraded = await upgrades.upgradeProxy(proxyAddress, AbleTokenV2);

      expect(await upgraded.paused()).to.be.true;
    });

    it("preserves allowances through upgrade", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).approve(addr1.address, ONE_HUNDRED);

      const proxyAddress = await token.getAddress();
      const AbleTokenV2 = await ethers.getContractFactory("AbleTokenV2");
      const upgraded = await upgrades.upgradeProxy(proxyAddress, AbleTokenV2);

      expect(await upgraded.allowance(owner.address, addr1.address)).to.equal(ONE_HUNDRED);
    });

    it("V2 functions work after upgrade while V1 functions remain intact", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      const proxyAddress = await token.getAddress();

      const AbleTokenV2 = await ethers.getContractFactory("AbleTokenV2");
      const upgraded = await upgrades.upgradeProxy(proxyAddress, AbleTokenV2);

      expect(await upgraded.version()).to.equal("v2");
      await expect(upgraded.connect(owner).transfer(addr1.address, ONE_TOKEN))
        .to.emit(upgraded, "Transfer")
        .withArgs(owner.address, addr1.address, ONE_TOKEN);
    });

    it("new owner can upgrade after ownership transfer", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      // Ownable2Step: the transfer only completes once the recipient accepts.
      await token.connect(owner).transferOwnership(addr1.address);
      await token.connect(addr1).acceptOwnership();

      const proxyAddress = await token.getAddress();
      const AbleTokenV2 = await ethers.getContractFactory("AbleTokenV2", addr1);
      const upgraded = await upgrades.upgradeProxy(proxyAddress, AbleTokenV2);

      expect(await upgraded.version()).to.equal("v2");
      expect(await upgraded.owner()).to.equal(addr1.address);
    });
  });

  // These previously documented what happens AFTER renouncing: pause, unpause and upgrade
  // become permanently unreachable with no recovery. renounceOwnership() now reverts, so the
  // lockout is unreachable by construction — these assert that, rather than the hazard.
  describe("Ownership — permanent lockout is unreachable", function () {
    it("owner keeps pause after a rejected renounce attempt", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      await expect(
        token.connect(owner).renounceOwnership(),
      ).to.be.revertedWithCustomError(token, "OwnershipCannotBeRenounced");

      await token.connect(owner).pause();
      expect(await token.paused()).to.equal(true);
    });

    it("owner keeps unpause after a rejected renounce attempt", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      await token.connect(owner).pause();
      await expect(
        token.connect(owner).renounceOwnership(),
      ).to.be.revertedWithCustomError(token, "OwnershipCannotBeRenounced");

      await token.connect(owner).unpause();
      expect(await token.paused()).to.equal(false);
    });

    it("owner keeps upgrade authority after a rejected renounce attempt", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      await expect(
        token.connect(owner).renounceOwnership(),
      ).to.be.revertedWithCustomError(token, "OwnershipCannotBeRenounced");

      const proxyAddress = await token.getAddress();
      const AbleTokenV2 = await ethers.getContractFactory("AbleTokenV2", owner);
      const upgraded = await upgrades.upgradeProxy(proxyAddress, AbleTokenV2);
      expect(await upgraded.version()).to.equal("v2");
    });

    it("transferOwnership to the zero address cannot strand ownership", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      // Under Ownable2Step this sets pendingOwner, and address(0) can never call
      // acceptOwnership — so ownership stays put either way. pendingOwner is asserted as well
      // as owner: without it this test would still pass if OZ reinstated a zero-address guard
      // and made the call revert again, silently reverting to the old behaviour.
      await token.connect(owner).transferOwnership(ethers.ZeroAddress);
      expect(await token.pendingOwner()).to.equal(ethers.ZeroAddress);
      expect(await token.owner()).to.equal(owner.address);
    });
  });

  describe("BurnFrom — infinite allowance and total burn", function () {
    it("burnFrom with MaxUint256 allowance does not decrease allowance", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).approve(addr1.address, ethers.MaxUint256);
      await token.connect(addr1).burnFrom(owner.address, ONE_HUNDRED);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(ethers.MaxUint256);
    });

    it("burn entire balance to zero", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      await token.connect(owner).burn(INITIAL_SUPPLY);
      expect(await token.balanceOf(owner.address)).to.equal(0n);
      expect(await token.totalSupply()).to.equal(0n);
    });

    it("cannot burn after burning entire balance", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      await token.connect(owner).burn(INITIAL_SUPPLY);
      await expect(token.connect(owner).burn(1n))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
        .withArgs(owner.address, 0n, 1n);
    });
  });

  describe("Approval race condition awareness", function () {
    it("allowance can be overwritten without first resetting to zero", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).approve(addr1.address, ONE_HUNDRED);
      await token.connect(owner).approve(addr1.address, ethers.parseEther("200"));
      expect(await token.allowance(owner.address, addr1.address)).to.equal(
        ethers.parseEther("200"),
      );
    });

    it("spender can self-approve (no-op, does not grant extra power)", async function () {
      const { token, addr1 } = await loadFixture(deployFixture);
      await expect(token.connect(addr1).approve(addr1.address, ONE_HUNDRED))
        .to.emit(token, "Approval")
        .withArgs(addr1.address, addr1.address, ONE_HUNDRED);
    });
  });

  describe("Transfer — additional boundary conditions", function () {
    it("transfer entire balance leaves sender at zero", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).transfer(addr1.address, INITIAL_SUPPLY);
      expect(await token.balanceOf(owner.address)).to.equal(0n);
      expect(await token.balanceOf(addr1.address)).to.equal(INITIAL_SUPPLY);
    });

    it("multiple recipients all receive correct balances", async function () {
      const { token, owner, addr1, addr2, addr3 } = await loadFixture(deployFixture);
      await token.connect(owner).transfer(addr1.address, ONE_HUNDRED);
      await token.connect(owner).transfer(addr2.address, ONE_HUNDRED);
      await token.connect(owner).transfer(addr3.address, ONE_HUNDRED);

      expect(await token.balanceOf(addr1.address)).to.equal(ONE_HUNDRED);
      expect(await token.balanceOf(addr2.address)).to.equal(ONE_HUNDRED);
      expect(await token.balanceOf(addr3.address)).to.equal(ONE_HUNDRED);
      expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - ONE_HUNDRED * 3n);
    });

    it("transferFrom to zero address reverts", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).approve(addr1.address, ONE_HUNDRED);
      await expect(
        token.connect(addr1).transferFrom(owner.address, ethers.ZeroAddress, ONE_HUNDRED),
      )
        .to.be.revertedWithCustomError(token, "ERC20InvalidReceiver")
        .withArgs(ethers.ZeroAddress);
    });
  });
});
