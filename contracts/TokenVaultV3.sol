// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TokenVaultV2.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract TokenVaultV3 is TokenVaultV2 {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_WITHDRAWAL_DELAY = 7 days;

    uint256 internal withdrawalDelay;

    struct WithdrawalRequest {
        uint256 amount;
        uint256 requestTime;
    }

    mapping(address => WithdrawalRequest) internal withdrawalRequests;

    event WithdrawalDelayUpdated(uint256 oldDelay, uint256 newDelay);
    event WithdrawalRequested(
        address indexed user,
        uint256 amount,
        uint256 executeAfter
    );
    event WithdrawalRequestCancelled(address indexed user, uint256 amount);
    event WithdrawalExecuted(address indexed user, uint256 amount);
    event EmergencyWithdrawal(address indexed user, uint256 amount);

    error DelayTooLong();
    error NoWithdrawalRequest();
    error DelayNotPassed();
    error NothingToWithdraw();
    error DirectWithdrawDisabled();

    function initializeV3() external reinitializer(3) {}

    function withdraw(uint256) public pure override {
        revert DirectWithdrawDisabled();
    }

    function setWithdrawalDelay(
        uint256 _delay
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_delay > MAX_WITHDRAWAL_DELAY) revert DelayTooLong();
        emit WithdrawalDelayUpdated(withdrawalDelay, _delay);
        withdrawalDelay = _delay;
    }

    function getWithdrawalDelay() external view returns (uint256) {
        return withdrawalDelay;
    }

    function requestWithdrawal(uint256 amount) external nonReentrant {
        if (balances[msg.sender] < amount) revert InsufficientBalance();
        if (amount == 0) revert InvalidAmount();

        WithdrawalRequest memory existing = withdrawalRequests[msg.sender];
        if (existing.amount > 0) {
            emit WithdrawalRequestCancelled(msg.sender, existing.amount);
        }

        withdrawalRequests[msg.sender] = WithdrawalRequest({
            amount: amount,
            requestTime: block.timestamp
        });

        emit WithdrawalRequested(
            msg.sender,
            amount,
            block.timestamp + withdrawalDelay
        );
    }

    function executeWithdrawal() external nonReentrant returns (uint256) {
        WithdrawalRequest memory req = withdrawalRequests[msg.sender];

        if (req.amount == 0) revert NoWithdrawalRequest();
        if (block.timestamp < req.requestTime + withdrawalDelay)
            revert DelayNotPassed();
        if (balances[msg.sender] < req.amount) revert InsufficientBalance();

        delete withdrawalRequests[msg.sender];

        balances[msg.sender] -= req.amount;
        _totalDeposits -= req.amount;

        token.safeTransfer(msg.sender, req.amount);

        emit WithdrawalExecuted(msg.sender, req.amount);
        return req.amount;
    }

    function emergencyWithdraw() external nonReentrant returns (uint256) {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        delete withdrawalRequests[msg.sender];

        balances[msg.sender] = 0;
        _totalDeposits -= amount;

        token.safeTransfer(msg.sender, amount);

        emit EmergencyWithdrawal(msg.sender, amount);
        return amount;
    }

    function getWithdrawalRequest(
        address user
    ) external view returns (uint256 amount, uint256 requestTime) {
        WithdrawalRequest memory r = withdrawalRequests[user];
        return (r.amount, r.requestTime);
    }

    function getImplementationVersion()
        external
        pure
        override
        returns (string memory)
    {
        return "V3";
    }

    uint256[44] private __gap;
}
