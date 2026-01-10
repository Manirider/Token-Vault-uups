const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("TokenVaultV1", function () {
  let token, vault, owner, user, user2;
  const DEPOSIT_FEE = 500; // 5%

  beforeEach(async () => {
    [owner, user, user2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy();

    const Vault = await ethers.getContractFactory("TokenVaultV1");
    vault = await upgrades.deployProxy(
      Vault,
      [token.target, owner.address, DEPOSIT_FEE],
      { initializer: "initialize", kind: "uups" }
    );

    await token.transfer(user.address, ethers.parseEther("1000"));
    await token.connect(user).approve(vault.target, ethers.parseEther("1000"));
  });

  describe("Initialization", function () {
    it("should initialize with correct parameters", async () => {
      expect(await vault.getDepositFee()).to.equal(DEPOSIT_FEE);
      expect(await vault.getToken()).to.equal(token.target);
      expect(await vault.getImplementationVersion()).to.equal("V1");
    });

    it("should grant admin and upgrader roles to admin", async () => {
      const DEFAULT_ADMIN_ROLE = await vault.DEFAULT_ADMIN_ROLE();
      const UPGRADER_ROLE = await vault.UPGRADER_ROLE();

      expect(await vault.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await vault.hasRole(UPGRADER_ROLE, owner.address)).to.be.true;
    });

    it("should prevent reinitialization", async () => {
      await expect(
        vault.initialize(token.target, owner.address, 100)
      ).to.be.reverted;
    });

    it("should reject zero token address", async () => {
      const Vault = await ethers.getContractFactory("TokenVaultV1");
      await expect(
        upgrades.deployProxy(
          Vault,
          [ethers.ZeroAddress, owner.address, 500],
          { initializer: "initialize", kind: "uups" }
        )
      ).to.be.reverted;
    });

    it("should reject zero admin address", async () => {
      const Vault = await ethers.getContractFactory("TokenVaultV1");
      await expect(
        upgrades.deployProxy(
          Vault,
          [token.target, ethers.ZeroAddress, 500],
          { initializer: "initialize", kind: "uups" }
        )
      ).to.be.reverted;
    });

    it("should reject deposit fee exceeding maximum", async () => {
      const Vault = await ethers.getContractFactory("TokenVaultV1");
      await expect(
        upgrades.deployProxy(
          Vault,
          [token.target, owner.address, 1001], // > 10%
          { initializer: "initialize", kind: "uups" }
        )
      ).to.be.reverted;
    });
  });

  describe("Deposits", function () {
    it("should allow deposits and update balances", async () => {
      await vault.connect(user).deposit(1000);
      expect(await vault.balanceOf(user.address)).to.equal(950);
    });

    it("should deduct deposit fee correctly", async () => {
      await vault.connect(user).deposit(1000);
      expect(await vault.totalDeposits()).to.equal(950);
    });

    it("should emit Deposit event with correct values", async () => {
      await expect(vault.connect(user).deposit(1000))
        .to.emit(vault, "Deposit")
        .withArgs(user.address, 1000, 950, 50);
    });

    it("should handle zero fee correctly", async () => {
      const Vault = await ethers.getContractFactory("TokenVaultV1");
      const zeroFeeVault = await upgrades.deployProxy(
        Vault,
        [token.target, owner.address, 0],
        { initializer: "initialize", kind: "uups" }
      );

      await token.connect(user).approve(zeroFeeVault.target, 1000);
      await zeroFeeVault.connect(user).deposit(1000);
      expect(await zeroFeeVault.balanceOf(user.address)).to.equal(1000);
    });

    it("should reject zero amount deposits", async () => {
      await expect(vault.connect(user).deposit(0)).to.be.reverted;
    });

    it("should handle multiple deposits from same user", async () => {
      await vault.connect(user).deposit(500);
      await vault.connect(user).deposit(500);
      expect(await vault.balanceOf(user.address)).to.equal(950); // (500-25) + (500-25)
    });
  });

  describe("Withdrawals", function () {
    beforeEach(async () => {
      await vault.connect(user).deposit(1000);
    });

    it("should allow withdrawals and update balances", async () => {
      await vault.connect(user).withdraw(500);
      expect(await vault.balanceOf(user.address)).to.equal(450);
    });

    it("should emit Withdraw event", async () => {
      await expect(vault.connect(user).withdraw(500))
        .to.emit(vault, "Withdraw")
        .withArgs(user.address, 500);
    });

    it("should prevent withdrawal of more than balance", async () => {
      await expect(
        vault.connect(user).withdraw(1000)
      ).to.be.reverted;
    });

    it("should allow full balance withdrawal", async () => {
      await vault.connect(user).withdraw(950);
      expect(await vault.balanceOf(user.address)).to.equal(0);
    });

    it("should update total deposits on withdrawal", async () => {
      await vault.connect(user).withdraw(500);
      expect(await vault.totalDeposits()).to.equal(450);
    });
  });

  describe("Access Control", function () {
    it("should prevent unauthorized upgrades", async () => {
      
      const V2Factory = await ethers.getContractFactory("TokenVaultV2");
      const v2Impl = await V2Factory.deploy();

      await expect(
        vault.connect(user).upgradeToAndCall(v2Impl.target, "0x")
      ).to.be.reverted;
    });

    it("should allow authorized upgrades", async () => {
      const V2Factory = await ethers.getContractFactory("TokenVaultV2");
      const v2Impl = await V2Factory.deploy();
      const initData = v2Impl.interface.encodeFunctionData("initializeV2", []);

      await vault.upgradeToAndCall(v2Impl.target, initData);
      const upgraded = await ethers.getContractAt("TokenVaultV2", vault.target);
      expect(await upgraded.getImplementationVersion()).to.equal("V2");
    });
  });
});
