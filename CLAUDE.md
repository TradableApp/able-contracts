# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Solidity smart contracts for the Tradable platform. The primary contract is `AbleToken` — a UUPS-upgradeable ERC20 token deployed on Base mainnet and Base Sepolia. Uses Hardhat for compilation, testing, and deployment.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run compile` | Compile contracts (always run before test) |
| `npm run test` | Run full test suite |
| `npm run coverage` | Generate coverage report |
| `npm run lint` | Lint Solidity with solhint |
| `npm run format` | Format contracts with prettier-plugin-solidity |
| `npm run deploy:localnet` | Deploy to local Hardhat node (`ENV_FILE=.env.localnet`) |
| `npm run deploy:testnet` | Deploy to Base Sepolia (`ENV_FILE=.env.testnet`) |
| `npm run deploy:testable` | Deploy "testable" variant to Base mainnet (`ENV_FILE=.env.testable`) |
| `npm run deploy:mainnet` | Deploy ABLE to Base mainnet (`ENV_FILE=.env.mainnet`) |

**Run a single test file:**
```bash
npx hardhat test test/AbleToken.test.js
```

**Run with gas reporting:**
```bash
REPORT_GAS=true npm run test
```

## Architecture

### Contract

`contracts/AbleToken.sol` is the only production contract. It inherits from OpenZeppelin v5 upgradeable contracts:

- `ERC20Upgradeable` + `ERC20BurnableUpgradeable` + `ERC20PausableUpgradeable`
- `OwnableUpgradeable` — all privileged operations (pause, upgrade) are `onlyOwner`
- `UUPSUpgradeable` — upgrade authorization lives in the implementation, not the proxy

Storage uses EIP-7201 namespaced slots (`erc7201:openzeppelin.storage.AbleToken`) to prevent storage collisions across upgrades. The contract also carries a `uint256[50] private __gap` for non-namespaced inheritance slots.

`contracts/test/AbleTokenV2.sol` is a test-only stub used to exercise the upgrade path. It is not deployed to production.

### Deployment

`scripts/deploy.js` deploys via `@openzeppelin/hardhat-upgrades` as a UUPS proxy. All token parameters (`TOKEN_NAME`, `TOKEN_SYMBOL`, `INITIAL_SUPPLY`, `OWNER_ADDRESS`) are read from environment variables.

**Environment loading order** (set in `hardhat.config.js`):
1. `ENV_FILE` path is loaded first (network-specific vars take precedence)
2. `.env` is loaded second (fills any missing vars)

OpenZeppelin maintains a deployment manifest in `.openzeppelin/` (e.g. `base-sepolia.json`, `base.json`) tracking proxy addresses, implementation addresses, and storage layout per network.

### Networks

| Network key | Chain | Use |
|-------------|-------|-----|
| `hardhat` | 31337 | Default — fast in-process testing |
| `localhost` | 31337 | Local `hardhat node` (for `deploy:localnet`) |
| `baseSepolia` | 84532 | Testnet |
| `base` | 8453 | Mainnet |

## Test Suite

Five test files live in `test/`:

| File | Coverage |
|------|----------|
| `AbleToken.test.js` | Full suite: deployment, ERC20 core, approve/transferFrom, burn/burnFrom, pause, ownership, upgradeability (AbleTokenV2 UUPS path) |
| `AbleToken.erc20.test.js` | ERC20 edge cases: MaxUint256 allowance, balance/allowance conflict, transferFrom allowance deduction |
| `AbleToken.pausable.test.js` | Pause lifecycle, non-owner reverts, transfer/burn blocked while paused |
| `AbleToken.mintburn.test.js` | Burn/burnFrom, deployment-receipt Transfer-from-zero event, total-supply accounting |
| `AbleToken.escrowFlow.test.js` | Simulates the EVMAIAgentEscrow payment pattern: approve → transferFrom → SpendingLimit-style repeated deductions → refund via transfer-back |

`AbleToken.erc20.test.js`, `AbleToken.pausable.test.js`, `AbleToken.mintburn.test.js`, and `AbleToken.escrowFlow.test.js` use the **`loadFixture`** pattern from `@nomicfoundation/hardhat-network-helpers` for EVM snapshot-based isolation (faster than re-deploying in every `beforeEach`).

`contracts/test/AbleTokenV2.sol` is a test-only stub used to exercise the UUPS upgrade path — it is never deployed to production.

## Cross-Repo Context

AbleToken is the **payment token** for the SenseAI protocol. `EVMAIAgentEscrow` (in `tokenized-ai-agent`) calls `token.transferFrom(user, escrow, amount)` when processing prompts. AbleToken uses standard OpenZeppelin ERC20 with no custom transfer restrictions, fees, or non-standard pause behaviour — Escrow's payment flow depends on this.

### ABI consumers

After `npm run compile`, ABI artifacts are consumed by two sibling repos:

1. **`sense-ai-dapp`** — run `npm run sync-contracts` in `sense-ai-dapp/` to copy ABI JSON files into `src/lib/abi/`. Always compile here first before syncing.
2. **`sense-ai-subgraph`** — `abis/AbleToken.json` must also be kept in sync if AbleToken events are ever indexed (currently not indexed — only `EVMAIAgent` and `EVMAIAgentEscrow` events are).

## Key Notes

- `deploy:mainnet` is irreversible — confirm intent before running
- ABI artifacts from this repo are consumed by `sense-ai-dapp` via its `sync-contracts` script
- `hardhat-storage-layout` is enabled; `npm run compile` emits storage layout data to `storageLayout/`
- The `storageLayout.check: true` config in `hardhat.config.js` validates layout compatibility on each compile — this is what catches unsafe upgrades early

## MCP Tools

Tradable ClickUp MCP is available for task management.
