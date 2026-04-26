const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Simulates the EVMAIAgentEscrow payment pattern against AbleToken.
// The escrow contract calls token.transferFrom(user, escrow, amount) after
// the user calls token.approve(escrow, amount). This suite exercises that
// flow end-to-end using a simulatedEscrow signer instead of the real contract.

describe("AbleToken — Escrow payment flow simulation", function () {
  const TOKEN_NAME = "ABLE Token";
  const TOKEN_SYMBOL = "ABLE";
  const INITIAL_SUPPLY = ethers.parseEther("1000000000");
  const PAYMENT_AMOUNT = ethers.parseEther("500");
  const LARGE_AMOUNT = ethers.parseEther("10000");
  const ONE_HUNDRED = ethers.parseEther("100");

  async function deployFixture() {
    const [owner, user, simulatedEscrow] = await ethers.getSigners();
    const AbleToken = await ethers.getContractFactory("AbleToken");
    const token = await upgrades.deployProxy(
      AbleToken,
      [TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY, owner.address],
      { initializer: "initialize", kind: "uups" },
    );
    await token.waitForDeployment();
    await token.connect(owner).transfer(user.address, LARGE_AMOUNT);
    return { token, owner, user, simulatedEscrow };
  }

  async function deployPausedFixture() {
    const [owner, user, simulatedEscrow] = await ethers.getSigners();
    const AbleToken = await ethers.getContractFactory("AbleToken");
    const token = await upgrades.deployProxy(
      AbleToken,
      [TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY, owner.address],
      { initializer: "initialize", kind: "uups" },
    );
    await token.waitForDeployment();
    await token.connect(owner).transfer(user.address, LARGE_AMOUNT);
    await token.connect(user).approve(simulatedEscrow.address, PAYMENT_AMOUNT);
    await token.connect(owner).pause();
    return { token, owner, user, simulatedEscrow };
  }

  it("user approves escrow and escrow transferFrom succeeds", async function () {
    const { token, user, simulatedEscrow } = await loadFixture(deployFixture);
    await token.connect(user).approve(simulatedEscrow.address, PAYMENT_AMOUNT);
    await expect(
      token.connect(simulatedEscrow).transferFrom(user.address, simulatedEscrow.address, PAYMENT_AMOUNT),
    )
      .to.emit(token, "Transfer")
      .withArgs(user.address, simulatedEscrow.address, PAYMENT_AMOUNT);
    expect(await token.balanceOf(simulatedEscrow.address)).to.equal(PAYMENT_AMOUNT);
    expect(await token.balanceOf(user.address)).to.equal(LARGE_AMOUNT - PAYMENT_AMOUNT);
  });

  it("escrow transferFrom reduces user allowance by payment amount", async function () {
    const { token, user, simulatedEscrow } = await loadFixture(deployFixture);
    const approvalAmount = PAYMENT_AMOUNT * 2n;
    await token.connect(user).approve(simulatedEscrow.address, approvalAmount);
    await token.connect(simulatedEscrow).transferFrom(user.address, simulatedEscrow.address, PAYMENT_AMOUNT);
    expect(await token.allowance(user.address, simulatedEscrow.address)).to.equal(PAYMENT_AMOUNT);
  });

  it("escrow cannot transferFrom more than the approved allowance", async function () {
    const { token, user, simulatedEscrow } = await loadFixture(deployFixture);
    await token.connect(user).approve(simulatedEscrow.address, ONE_HUNDRED);
    await expect(
      token.connect(simulatedEscrow).transferFrom(user.address, simulatedEscrow.address, PAYMENT_AMOUNT),
    )
      .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
      .withArgs(simulatedEscrow.address, ONE_HUNDRED, PAYMENT_AMOUNT);
  });

  it("escrow cannot transferFrom without any approval", async function () {
    const { token, user, simulatedEscrow } = await loadFixture(deployFixture);
    await expect(
      token.connect(simulatedEscrow).transferFrom(user.address, simulatedEscrow.address, PAYMENT_AMOUNT),
    )
      .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
      .withArgs(simulatedEscrow.address, 0n, PAYMENT_AMOUNT);
  });

  it("pause blocks escrow payment flow with EnforcedPause", async function () {
    const { token, user, simulatedEscrow } = await loadFixture(deployPausedFixture);
    await expect(
      token.connect(simulatedEscrow).transferFrom(user.address, simulatedEscrow.address, PAYMENT_AMOUNT),
    ).to.be.revertedWithCustomError(token, "EnforcedPause");
  });

  it("unpause restores escrow payment flow", async function () {
    const { token, owner, user, simulatedEscrow } = await loadFixture(deployPausedFixture);
    await token.connect(owner).unpause();
    await token.connect(user).approve(simulatedEscrow.address, PAYMENT_AMOUNT);
    await expect(
      token.connect(simulatedEscrow).transferFrom(user.address, simulatedEscrow.address, PAYMENT_AMOUNT),
    )
      .to.emit(token, "Transfer")
      .withArgs(user.address, simulatedEscrow.address, PAYMENT_AMOUNT);
  });

  it("escrow has no mint capability (no mint function in ABI)", async function () {
    const { token } = await loadFixture(deployFixture);
    expect(token.interface.getFunction("mint")).to.be.null;
  });

  it("escrow cannot burnFrom user without allowance", async function () {
    const { token, user, simulatedEscrow } = await loadFixture(deployFixture);
    await expect(token.connect(simulatedEscrow).burnFrom(user.address, ONE_HUNDRED))
      .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
      .withArgs(simulatedEscrow.address, 0n, ONE_HUNDRED);
  });

  it("escrow can burnFrom user tokens with sufficient allowance", async function () {
    const { token, user, simulatedEscrow } = await loadFixture(deployFixture);
    await token.connect(user).approve(simulatedEscrow.address, ONE_HUNDRED);
    await expect(token.connect(simulatedEscrow).burnFrom(user.address, ONE_HUNDRED))
      .to.emit(token, "Transfer")
      .withArgs(user.address, ethers.ZeroAddress, ONE_HUNDRED);
    expect(await token.balanceOf(user.address)).to.equal(LARGE_AMOUNT - ONE_HUNDRED);
  });

  it("multiple sequential escrow payments drain allowance correctly", async function () {
    const { token, user, simulatedEscrow } = await loadFixture(deployFixture);
    const totalApproval = PAYMENT_AMOUNT * 3n;
    await token.connect(user).approve(simulatedEscrow.address, totalApproval);
    await token.connect(simulatedEscrow).transferFrom(user.address, simulatedEscrow.address, PAYMENT_AMOUNT);
    await token.connect(simulatedEscrow).transferFrom(user.address, simulatedEscrow.address, PAYMENT_AMOUNT);
    await token.connect(simulatedEscrow).transferFrom(user.address, simulatedEscrow.address, PAYMENT_AMOUNT);
    expect(await token.allowance(user.address, simulatedEscrow.address)).to.equal(0n);
    expect(await token.balanceOf(simulatedEscrow.address)).to.equal(PAYMENT_AMOUNT * 3n);
    expect(await token.balanceOf(user.address)).to.equal(LARGE_AMOUNT - PAYMENT_AMOUNT * 3n);
  });
});
