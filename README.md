# TokenVault UUPS Upgradeable Smart Contract System

A production-grade upgradeable smart contract system implementing a TokenVault protocol using the UUPS (Universal Upgradeable Proxy Standard) pattern with role-based access control, yield generation, and withdrawal delays.

## Features

### V1 - Core Vault
- Secure token deposits and withdrawals
- Configurable deposit fees (basis points)
- Role-based access control (Admin, Upgrader)
- UUPS upgradeability

### V2 - Yield Generation
- Configurable yield rate (up to 50% annually)
- Time-based yield calculation
- Deposit pause functionality
- PAUSER_ROLE for pause control

### V3 - Withdrawal Controls
- Configurable withdrawal delay (up to 7 days)
- Request → Execute withdrawal flow
- Emergency withdrawal (bypasses delay)
- Full state preservation from V1/V2

## Architecture

### Contract Inheritance


TokenVaultV1 (Base)
├── Initializable
├── UUPSUpgradeable
├── AccessControlUpgradeable
└── ReentrancyGuardUpgradeable
      │
TokenVaultV2 (extends V1)
└── Adds: yield calculation, pause functionality
      │
TokenVaultV3 (extends V2)
└── Adds: withdrawal delay, emergency withdraw


### Storage Layout Strategy

Each version maintains storage layout compatibility through:

1. **Inheritance Chain**: Child contracts extend parent without modifying parent storage
2. **Storage Gaps**: Each contract includes `__gap` arrays for future upgrades
3. **Append-Only**: New variables are always appended after parent's storage


V1 Storage:
├── OZ Internals (~50 slots)
├── token, depositFee, _totalDeposits, _collectedFees
├── balances mapping
└── __gap[44]

V2 Storage (extends V1):
├── yieldRate, depositsPaused
├── lastYieldClaim mapping
└── __gap[44]

V3 Storage (extends V2):
├── withdrawalDelay
├── withdrawalRequests mapping
└── __gap[44]


### Access Control

| Role | Permissions | Default Holder |
|------|-------------|----------------|
| `DEFAULT_ADMIN_ROLE` | Grant/revoke roles, set yield rate, set withdrawal delay | Deployer |
| `UPGRADER_ROLE` | Perform UUPS upgrades | Deployer |
| `PAUSER_ROLE` | Pause/unpause deposits | Set in initializeV2() |

> **Production Recommendation**: In production, `UPGRADER_ROLE` should be held by a TimelockController controlled by a multi-sig (e.g., Gnosis Safe) with at least 24-hour delay.

## Installation

- bash
npm install


## Compile

- bash
npx hardhat compile


## Test

- bash
# Run all tests
npx hardhat test

# Run with gas reporting
REPORT_GAS=true npx hardhat test

# Run test coverage
npx hardhat coverage


## Deploy

### Local Development

-bash
# Start local node
npx hardhat node

# Deploy V1 (in another terminal)
npx hardhat run scripts/deploy-v1.js --network localhost

# Upgrade to V2
npx hardhat run scripts/upgrade-to-v2.js --network localhost

# Upgrade to V3
npx hardhat run scripts/upgrade-to-v3.js --network localhost

### Testnet Deployment

- bash
# Deploy to Sepolia (requires .env with SEPOLIA_RPC_URL and PRIVATE_KEY)
npx hardhat run scripts/deploy-v1.js --network sepolia


## Business Logic

### Deposit Fee Calculation

creditedAmount = depositAmount - (depositAmount * depositFee / 10000)


Example: 1000 tokens with 5% (500 basis points) fee → 950 tokens credited

### Yield Calculation

yield = (userBalance * yieldRate * timeElapsed) / (365 days * 10000)


- `yieldRate` is in basis points (500 = 5% annual)
- Yield is non-compounding
- Users must call `claimYield()` to receive accrued yield

### Withdrawal Delay Flow

1. User calls `requestWithdrawal(amount)`
2. Wait for `withdrawalDelay` seconds
3. User calls `executeWithdrawal()` to receive funds

**Emergency Exit**: Users can always call `emergencyWithdraw()` to exit immediately with their full balance.

## Security Features

### Implemented
-  `_disableInitializers()` in all implementation constructors
-  `reinitializer(n)` for multi-step upgrades
-  Separate `UPGRADER_ROLE` from admin
-  `nonReentrant` on all state-changing external functions
-  SafeERC20 for token transfers
-  Input validation with maximum bounds
-  CEI (Checks-Effects-Interactions) pattern
-  Custom errors for gas-efficient reverts
-  Events for all state changes
-  V3 blocks direct `withdraw()` to enforce delay mechanism
-  Admin-only `withdrawFees()` function

## Design Decisions

### Why UUPS over Transparent Proxy?
UUPS places upgrade logic in the implementation contract, reducing proxy deployment cost and simplifying the proxy itself. The trade-off is that a buggy upgrade can brick the contract, but this is mitigated by thorough testing and role-based upgrade authorization.

### Why Emergency Withdrawal Bypasses Delay?
User fund accessibility is paramount. If the protocol is compromised or experiences issues, users must be able to exit immediately. This design prioritizes user sovereignty over protocol-controlled delays. Emergency withdrawals are logged with distinct events for monitoring.

### Why Non-Compounding Yield?
Simpler accounting with predictable gas costs. Auto-reinvestment adds complexity and potential attack vectors. Users who want compound growth can claim and re-deposit.

### Why Block Direct `withdraw()` in V3?
In an upgrade scenario, inherited functions remain callable unless explicitly overridden. Without blocking `withdraw()`, users could bypass the withdrawal delay mechanism entirely—defeating its purpose.

## Protocol Invariants

These conditions must always hold:

1. `token.balanceOf(vault) >= _totalDeposits + _collectedFees`
2. Sum of all `balances[user]` == `_totalDeposits`
3. Only `UPGRADER_ROLE` can authorize upgrades
4. Implementation contracts cannot be initialized directly
5. In V3, funds can only exit via `executeWithdrawal()` or `emergencyWithdraw()`

## Production Deployment Checklist

- Deploy `TimelockController` (24-48h minimum delay)
- Deploy MultiSig wallet (e.g., Gnosis Safe 3/5)
- Transfer `UPGRADER_ROLE` to TimelockController
- Transfer `DEFAULT_ADMIN_ROLE` to MultiSig
- Revoke deployer's roles
- Verify all contracts on Etherscan/Blockscout
- Complete external security audit
- Set up event monitoring (e.g., Tenderly, OpenZeppelin Defender)
- Document emergency procedures
- Test upgrade path on testnet before mainnet

## Known Limitations

1. **Yield Source**: Yield comes from contract reserves; no external yield generation
2. **Single Pending Withdrawal**: Only one withdrawal request per user at a time
3. **Emergency Withdraw**: Available to all users without restriction (by design)

## Test Coverage

**96 passing tests** covering:
- Core deposit/withdraw functionality
- V1 → V2 → V3 upgrade paths
- State preservation across upgrades
- Storage layout validation
- Access control enforcement
- Security attack vectors
- Edge cases and error handling

## File Structure

token-vault-uups/
├── contracts/
│   ├── TokenVaultV1.sol      # Base vault with deposit/withdraw/fees
│   ├── TokenVaultV2.sol      # Adds yield and pause
│   ├── TokenVaultV3.sol      # Adds withdrawal delay, blocks direct withdraw
│   └── mocks/
│       └── MockERC20.sol     # Test token
├── test/
│   ├── TokenVaultV1.test.js
│   ├── upgrade-v1-to-v2.test.js
│   ├── upgrade-v2-to-v3.test.js
│   └── security.test.js
├── scripts/
│   ├── deploy-v1.js
│   ├── upgrade-to-v2.js
│   └── upgrade-to-v3.js
├── hardhat.config.js
├── package.json
└── submission.yml


## License


MIT License © 2026 

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files to use, copy, modify,
merge, publish, distribute, sublicense, and/or sell copies of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.


## Author

MAnikanta Suryasai
AIML Engineer| Blockchain Developer

Specialized in Upgradeable Smart Contracts (UUPS), DeFi Protocol Architecture, and Production-Grade Solidity Systems.

This project was designed and implemented as a production-level upgradeable smart contract system, focusing on security, upgrade safety, and real-world DeFi protocol engineering practices.
