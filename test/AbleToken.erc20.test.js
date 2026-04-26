const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("AbleToken — ERC20 core", function () {
  const TOKEN_NAME = "ABLE Token";
  const TOKEN_SYMBOL = "ABLE";
  const INITIAL_SUPPLY = ethers.parseEther("1000000000");
  const ONE_HUNDRED = ethers.parseEther("100");
  const FIFTY = ethers.parseEther("50");
  const TWO_HUNDRED = ethers.parseEther("200");

  async function deployFixture() {
    const [owner, addr1, addr2] = await ethers.getSigners();
    const AbleToken = await ethers.getContractFactory("AbleToken");
    const token = await upgrades.deployProxy(
      AbleToken,
      [TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY, owner.address],
      { initializer: "initialize", kind: "uups" },
    );
    await token.waitForDeployment();
    return { token, owner, addr1, addr2 };
  }

  describe("transfer", function () {
    it("transfers tokens between accounts", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).transfer(addr1.address, ONE_HUNDRED);
      expect(await token.balanceOf(addr1.address)).to.equal(ONE_HUNDRED);
      expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - ONE_HUNDRED);
    });

    it("emits Transfer event", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await expect(token.connect(owner).transfer(addr1.address, ONE_HUNDRED))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, addr1.address, ONE_HUNDRED);
    });

    it("reverts if sender has insufficient balance", async function () {
      const { token, addr1, addr2 } = await loadFixture(deployFixture);
      await expect(token.connect(addr1).transfer(addr2.address, 1n))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
        .withArgs(addr1.address, 0n, 1n);
    });

    it("reverts if transferring to zero address", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      await expect(token.connect(owner).transfer(ethers.ZeroAddress, ONE_HUNDRED))
        .to.be.revertedWithCustomError(token, "ERC20InvalidReceiver")
        .withArgs(ethers.ZeroAddress);
    });
  });

  describe("approve and transferFrom", function () {
    it("sets allowance via approve", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).approve(addr1.address, ONE_HUNDRED);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(ONE_HUNDRED);
    });

    it("emits Approval event", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await expect(token.connect(owner).approve(addr1.address, ONE_HUNDRED))
        .to.emit(token, "Approval")
        .withArgs(owner.address, addr1.address, ONE_HUNDRED);
    });

    it("transferFrom succeeds within allowance", async function () {
      const { token, owner, addr1, addr2 } = await loadFixture(deployFixture);
      await token.connect(owner).approve(addr1.address, ONE_HUNDRED);
      await token.connect(addr1).transferFrom(owner.address, addr2.address, ONE_HUNDRED);
      expect(await token.balanceOf(addr2.address)).to.equal(ONE_HUNDRED);
      expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - ONE_HUNDRED);
    });

    it("transferFrom reduces allowance", async function () {
      const { token, owner, addr1, addr2 } = await loadFixture(deployFixture);
      await token.connect(owner).approve(addr1.address, ONE_HUNDRED);
      await token.connect(addr1).transferFrom(owner.address, addr2.address, FIFTY);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(FIFTY);
    });

    it("transferFrom reverts if allowance exceeded", async function () {
      const { token, owner, addr1, addr2 } = await loadFixture(deployFixture);
      await token.connect(owner).approve(addr1.address, FIFTY);
      await expect(
        token.connect(addr1).transferFrom(owner.address, addr2.address, ONE_HUNDRED),
      )
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(addr1.address, FIFTY, ONE_HUNDRED);
    });

    it("transferFrom reverts if balance insufficient (even with allowance)", async function () {
      const { token, addr1, addr2 } = await loadFixture(deployFixture);
      // addr1 has 0 tokens; addr2 is granted allowance over addr1's non-existent balance
      await token.connect(addr1).approve(addr2.address, ONE_HUNDRED);
      await expect(
        token.connect(addr2).transferFrom(addr1.address, addr2.address, ONE_HUNDRED),
      )
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
        .withArgs(addr1.address, 0n, ONE_HUNDRED);
    });

    it("infinite allowance (MaxUint256) does not decrease after transferFrom", async function () {
      const { token, owner, addr1, addr2 } = await loadFixture(deployFixture);
      await token.connect(owner).approve(addr1.address, ethers.MaxUint256);
      await token.connect(addr1).transferFrom(owner.address, addr2.address, ONE_HUNDRED);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(ethers.MaxUint256);
    });
  });

  describe("balanceOf and totalSupply", function () {
    it("balanceOf returns correct balance after transfer", async function () {
      const { token, owner, addr1 } = await loadFixture(deployFixture);
      await token.connect(owner).transfer(addr1.address, ONE_HUNDRED);
      expect(await token.balanceOf(addr1.address)).to.equal(ONE_HUNDRED);
      expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - ONE_HUNDRED);
    });

    it("totalSupply equals sum of all balances", async function () {
      const { token, owner, addr1, addr2 } = await loadFixture(deployFixture);
      await token.connect(owner).transfer(addr1.address, ONE_HUNDRED);
      await token.connect(owner).transfer(addr2.address, FIFTY);
      const ownerBal = await token.balanceOf(owner.address);
      const addr1Bal = await token.balanceOf(addr1.address);
      const addr2Bal = await token.balanceOf(addr2.address);
      expect(await token.totalSupply()).to.equal(ownerBal + addr1Bal + addr2Bal);
    });
  });
});
