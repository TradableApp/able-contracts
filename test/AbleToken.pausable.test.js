const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("AbleToken — Pausable", function () {
  const TOKEN_NAME = "ABLE Token";
  const TOKEN_SYMBOL = "ABLE";
  const INITIAL_SUPPLY = ethers.parseEther("1000000000");
  const ONE_HUNDRED = ethers.parseEther("100");

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

  async function deployPausedFixture() {
    const [owner, addr1, addr2] = await ethers.getSigners();
    const AbleToken = await ethers.getContractFactory("AbleToken");
    const token = await upgrades.deployProxy(
      AbleToken,
      [TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY, owner.address],
      { initializer: "initialize", kind: "uups" },
    );
    await token.waitForDeployment();
    await token.connect(owner).pause();
    return { token, owner, addr1, addr2 };
  }

  it("transfer succeeds when unpaused", async function () {
    const { token, owner, addr1 } = await loadFixture(deployFixture);
    await expect(token.connect(owner).transfer(addr1.address, ONE_HUNDRED))
      .to.emit(token, "Transfer")
      .withArgs(owner.address, addr1.address, ONE_HUNDRED);
  });

  it("pause() called by owner pauses the contract", async function () {
    const { token, owner } = await loadFixture(deployFixture);
    await token.connect(owner).pause();
    expect(await token.paused()).to.be.true;
  });

  it("transfer reverts when paused", async function () {
    const { token, owner, addr1 } = await loadFixture(deployPausedFixture);
    await expect(token.connect(owner).transfer(addr1.address, ONE_HUNDRED)).to.be.revertedWithCustomError(
      token,
      "EnforcedPause",
    );
  });

  it("transferFrom reverts when paused", async function () {
    const { token, owner, addr1, addr2 } = await loadFixture(deployFixture);
    await token.connect(owner).approve(addr1.address, ONE_HUNDRED);
    await token.connect(owner).pause();
    await expect(
      token.connect(addr1).transferFrom(owner.address, addr2.address, ONE_HUNDRED),
    ).to.be.revertedWithCustomError(token, "EnforcedPause");
  });

  it("unpause() called by owner restores transfers", async function () {
    const { token, owner, addr1 } = await loadFixture(deployPausedFixture);
    await token.connect(owner).unpause();
    await expect(token.connect(owner).transfer(addr1.address, ONE_HUNDRED))
      .to.emit(token, "Transfer")
      .withArgs(owner.address, addr1.address, ONE_HUNDRED);
  });

  it("pause() reverts when called by non-owner", async function () {
    const { token, addr1 } = await loadFixture(deployFixture);
    await expect(token.connect(addr1).pause())
      .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
      .withArgs(addr1.address);
  });

  it("unpause() reverts when called by non-owner", async function () {
    const { token, addr1 } = await loadFixture(deployPausedFixture);
    await expect(token.connect(addr1).unpause())
      .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
      .withArgs(addr1.address);
  });

  it("Paused event is emitted on pause", async function () {
    const { token, owner } = await loadFixture(deployFixture);
    await expect(token.connect(owner).pause()).to.emit(token, "Paused").withArgs(owner.address);
  });

  it("Unpaused event is emitted on unpause", async function () {
    const { token, owner } = await loadFixture(deployPausedFixture);
    await expect(token.connect(owner).unpause()).to.emit(token, "Unpaused").withArgs(owner.address);
  });
});
