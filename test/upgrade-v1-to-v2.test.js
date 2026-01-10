const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Upgrade V1 to V2", function () {
    let token, vault, owner, user;

    beforeEach(async () => {
        [owner, user] = await ethers.getSigners();

        const Token = await ethers.getContractFactory("MockERC20");
        token = await Token.deploy();

        const V1 = await ethers.getContractFactory("TokenVaultV1");
        vault = await upgrades.deployProxy(
            V1,
            [token.target, owner.address, 0],
            { initializer: "initialize", kind: "uups" }
        );

        await token.transfer(user.address, ethers.parseEther("10000"));
        await token.connect(user).approve(vault.target, ethers.parseEther("10000"));
        await vault.connect(user).deposit(1000);

        const V2Factory = await ethers.getContractFactory("TokenVaultV2");
        const v2Impl = await V2Factory.deploy();

        const initData = v2Impl.interface.encodeFunctionData("initializeV2", []);
        await vault.upgradeToAndCall(v2Impl.target, initData);

        vault = await ethers.getContractAt("TokenVaultV2", vault.target);
    });

    describe("State Preservation", function () {
        it("should preserve user balances after upgrade", async () => {
            expect(await vault.balanceOf(user.address)).to.equal(1000);
        });

        it("should preserve total deposits after upgrade", async () => {
            expect(await vault.totalDeposits()).to.equal(1000);
        });

        it("should maintain admin access control after upgrade", async () => {
            await vault.setYieldRate(500);
            expect(await vault.getYieldRate()).to.equal(500);
        });

        it("should preserve token address after upgrade", async () => {
            expect(await vault.getToken()).to.equal(token.target);
        });
    });

    describe("Yield Rate", function () {
        it("should allow setting yield rate in V2", async () => {
            await vault.setYieldRate(1000);
            expect(await vault.getYieldRate()).to.equal(1000);
        });

        it("should emit YieldRateUpdated event", async () => {
            await expect(vault.setYieldRate(1000))
                .to.emit(vault, "YieldRateUpdated")
                .withArgs(0, 1000);
        });

        it("should prevent non-admin from setting yield rate", async () => {
            await expect(
                vault.connect(user).setYieldRate(100)
            ).to.be.reverted;
        });

        it("should reject yield rate exceeding maximum", async () => {
            await expect(
                vault.setYieldRate(5001)
            ).to.be.reverted;
        });
    });

    describe("Yield Calculation", function () {
        it("should calculate yield correctly", async () => {
            await vault.setYieldRate(1000);
            await vault.connect(user).deposit(1000);

            await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            const yieldAmount = await vault.getUserYield(user.address);
            expect(yieldAmount).to.be.closeTo(200n, 10n);
        });

        it("should return 0 yield for users without initialized tracking", async () => {
            const [, , user2] = await ethers.getSigners();
            expect(await vault.getUserYield(user2.address)).to.equal(0);
        });

        it("should return 0 yield for users with zero balance", async () => {
            await vault.connect(user).deposit(100);
            await vault.connect(user).withdraw(1100);

            await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            expect(await vault.getUserYield(user.address)).to.equal(0);
        });

        it("should initialize yield tracking on first V2 deposit", async () => {
            const [, , user2] = await ethers.getSigners();
            await token.transfer(user2.address, 1000);
            await token.connect(user2).approve(vault.target, 1000);
            await vault.connect(user2).deposit(500);

            await vault.setYieldRate(1000);

            await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            const yieldAmount = await vault.getUserYield(user2.address);
            expect(yieldAmount).to.be.gt(0);
        });
    });

    describe("Yield Claiming", function () {
        beforeEach(async () => {
            await vault.setYieldRate(1000);
            await vault.connect(user).deposit(1000);
            await token.mint(vault.target, ethers.parseEther("1000"));

            await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
        });

        it("should allow claiming yield", async () => {
            const balanceBefore = await token.balanceOf(user.address);
            await vault.connect(user).claimYield();
            const balanceAfter = await token.balanceOf(user.address);

            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("should emit YieldClaimed event", async () => {
            await expect(vault.connect(user).claimYield())
                .to.emit(vault, "YieldClaimed");
        });

        it("should reset yield after claim", async () => {
            await vault.connect(user).claimYield();
            expect(await vault.getUserYield(user.address)).to.equal(0);
        });

        it("should revert when no yield to claim", async () => {
            await vault.connect(user).claimYield();
            await expect(
                vault.connect(user).claimYield()
            ).to.be.reverted;
        });
    });

    describe("Pause Functionality", function () {
        it("should allow pausing deposits in V2", async () => {
            await vault.pauseDeposits();
            expect(await vault.isDepositsPaused()).to.be.true;

            await expect(
                vault.connect(user).deposit(100)
            ).to.be.reverted;
        });

        it("should emit DepositsPaused event", async () => {
            await expect(vault.pauseDeposits())
                .to.emit(vault, "DepositsPaused")
                .withArgs(owner.address);
        });

        it("should allow unpausing deposits", async () => {
            await vault.pauseDeposits();
            await vault.unpauseDeposits();

            expect(await vault.isDepositsPaused()).to.be.false;
            await vault.connect(user).deposit(100);
        });

        it("should allow withdrawals even when paused", async () => {
            await vault.pauseDeposits();
            await vault.connect(user).withdraw(500);
            expect(await vault.balanceOf(user.address)).to.equal(500);
        });

        it("should prevent non-pauser from pausing", async () => {
            await expect(
                vault.connect(user).pauseDeposits()
            ).to.be.reverted;
        });
    });

    describe("Version", function () {
        it("should return V2 version", async () => {
            expect(await vault.getImplementationVersion()).to.equal("V2");
        });
    });
});
