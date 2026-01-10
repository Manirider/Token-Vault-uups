// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TokenVaultV1.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract TokenVaultV2 is TokenVaultV1 {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 public constant MAX_YIELD_RATE = 5000;

    uint256 internal yieldRate;
    bool internal depositsPaused;

    mapping(address => uint256) internal lastYieldClaim;

    event YieldRateUpdated(uint256 oldRate, uint256 newRate);
    event YieldClaimed(address indexed user, uint256 amount);
    event DepositsPaused(address indexed by);
    event DepositsUnpaused(address indexed by);

    error DepositsPausedError();
    error NoYield();
    error YieldRateTooHigh();
    error InsufficientYieldReserves();

    function initializeV2() external reinitializer(2) {
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    function setYieldRate(
        uint256 _yieldRate
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_yieldRate > MAX_YIELD_RATE) revert YieldRateTooHigh();
        emit YieldRateUpdated(yieldRate, _yieldRate);
        yieldRate = _yieldRate;
    }

    function getYieldRate() external view returns (uint256) {
        return yieldRate;
    }

    function pauseDeposits() external onlyRole(PAUSER_ROLE) {
        depositsPaused = true;
        emit DepositsPaused(msg.sender);
    }

    function unpauseDeposits() external onlyRole(PAUSER_ROLE) {
        depositsPaused = false;
        emit DepositsUnpaused(msg.sender);
    }

    function isDepositsPaused() external view returns (bool) {
        return depositsPaused;
    }

    function deposit(uint256 amount) external override nonReentrant {
        if (depositsPaused) revert DepositsPausedError();
        if (amount == 0) revert InvalidAmount();

        if (lastYieldClaim[msg.sender] == 0) {
            lastYieldClaim[msg.sender] = block.timestamp;
        }

        uint256 fee = (amount * depositFee) / 10_000;
        uint256 credited = amount - fee;

        token.safeTransferFrom(msg.sender, address(this), amount);

        balances[msg.sender] += credited;
        _totalDeposits += credited;
        _collectedFees += fee;

        emit Deposit(msg.sender, amount, credited, fee);
    }

    function claimYield() external nonReentrant returns (uint256) {
        uint256 yield = getUserYield(msg.sender);
        if (yield == 0) revert NoYield();

        uint256 available = token.balanceOf(address(this)) -
            _totalDeposits -
            _collectedFees;
        if (yield > available) revert InsufficientYieldReserves();

        lastYieldClaim[msg.sender] = block.timestamp;
        token.safeTransfer(msg.sender, yield);

        emit YieldClaimed(msg.sender, yield);
        return yield;
    }

    function getUserYield(address user) public view returns (uint256) {
        uint256 last = lastYieldClaim[user];
        if (last == 0 || balances[user] == 0) return 0;

        uint256 timeElapsed = block.timestamp - last;
        return (balances[user] * yieldRate * timeElapsed) / (365 days * 10_000);
    }

    function getImplementationVersion()
        external
        pure
        virtual
        override
        returns (string memory)
    {
        return "V2";
    }

    uint256[44] private __gap;
}
