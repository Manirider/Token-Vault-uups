# Token-Vault-uups

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=white) ![License](https://img.shields.io/github/license/Manirider/Token-Vault-uups?style=flat-square) ![Last Commit](https://img.shields.io/github/last-commit/Manirider/Token-Vault-uups?style=flat-square) ![Issues](https://img.shields.io/github/issues/Manirider/Token-Vault-uups?style=flat-square)

`portfolio-project`

## Project Overview

An upgradeable token vault implementation using the UUPS (UUPS Proxy) pattern. Built to support future logic upgrades without changing contract state or storage layouts.

## Core Features

- Solidity contracts implementing the UUPS upgradeable proxy pattern.
- Role-based access control (RBAC) securing upgrade functions.
- Upgrade-safe storage layout checks preventing state collisions.
- Hardhat scripts deploying proxy instances and testing upgrades.
- Gas optimization patterns reducing deployment overhead.

## Technical Flow & Execution

Users deposit and withdraw tokens through the proxy contract. Admins can upgrade the implementation contract logic while preserving all user balances and states.

## Getting Started

### Requirements

- Node.js version 18 or above
- Npm or Yarn package manager

### Environment Configuration

```bash
# Clone this repository
git clone https://github.com/Manirider/Token-Vault-uups.git
cd Token-Vault-uups

# Install packages
npm install
```

### Execution

```bash
# Start the local development server
npm run dev

# Run target tests
npm run test
```

## Directory Layout

```
Token-Vault-uups/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── SECURITY.md
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── PULL_REQUEST_TEMPLATE.md
└── (source files)
```

## Contributing to the Project

I welcome issues and pull requests to make this project better. Please see the detailed guidelines in the [Contributing Guide](CONTRIBUTING.md).

## Project License

This repository is distributed under the MIT License. For complete terms, see the [LICENSE](LICENSE) file.

Developed by [S. Manikanta Suryasai](https://github.com/Manirider)
