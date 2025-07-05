const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("AbleToken: The Truly Complete and Definitive Test Suite", function () {
  let AbleToken, AbleTokenV2, ableToken, owner, addr1, addr2;
  const INITIAL_SUPPLY = ethers.parseEther("1000000000");
  const ONE_HUNDRED_TOKENS = ethers.parseEther("100");
  const FIFTY_TOKENS = ethers.parseEther("50");
  const TWO_HUNDRED_TOKENS = ethers.parseEther("200");

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    AbleToken = await ethers.getContractFactory("AbleToken");
    AbleTokenV2 = await ethers.getContractFactory("AbleTokenV2");

    ableToken = await upgrades.deployProxy(AbleToken, [INITIAL_SUPPLY, owner.address], {
      initializer: "initialize",
      kind: "uups",
    });

    await ableToken.waitForDeployment();

    // ✅ Quick debug check
    const name = await ableToken.name();
    const symbol = await ableToken.symbol();
    console.log(`✓ Proxy deployed: ${name} (${symbol})`);
  });

  // --- Test Suites ---
  describe("Deployment and Initialization", function () {
    it("should deploy with the correct initial state", async function () {
      expect(await ableToken.owner()).to.equal(owner.address);
      expect(await ableToken.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
      expect(await ableToken.totalSupply()).to.equal(INITIAL_SUPPLY);
      expect(await ableToken.name()).to.equal("ABLE Token");
      expect(await ableToken.symbol()).to.equal("ABLE");
      expect(await ableToken.decimals()).to.equal(18);
    });

    it("should initialize in an unpaused state", async function () {
      expect(await ableToken.paused()).to.be.false;
    });
  });

  describe("ERC20 Core Functionality", function () {
    it("should transfer tokens correctly and emit a Transfer event", async function () {
      await expect(ableToken.connect(owner).transfer(addr1.address, ONE_HUNDRED_TOKENS))
        .to.emit(ableToken, "Transfer")
        .withArgs(owner.address, addr1.address, ONE_HUNDRED_TOKENS);
    });

    it("should revert when transferring more than the balance", async function () {
      await expect(ableToken.connect(addr1).transfer(owner.address, 1))
        .to.be.revertedWithCustomError(ableToken, "ERC20InsufficientBalance")
        .withArgs(addr1.address, 0, 1);
    });

    it("should revert when transferring to the zero address", async function () {
      await expect(ableToken.connect(owner).transfer(ethers.ZeroAddress, ONE_HUNDRED_TOKENS))
        .to.be.revertedWithCustomError(ableToken, "ERC20InvalidReceiver")
        .withArgs(ethers.ZeroAddress);
    });
  });

  describe("Approve and TransferFrom", function () {
    beforeEach(async function () {
      await ableToken.connect(owner).approve(addr1.address, ONE_HUNDRED_TOKENS);
    });

    it("should approve another account and emit an Approval event", async function () {
      await expect(ableToken.connect(owner).approve(addr1.address, ONE_HUNDRED_TOKENS))
        .to.emit(ableToken, "Approval")
        .withArgs(owner.address, addr1.address, ONE_HUNDRED_TOKENS);
    });

    it("should overwrite allowance, not add to it", async function () {
      await ableToken.connect(owner).approve(addr1.address, FIFTY_TOKENS);
      expect(await ableToken.allowance(owner.address, addr1.address)).to.equal(FIFTY_TOKENS);
    });

    it("should allow an approved account to transferFrom", async function () {
      await expect(
        ableToken.connect(addr1).transferFrom(owner.address, addr2.address, ONE_HUNDRED_TOKENS),
      )
        .to.emit(ableToken, "Transfer")
        .withArgs(owner.address, addr2.address, ONE_HUNDRED_TOKENS);

      expect(await ableToken.balanceOf(addr2.address)).to.equal(ONE_HUNDRED_TOKENS);
      expect(await ableToken.allowance(owner.address, addr1.address)).to.equal(0);
    });

    it("should revert transferFrom if allowance is insufficient", async function () {
      await expect(
        ableToken.connect(addr1).transferFrom(owner.address, addr2.address, TWO_HUNDRED_TOKENS),
      )
        .to.be.revertedWithCustomError(ableToken, "ERC20InsufficientAllowance")
        .withArgs(addr1.address, ONE_HUNDRED_TOKENS, TWO_HUNDRED_TOKENS);
    });

    it("should revert when approving the zero address", async function () {
      await expect(ableToken.connect(owner).approve(ethers.ZeroAddress, ONE_HUNDRED_TOKENS))
        .to.be.revertedWithCustomError(ableToken, "ERC20InvalidSpender")
        .withArgs(ethers.ZeroAddress);
    });
  });

  describe("Burn and BurnFrom Functionality", function () {
    it("should allow a user to burn their tokens", async function () {
      const initialSupply = await ableToken.totalSupply();
      await expect(ableToken.connect(owner).burn(ONE_HUNDRED_TOKENS))
        .to.emit(ableToken, "Transfer")
        .withArgs(owner.address, ethers.ZeroAddress, ONE_HUNDRED_TOKENS);
      expect(await ableToken.totalSupply()).to.equal(initialSupply - ONE_HUNDRED_TOKENS);
    });

    it("should revert when burning more than balance", async function () {
      await expect(ableToken.connect(addr1).burn(1))
        .to.be.revertedWithCustomError(ableToken, "ERC20InsufficientBalance")
        .withArgs(addr1.address, 0, 1);
    });

    it("should allow an approved account to burnFrom", async function () {
      await ableToken.connect(owner).approve(addr1.address, ONE_HUNDRED_TOKENS);
      const initialSupply = await ableToken.totalSupply();

      await expect(ableToken.connect(addr1).burnFrom(owner.address, ONE_HUNDRED_TOKENS))
        .to.emit(ableToken, "Transfer")
        .withArgs(owner.address, ethers.ZeroAddress, ONE_HUNDRED_TOKENS);

      expect(await ableToken.totalSupply()).to.equal(initialSupply - ONE_HUNDRED_TOKENS);
      expect(await ableToken.allowance(owner.address, addr1.address)).to.equal(0);
    });

    it("should revert burnFrom if allowance is insufficient", async function () {
      await expect(ableToken.connect(addr1).burnFrom(owner.address, 1))
        .to.be.revertedWithCustomError(ableToken, "ERC20InsufficientAllowance")
        .withArgs(addr1.address, 0, 1);
    });

    it("should correctly decrease allowance if burnFrom is called with less than allowance", async function () {
      await ableToken.connect(owner).approve(addr1.address, TWO_HUNDRED_TOKENS);
      const initialSupply = await ableToken.totalSupply();

      await expect(ableToken.connect(addr1).burnFrom(owner.address, ONE_HUNDRED_TOKENS))
        .to.emit(ableToken, "Transfer")
        .withArgs(owner.address, ethers.ZeroAddress, ONE_HUNDRED_TOKENS);

      expect(await ableToken.totalSupply()).to.equal(initialSupply - ONE_HUNDRED_TOKENS);
      expect(await ableToken.allowance(owner.address, addr1.address)).to.equal(ONE_HUNDRED_TOKENS);
    });
  });

  describe("Pausable Functionality", function () {
    beforeEach(async function () {
      await ableToken.connect(owner).pause();
    });

    it("should prevent transfers when paused", async function () {
      await expect(
        ableToken.transfer(addr1.address, ONE_HUNDRED_TOKENS),
      ).to.be.revertedWithCustomError(ableToken, "EnforcedPause");
    });

    it("should prevent burning when paused", async function () {
      await expect(ableToken.connect(owner).burn(ONE_HUNDRED_TOKENS)).to.be.revertedWithCustomError(
        ableToken,
        "EnforcedPause",
      );
    });

    it("should allow the owner to unpause", async function () {
      await ableToken.connect(owner).unpause();
      expect(await ableToken.paused()).to.be.false;
    });
  });

  describe("Ownership Functionality", function () {
    it("should allow the owner to transfer ownership", async function () {
      await expect(ableToken.connect(owner).transferOwnership(addr1.address))
        .to.emit(ableToken, "OwnershipTransferred")
        .withArgs(owner.address, addr1.address);
      expect(await ableToken.owner()).to.equal(addr1.address);
    });

    it("should prevent non-owners from transferring ownership", async function () {
      await expect(ableToken.connect(addr1).transferOwnership(addr2.address))
        .to.be.revertedWithCustomError(ableToken, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("should allow the owner to renounce ownership", async function () {
      await expect(ableToken.connect(owner).renounceOwnership())
        .to.emit(ableToken, "OwnershipTransferred")
        .withArgs(owner.address, ethers.ZeroAddress);
      expect(await ableToken.owner()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Upgradeability", function () {
    it("should allow the owner to upgrade", async function () {
      await ableToken.connect(owner).transfer(addr1.address, ONE_HUNDRED_TOKENS);
      const proxyAddress = await ableToken.getAddress();
      const upgraded = await upgrades.upgradeProxy(proxyAddress, AbleTokenV2);

      expect(await upgraded.balanceOf(addr1.address)).to.equal(ONE_HUNDRED_TOKENS);
      expect(await upgraded.version()).to.equal("v2");
    });

    it("should prevent non-owners from attempting to upgrade", async function () {
      const proxyAddress = await ableToken.getAddress();

      const nonOwnerFactory = await ethers.getContractFactory("AbleTokenV2", addr1);

      await expect(upgrades.upgradeProxy(proxyAddress, nonOwnerFactory))
        .to.be.revertedWithCustomError(ableToken, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });
  });
});
