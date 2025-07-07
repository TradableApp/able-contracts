# Bridging and Virtual Chain Integration for \$ABLE Token

This document outlines the full lifecycle of deploying and bridging the \$ABLE token from Base to NEAR, setting it as the native token for your Aurora Virtual Chain, deploying smart contracts, and managing upgrades.

---

## 1. Deploy \$ABLE Token on Base (or Other EVM Chain)

- Use Hardhat to deploy the upgradeable `AbleToken` contract.
- Ensure the initial supply is minted to the deployer.

```bash
ENV_FILE=.env.testnet npx hardhat run scripts/deploy.js --network baseSepolia
```

---

## 2. Bridge \$ABLE to NEAR via Rainbow Bridge

- Navigate to [Rainbow Bridge](https://rainbowbridge.app/deploy).
- Bridge the deployed ERC-20 token contract to NEAR.
- This creates a NEP-141 equivalent on NEAR.

**Important:** This NEP-141 token will act as the _base token_ (gas token) for the virtual chain.

---

## 3. Configure Aurora Virtual Chain to Use Bridged \$ABLE

- When launching your Aurora Virtual Chain, specify the bridged NEP-141 token as the _base currency_.
- This allows:
  - Gas fees to be paid in \$ABLE.
  - Smart contracts and apps to price interactions in \$ABLE.

---

## 4. Deploy Smart Contracts on Virtual Chain

- Use the virtual chain's EVM interface to deploy your contracts.
- Contracts can:
  - Read/write using the bridged \$ABLE token.
  - Integrate payments, staking, and on-chain AI interactions.

```bash
npx hardhat run scripts/deploy-contracts.js --network <aurora-vchain>
```

---

## 5. Upgrading the ERC-20 Token (Base → NEAR Considerations)

**Bridging is one-way.** The NEP-141 version of \$ABLE does **not** automatically inherit upgrades made to the original ERC-20 on Base.

### Upgrade Options:

#### Option 1: External Upgradable Contracts

- Avoid upgrading token logic directly.
- Keep token stable; deploy new logic via external upgradable contracts (e.g., staking, payment).

#### Option 2: Token Aliasing

- Maintain both `ABLEv1` and `ABLEv2`.
- Use a wrapper contract or internal logic to support both.

### Recommendation:

Avoid upgrading the bridged token. Design the system to be forward-compatible via upgradable modules.

---

## Final Notes

- Inform users and partners when upgrades or bridges occur.
- Ensure NEP-141 version is audited and compliant with Aurora Virtual Chain requirements.
- For production, coordinate with bridge maintainers and Aurora support before changes.

---

**Resources:**

- [Rainbow Bridge](https://rainbowbridge.app/deploy)
- [Aurora Virtual Chains Docs](https://aurora.dev/virtual-chains)
- [Hardhat](https://hardhat.org)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts)
