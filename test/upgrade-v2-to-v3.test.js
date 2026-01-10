const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Upgrade V2 to V3", function () {
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

        const V2Factory = await ethers.getContractFactory("TokenVaultV2");
        const v2Impl = await V2Factory.deploy();
        const v2InitData = v2Impl.interface.encodeFunctionData("initializeV2", []);
        await vault.upgradeToAndCall(v2Impl.target, v2InitData);
        vault = await ethers.getContractAt("TokenVaultV2", vault.target);

        await vault.setYieldRate(500);

        const V3Factory = await ethers.getContractFactory("TokenVaultV3");
        const v3Impl = await V3Factory.deploy();
        const v3InitData = v3Impl.interface.encodeFunctionData("initializeV3", []);
        await vault.upgradeToAndCall(v3Impl.target, v3InitData);
        vault = await ethers.getContractAt("TokenVaultV3", vault.target);

        await token.transfer(user.address, ethers.parseEther("10000"));
        await token.connect(user).approve(vault.target, ethers.parseEther("10000"));
        await vault.connect(user).deposit(1000);
    });

    describe("State Preservation", function () {
        it("should preserve all V2 state after upgrade", async () => {
            expect(await vault.balanceOf(user.address)).to.equal(1000);
            expect(await vault.totalDeposits()).to.equal(1000);
            expect(await vault.getYieldRate()).to.equal(500);
        });

        it("should preserve admin roles after upgrade", async () => {
            const DEFAULT_ADMIN_ROLE = await vault.DEFAULT_ADMIN_ROLE();
            expect(await vault.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
        });

        it("should preserve pause state after upgrade", async () => {
    
            const V1 = await ethers.getContractFactory("TokenVaultV1");
            let testVault = await upgrades.deployProxy(
                V1,
                [token.target, owner.address, 0],
                { initializer: "initialize", kind: "uups" }
            );

            const V2Factory = await ethers.getContractFactory("TokenVaultV2");
            const v2Impl = await V2Factory.deploy();
            const v2InitData = v2Impl.interface.encodeFunctionData("initializeV2", []);
            await testVault.upgradeToAndCall(v2Impl.target, v2InitData);
            testVault = await ethers.getContractAt("TokenVaultV2", testVault.target);
            await testVault.pauseDeposits();

            const V3Factory = await ethers.getContractFactory("TokenVaultV3");
            const v3Impl = await V3Factory.deploy();
            const v3InitData = v3Impl.interface.encodeFunctionData("initializeV3", []);
            await testVault.upgradeToAndCall(v3Impl.target, v3InitData);
            testVault = await ethers.getContractAt("TokenVaultV3", testVault.target);

            expect(await testVault.isDepositsPaused()).to.be.true;
        });
    });

    describe("Withdrawal Delay", function () {
        it("should allow setting withdrawal delay", async () => {
            await vault.setWithdrawalDelay(100);
            expect(await vault.getWithdrawalDelay()).to.equal(100);
        });

        it("should emit WithdrawalDelayUpdated event", async () => {
            await expect(vault.setWithdrawalDelay(100))
                .to.emit(vault, "WithdrawalDelayUpdated")
                .withArgs(0, 100);
        });

        it("should prevent non-admin from setting delay", async () => {
            await expect(
                vault.connect(user).setWithdrawalDelay(100)
            ).to.be.reverted;
        });

        it("should reject delay exceeding maximum", async () => {
            const maxDelay = await vault.MAX_WITHDRAWAL_DELAY();
            await expect(
                vault.setWithdrawalDelay(maxDelay + 1n)
            ).to.be.reverted;
        });
    });

    describe("Withdrawal Requests", function () {
        it("should handle withdrawal requests correctly", async () => {
            await vault.connect(user).requestWithdrawal(500);
            const req = await vault.getWithdrawalRequest(user.address);
            expect(req.amount).to.equal(500);
            expect(req.requestTime).to.be.gt(0);
        });

        it("should emit WithdrawalRequested event", async () => {
            await expect(vault.connect(user).requestWithdrawal(500))
                .to.emit(vault, "WithdrawalRequested");
        });

        it("should reject withdrawal request for zero amount", async () => {
            await expect(
                vault.connect(user).requestWithdrawal(0)
            ).to.be.reverted;
        });

        it("should reject withdrawal request exceeding balance", async () => {
            await expect(
                vault.connect(user).requestWithdrawal(2000)
            ).to.be.reverted;
        });

        it("should cancel previous request when new one is made", async () => {
            await vault.connect(user).requestWithdrawal(300);

            await expect(vault.connect(user).requestWithdrawal(500))
                .to.emit(vault, "WithdrawalRequestCancelled")
                .withArgs(user.address, 300);

            const req = await vault.getWithdrawalRequest(user.address);
            expect(req.amount).to.equal(500);
        });
    });

    describe("Withdrawal Execution", function () {
        it("should enforce withdrawal delay", async () => {
            await vault.setWithdrawalDelay(100);
            await vault.connect(user).requestWithdrawal(500);

            await expect(
                vault.connect(user).executeWithdrawal()
            ).to.be.reverted;
        });

        it("should prevent premature withdrawal execution", async () => {
            await vault.setWithdrawalDelay(100);
            await vault.connect(user).requestWithdrawal(500);

            await ethers.provider.send("evm_increaseTime", [50]);
            await ethers.provider.send("evm_mine");

            await expect(
                vault.connect(user).executeWithdrawal()
            ).to.be.reverted;
        });

        it("should allow withdrawal after delay passes", async () => {
            await vault.setWithdrawalDelay(100);
            await vault.connect(user).requestWithdrawal(500);

            await ethers.provider.send("evm_increaseTime", [101]);
            await ethers.provider.send("evm_mine");

            const balanceBefore = await token.balanceOf(user.address);
            await vault.connect(user).executeWithdrawal();
            const balanceAfter = await token.balanceOf(user.address);

            expect(balanceAfter - balanceBefore).to.equal(500);
            expect(await vault.balanceOf(user.address)).to.equal(500);
        });

        it("should emit WithdrawalExecuted event", async () => {
            await vault.connect(user).requestWithdrawal(500);

            await expect(vault.connect(user).executeWithdrawal())
                .to.emit(vault, "WithdrawalExecuted")
                .withArgs(user.address, 500);
        });

        it("should clear request after execution", async () => {
            await vault.connect(user).requestWithdrawal(500);
            await vault.connect(user).executeWithdrawal();

            const req = await vault.getWithdrawalRequest(user.address);
            expect(req.amount).to.equal(0);
        });

        it("should reject execution without request", async () => {
            await expect(
                vault.connect(user).executeWithdrawal()
            ).to.be.reverted;
        });

        it("should reject if balance decreased after request", async () => {
            await vault.connect(user).requestWithdrawal(1000);
            await vault.connect(user).emergencyWithdraw();

            await expect(
                vault.connect(user).executeWithdrawal()
            ).to.be.reverted;
        });
    });

    describe("Emergency Withdrawal", function () {
        it("should allow emergency withdrawals", async () => {
            const balanceBefore = await token.balanceOf(user.address);
            const vaultBalance = await vault.balanceOf(user.address);

            await vault.connect(user).emergencyWithdraw();

            const balanceAfter = await token.balanceOf(user.address);
            expect(balanceAfter - balanceBefore).to.equal(vaultBalance);
        });

        it("should emit EmergencyWithdrawal event", async () => {
            await expect(vault.connect(user).emergencyWithdraw())
                .to.emit(vault, "EmergencyWithdrawal")
                .withArgs(user.address, 1000);
        });

        it("should bypass withdrawal delay", async () => {
            await vault.setWithdrawalDelay(86400);
            await vault.connect(user).requestWithdrawal(500);

            await vault.connect(user).emergencyWithdraw();
            expect(await vault.balanceOf(user.address)).to.equal(0);
        });

        it("should clear pending withdrawal request", async () => {
            await vault.connect(user).requestWithdrawal(500);
            await vault.connect(user).emergencyWithdraw();

            const req = await vault.getWithdrawalRequest(user.address);
            expect(req.amount).to.equal(0);
        });

        it("should reject emergency withdraw with zero balance", async () => {
            await vault.connect(user).emergencyWithdraw();
            await expect(
                vault.connect(user).emergencyWithdraw()
            ).to.be.reverted;
        });

        it("should withdraw full balance", async () => {
            const amount = await vault.connect(user).emergencyWithdraw.staticCall();
            expect(amount).to.equal(1000);
        });
    });

    describe("Version", function () {
        it("should return V3 version", async () => {
            expect(await vault.getImplementationVersion()).to.equal("V3");
        });
    });

    describe("V2 Features Still Work", function () {
        it("should still allow yield operations", async () => {
            await vault.setYieldRate(1000);
            expect(await vault.getYieldRate()).to.equal(1000);
        });

        it("should still allow pause operations", async () => {
            await vault.pauseDeposits();
            expect(await vault.isDepositsPaused()).to.be.true;
        });
    });

    describe("Direct Withdraw Protection", function () {
        it("should block direct withdraw() calls in V3", async () => {
            await expect(
                vault.connect(user).withdraw(100)
            ).to.be.revertedWithCustomError(vault, "DirectWithdrawDisabled");
        });

        it("should enforce using requestWithdrawal flow", async () => {
            await vault.connect(user).requestWithdrawal(500);
            await vault.connect(user).executeWithdrawal();
            expect(await vault.balanceOf(user.address)).to.equal(500);
        });
    });

    describe("Fee Withdrawal", function () {
        beforeEach(async () => {
            const V1 = await ethers.getContractFactory("TokenVaultV1");
            let testVault = await upgrades.deployProxy(
                V1,
                [token.target, owner.address, 500], // 5% fee
                { initializer: "initialize", kind: "uups" }
            );

            const V2Factory = await ethers.getContractFactory("TokenVaultV2");
            const v2Impl = await V2Factory.deploy();
            const v2InitData = v2Impl.interface.encodeFunctionData("initializeV2", []);
            await testVault.upgradeToAndCall(v2Impl.target, v2InitData);
            testVault = await ethers.getContractAt("TokenVaultV2", testVault.target);

            const V3Factory = await ethers.getContractFactory("TokenVaultV3");
            const v3Impl = await V3Factory.deploy();
            const v3InitData = v3Impl.interface.encodeFunctionData("initializeV3", []);
            await testVault.upgradeToAndCall(v3Impl.target, v3InitData);
            vault = await ethers.getContractAt("TokenVaultV3", testVault.target);

            await token.transfer(user.address, 1000);
            await token.connect(user).approve(vault.target, 1000);
            await vault.connect(user).deposit(1000);
        });

        it("should allow admin to withdraw collected fees", async () => {
            const fees = await vault.getCollectedFees();
            expect(fees).to.equal(50); // 5% of 1000

            const balanceBefore = await token.balanceOf(owner.address);
            await vault.withdrawFees(owner.address);
            const balanceAfter = await token.balanceOf(owner.address);

            expect(balanceAfter - balanceBefore).to.equal(50);
            expect(await vault.getCollectedFees()).to.equal(0);
        });

        it("should emit FeesWithdrawn event", async () => {
            await expect(vault.withdrawFees(owner.address))
                .to.emit(vault, "FeesWithdrawn")
                .withArgs(owner.address, 50);
        });

        it("should prevent non-admin from withdrawing fees", async () => {
            await expect(
                vault.connect(user).withdrawFees(user.address)
            ).to.be.reverted;
        });

        it("should revert when no fees to withdraw", async () => {
            await vault.withdrawFees(owner.address);
            await expect(
                vault.withdrawFees(owner.address)
            ).to.be.revertedWithCustomError(vault, "NoFeesToWithdraw");
        });
    });

    describe("Emergency Withdrawal When Paused", function () {
        it("should allow emergency withdrawal even when deposits paused", async () => {
            await vault.pauseDeposits();
            expect(await vault.isDepositsPaused()).to.be.true;

            await vault.connect(user).emergencyWithdraw();
            expect(await vault.balanceOf(user.address)).to.equal(0);
        });

        it("should still allow yield claiming when paused", async () => {
            await vault.setYieldRate(1000);
            await token.mint(vault.target, ethers.parseEther("1000"));

            await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await vault.pauseDeposits();
            await vault.connect(user).claimYield();
        });
    });
});
