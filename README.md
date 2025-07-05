# 🚀 $ABLE Token – Utility Token for Tradable & SenseAI

Welcome to the public repository for the $ABLE token — the native utility token powering the Tradable platform and SenseAI, a decentralised AI analyst for crypto traders.

$ABLE is an ERC-20 token deployed on [Base](https://base.org), bridged to [NEAR](https://near.org) as a NEP-141 token, and used as the base currency on our [Aurora Virtual Chain](https://aurora.dev). It enables verifiable, gas-abstracted AI interactions while serving as the core utility token across our ecosystem.

---

## 🔍 What is $ABLE?

$ABLE supports a tokenised ecosystem for advanced trading and AI services:

- 💬 **AI Query Payments** – Pay-per-insight for SenseAI’s real-time market analysis.
- ⚙️ **Smart Contract Interactions** – Powering portfolio automation, AI agents, and service usage fees.
- 🧠 **Staking & Governance** _(coming soon)_ – Participate in decision-making and earn ecosystem rewards.
- 🧬 **Gas Abstraction** – On Aurora, $ABLE acts as the gas token for a seamless, Web2-like UX.

---

## 📦 Features

- Compliant ERC-20 with fixed supply cap
- Built with [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts)
- Upgradeable using the UUPS proxy pattern
- Cross-chain ready: Base → NEAR → Aurora VC
- Fully tested with Hardhat
- Open-source under the MIT License

---

## 🧪 Usage

### Prerequisites

1. Create a `.env.testnet` file (see `.env.example`) with the following:

```env
PRIVATE_KEY=your_private_key
BASE_SEPOLIA_RPC=https://sepolia.base.org
BASE_SEPOLIA_CHAIN_ID=84532
INITIAL_SUPPLY=1000000000000000000000000000
OWNER_ADDRESS=your_wallet_address
ETHERSCAN_API_KEY=your_etherscan_api_key
```

2. Install dependencies:

```bash
npm install
```
