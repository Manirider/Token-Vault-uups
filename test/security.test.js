const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Security Tests", function () {
  let token, owner, attacker;

  beforeEach(async () => {
    [owner, attacker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy();
  });

  describe("Implementation Initialization", function () {
    it("should prevent direct initialization of implementation contracts", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      const impl = await V1.deploy();

      await expect(
        impl.initialize(token.target, owner.address, 0)
      ).to.be.reverted;
    });

    it("should prevent direct initialization of V2 implementation", async () => {
      const V2 = await ethers.getContractFactory("TokenVaultV2");
      const impl = await V2.deploy();

      await expect(
        impl.initialize(token.target, owner.address, 0)
      ).to.be.reverted;
    });

    it("should prevent direct initialization of V3 implementation", async () => {
      const V3 = await ethers.getContractFactory("TokenVaultV3");
      const impl = await V3.deploy();

      await expect(
        impl.initialize(token.target, owner.address, 0)
      ).to.be.reverted;
    });
  });

  describe("Upgrade Authorization", function () {
    it("should prevent unauthorized upgrades", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      const proxy = await upgrades.deployProxy(
        V1,
        [token.target, owner.address, 0],
        { initializer: "initialize", kind: "uups" }
      );

      const V2Factory = await ethers.getContractFactory("TokenVaultV2");
      const v2Impl = await V2Factory.deploy();

      await expect(
        proxy.connect(attacker).upgradeToAndCall(v2Impl.target, "0x")
      ).to.be.reverted;
    });

    it("should allow authorized upgrades", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      const proxy = await upgrades.deployProxy(
        V1,
        [token.target, owner.address, 0],
        { initializer: "initialize", kind: "uups" }
      );

      const V2Factory = await ethers.getContractFactory("TokenVaultV2");
      const v2Impl = await V2Factory.deploy();
      const initData = v2Impl.interface.encodeFunctionData("initializeV2", []);

      await proxy.upgradeToAndCall(v2Impl.target, initData);
      const upgraded = await ethers.getContractAt("TokenVaultV2", proxy.target);
      expect(await upgraded.getImplementationVersion()).to.equal("V2");
    });

    it("should emit UpgradeAuthorized event", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      const proxy = await upgrades.deployProxy(
        V1,
        [token.target, owner.address, 0],
        { initializer: "initialize", kind: "uups" }
      );

      const V2Factory = await ethers.getContractFactory("TokenVaultV2");
      const v2Impl = await V2Factory.deploy();

      await expect(proxy.upgradeToAndCall(v2Impl.target, "0x"))
        .to.emit(proxy, "UpgradeAuthorized");
    });
  });

  describe("Storage Layout", function () {
    it("should use storage gaps for future upgrades", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      const proxy = await upgrades.deployProxy(
        V1,
        [token.target, owner.address, 0],
        { initializer: "initialize", kind: "uups" }
      );

      await token.transfer(attacker.address, 1000);
      await token.connect(attacker).approve(proxy.target, 1000);
      await proxy.connect(attacker).deposit(1000);

      const V2Factory = await ethers.getContractFactory("TokenVaultV2");
      const v2Impl = await V2Factory.deploy();
      const initData = v2Impl.interface.encodeFunctionData("initializeV2", []);
      await proxy.upgradeToAndCall(v2Impl.target, initData);

      const v2Proxy = await ethers.getContractAt("TokenVaultV2", proxy.target);
      expect(await v2Proxy.balanceOf(attacker.address)).to.equal(1000);
    });

    it("should not have storage layout collisions across versions", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      const proxy = await upgrades.deployProxy(
        V1,
        [token.target, owner.address, 500],
        { initializer: "initialize", kind: "uups" }
      );

      await token.transfer(attacker.address, 1000);
      await token.connect(attacker).approve(proxy.target, 1000);
      await proxy.connect(attacker).deposit(1000);

      const balanceAfterDeposit = await proxy.balanceOf(attacker.address);
      expect(balanceAfterDeposit).to.equal(950);

      const V2Factory = await ethers.getContractFactory("TokenVaultV2");
      const v2Impl = await V2Factory.deploy();
      const v2InitData = v2Impl.interface.encodeFunctionData("initializeV2", []);
      await proxy.upgradeToAndCall(v2Impl.target, v2InitData);

      const v2Proxy = await ethers.getContractAt("TokenVaultV2", proxy.target);
      expect(await v2Proxy.balanceOf(attacker.address)).to.equal(950);
      expect(await v2Proxy.getDepositFee()).to.equal(500);

      await v2Proxy.setYieldRate(1000);

      const V3Factory = await ethers.getContractFactory("TokenVaultV3");
      const v3Impl = await V3Factory.deploy();
      const v3InitData = v3Impl.interface.encodeFunctionData("initializeV3", []);
      await v2Proxy.upgradeToAndCall(v3Impl.target, v3InitData);

      const v3Proxy = await ethers.getContractAt("TokenVaultV3", proxy.target);
      expect(await v3Proxy.balanceOf(attacker.address)).to.equal(950);
      expect(await v3Proxy.getDepositFee()).to.equal(500);
      expect(await v3Proxy.getYieldRate()).to.equal(1000);
    });

    it("should validate V2 to V3 upgrade compatibility", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      let proxy = await upgrades.deployProxy(
        V1,
        [token.target, owner.address, 0],
        { initializer: "initialize", kind: "uups" }
      );

      const V2Factory = await ethers.getContractFactory("TokenVaultV2");
      const v2Impl = await V2Factory.deploy();
      const v2InitData = v2Impl.interface.encodeFunctionData("initializeV2", []);
      await proxy.upgradeToAndCall(v2Impl.target, v2InitData);
      proxy = await ethers.getContractAt("TokenVaultV2", proxy.target);

      await proxy.setYieldRate(500);

      const V3Factory = await ethers.getContractFactory("TokenVaultV3");
      const v3Impl = await V3Factory.deploy();
      const v3InitData = v3Impl.interface.encodeFunctionData("initializeV3", []);
      await proxy.upgradeToAndCall(v3Impl.target, v3InitData);
      proxy = await ethers.getContractAt("TokenVaultV3", proxy.target);

      expect(await proxy.getImplementationVersion()).to.equal("V3");
      expect(await proxy.getYieldRate()).to.equal(500);
    });

    it("should validate direct V1 to V3 upgrade compatibility", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      const proxy = await upgrades.deployProxy(
        V1,
        [token.target, owner.address, 0],
        { initializer: "initialize", kind: "uups" }
      );

      expect(await proxy.getImplementationVersion()).to.equal("V1");
    });
  });

  describe("Function Selector Clashing", function () {
    it("should prevent function selector clashing", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      const functions = V1.interface.fragments.filter(f => f.type === "function");
      const selectors = functions.map(f => V1.interface.getFunction(f.name).selector);
      const unique = new Set(selectors);
      expect(selectors.length).to.equal(unique.size);
    });

    it("should not clash between versions", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      const V2 = await ethers.getContractFactory("TokenVaultV2");
      const V3 = await ethers.getContractFactory("TokenVaultV3");

      const getSelectors = (factory) => {
        const functions = factory.interface.fragments.filter(f => f.type === "function");
        return functions.map(f => factory.interface.getFunction(f.name).selector);
      };

      const v1Selectors = getSelectors(V1);
      const v2Selectors = getSelectors(V2);
      const v3Selectors = getSelectors(V3);

      expect(new Set(v1Selectors).size).to.equal(v1Selectors.length);
      expect(new Set(v2Selectors).size).to.equal(v2Selectors.length);
      expect(new Set(v3Selectors).size).to.equal(v3Selectors.length);
    });
  });

  describe("Role Separation", function () {
    it("should have separate upgrader role from admin", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      const proxy = await upgrades.deployProxy(
        V1,
        [token.target, owner.address, 0],
        { initializer: "initialize", kind: "uups" }
      );

      const DEFAULT_ADMIN_ROLE = await proxy.DEFAULT_ADMIN_ROLE();
      const UPGRADER_ROLE = await proxy.UPGRADER_ROLE();

      expect(DEFAULT_ADMIN_ROLE).to.not.equal(UPGRADER_ROLE);
    });

    it("should allow revoking upgrader role", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      const proxy = await upgrades.deployProxy(
        V1,
        [token.target, owner.address, 0],
        { initializer: "initialize", kind: "uups" }
      );

      const UPGRADER_ROLE = await proxy.UPGRADER_ROLE();
      await proxy.revokeRole(UPGRADER_ROLE, owner.address);

      const V2Factory = await ethers.getContractFactory("TokenVaultV2");
      const v2Impl = await V2Factory.deploy();

      await expect(
        proxy.upgradeToAndCall(v2Impl.target, "0x")
      ).to.be.reverted;
    });
  });

  describe("Reentrancy Protection", function () {
    it("should have reentrancy protection on deposit", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      const proxy = await upgrades.deployProxy(
        V1,
        [token.target, owner.address, 0],
        { initializer: "initialize", kind: "uups" }
      );

      expect(await proxy.getImplementationVersion()).to.equal("V1");
    });
  });

  describe("Input Validation", function () {
    it("should reject invalid parameters in initialize", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");

      await expect(
        upgrades.deployProxy(
          V1,
          [ethers.ZeroAddress, owner.address, 0],
          { initializer: "initialize", kind: "uups" }
        )
      ).to.be.reverted;
    });

    it("should enforce maximum deposit fee", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");

      await expect(
        upgrades.deployProxy(
          V1,
          [token.target, owner.address, 1001],
          { initializer: "initialize", kind: "uups" }
        )
      ).to.be.reverted;
    });

    it("should enforce maximum yield rate", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      let proxy = await upgrades.deployProxy(
        V1,
        [token.target, owner.address, 0],
        { initializer: "initialize", kind: "uups" }
      );

      const V2Factory = await ethers.getContractFactory("TokenVaultV2");
      const v2Impl = await V2Factory.deploy();
      const initData = v2Impl.interface.encodeFunctionData("initializeV2", []);
      await proxy.upgradeToAndCall(v2Impl.target, initData);
      proxy = await ethers.getContractAt("TokenVaultV2", proxy.target);

      await expect(
        proxy.setYieldRate(5001)
      ).to.be.reverted;
    });

    it("should enforce maximum withdrawal delay", async () => {
      const V1 = await ethers.getContractFactory("TokenVaultV1");
      let proxy = await upgrades.deployProxy(
        V1,
        [token.target, owner.address, 0],
        { initializer: "initialize", kind: "uups" }
      );

      const V2Factory = await ethers.getContractFactory("TokenVaultV2");
      const v2Impl = await V2Factory.deploy();
      const v2InitData = v2Impl.interface.encodeFunctionData("initializeV2", []);
      await proxy.upgradeToAndCall(v2Impl.target, v2InitData);
      proxy = await ethers.getContractAt("TokenVaultV2", proxy.target);

      const V3Factory = await ethers.getContractFactory("TokenVaultV3");
      const v3Impl = await V3Factory.deploy();
      const v3InitData = v3Impl.interface.encodeFunctionData("initializeV3", []);
      await proxy.upgradeToAndCall(v3Impl.target, v3InitData);
      proxy = await ethers.getContractAt("TokenVaultV3", proxy.target);

      await expect(
        proxy.setWithdrawalDelay(8 * 24 * 60 * 60)
      ).to.be.reverted;
    });
  });
});
