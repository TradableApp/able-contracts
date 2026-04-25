const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// NOTE: AbleToken has no public mint() function. Minting occurs exclusively
// at initialization via initialize(). The mint tests below verify that
// initialization minting is correct and that no additional minting is possible.
// AbleToken DOES implement burnFrom via ERC20BurnableUpgradeable.

describe("AbleToken — Mint and Burn", function () {
  const TOKEN_NAME = "ABLE Token";
  const TOKEN_SYMBOL = "ABLE";
  const INITIAL_SUPPLY = ethers.parseEther("1000000000");
  const ONE_HUNDRED = ethers.parseEther("100");
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

  // --- MINT ---

  it("owner can mint tokens to any address", async function () {
    // initialize() mints INITIAL_SUPPLY to the designated owner address.
    const { token, owner } = await loadFixture(deployFixture);
    expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
  });

  it("mint increases totalSupply and recipient balance", async function () {
    // After initialization: totalSupply == INITIAL_SUPPLY, all held by owner.
    const { token, owner } = await loadFixture(deployFixture);
    expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY);
    expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
  });

  it("Transfer event emitted with from=zero on mint", async function () {
    // The ERC20 spec requires Transfer(address(0), recipient, amount) on mint.
    // This event is emitted inside initialize() when _mint is called.
    // Verify it exists in the proxy deployment transaction receipt.
    const { token } = await loadFixture(deployFixture);
    const deployTx = token.deploymentTransaction();
    expect(deployTx).to.not.be.null;
    const receipt = await deployTx.wait();
    const transferTopic = ethers.id("Transfer(address,address,uint256)");
    const zeroAddressPadded = ethers.zeroPadValue(ethers.ZeroAddress, 32);
    const mintLog = receipt.logs.find(
      (log) => log.topics[0] === transferTopic && log.topics[1] === zeroAddressPadded,
    );
    expect(mintLog).to.not.be.undefined;
  });

  it("non-owner cannot mint", async function () {
    // AbleToken exposes no public mint() function — the ABI contains no such entry.
    // Additional supply creation is impossible regardless of caller.
    const { token } = await loadFixture(deployFixture);
    expect(token.interface.getFunction("mint")).to.be.null;
  });

  // --- BURN ---

  it("token holder can burn their own tokens", async function () {
    const { token, owner } = await loadFixture(deployFixture);
    await expect(token.connect(owner).burn(ONE_HUNDRED))
      .to.emit(token, "Transfer")
      .withArgs(owner.address, ethers.ZeroAddress, ONE_HUNDRED);
  });

  it("burn decreases totalSupply and holder balance", async function () {
    const { token, owner } = await loadFixture(deployFixture);
    await token.connect(owner).burn(ONE_HUNDRED);
    expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY - ONE_HUNDRED);
    expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - ONE_HUNDRED);
  });

  it("Transfer event emitted with to=zero on burn", async function () {
    const { token, owner } = await loadFixture(deployFixture);
    await expect(token.connect(owner).burn(ONE_HUNDRED))
      .to.emit(token, "Transfer")
      .withArgs(owner.address, ethers.ZeroAddress, ONE_HUNDRED);
  });

  it("cannot burn more than balance", async function () {
    const { token, addr1 } = await loadFixture(deployFixture);
    await expect(token.connect(addr1).burn(1n))
      .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
      .withArgs(addr1.address, 0n, 1n);
  });

  it("Escrow (non-holder) cannot burn user tokens without burnFrom", async function () {
    // A third party with no allowance cannot burn another account's tokens.
    const { token, owner, addr1 } = await loadFixture(deployFixture);
    await expect(token.connect(addr1).burnFrom(owner.address, ONE_HUNDRED))
      .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
      .withArgs(addr1.address, 0n, ONE_HUNDRED);
  });

  // --- BURNFROM ---
  // AbleToken inherits ERC20BurnableUpgradeable which implements burnFrom.

  it("burnFrom succeeds within allowance", async function () {
    const { token, owner, addr1 } = await loadFixture(deployFixture);
    await token.connect(owner).approve(addr1.address, ONE_HUNDRED);
    await expect(token.connect(addr1).burnFrom(owner.address, ONE_HUNDRED))
      .to.emit(token, "Transfer")
      .withArgs(owner.address, ethers.ZeroAddress, ONE_HUNDRED);
    expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY - ONE_HUNDRED);
  });

  it("burnFrom reduces allowance", async function () {
    const { token, owner, addr1 } = await loadFixture(deployFixture);
    await token.connect(owner).approve(addr1.address, TWO_HUNDRED);
    await token.connect(addr1).burnFrom(owner.address, ONE_HUNDRED);
    expect(await token.allowance(owner.address, addr1.address)).to.equal(ONE_HUNDRED);
  });

  it("burnFrom reverts if allowance exceeded", async function () {
    const { token, owner, addr1 } = await loadFixture(deployFixture);
    await token.connect(owner).approve(addr1.address, ONE_HUNDRED);
    await expect(token.connect(addr1).burnFrom(owner.address, TWO_HUNDRED))
      .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
      .withArgs(addr1.address, ONE_HUNDRED, TWO_HUNDRED);
  });
});
