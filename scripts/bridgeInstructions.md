# Bridge Instructions for $ABLE Token

This document outlines the recommended procedure for bridging the $ABLE ERC-20 token to NEAR and using it on your Aurora Virtual Chain, alongside the updated architectural decision to consolidate all smart contract logic onto the Aurora Virtual Chain only.

---

## Step-by-Step Bridge Instructions

### 1. Deploy ERC-20 Token on Base Mainnet

- Use Hardhat to deploy the `AbleToken` contract as a **pure ERC-20 token** with no additional logic.
- This version serves for liquidity, CEX listings, and as the source for bridging.
- Example:

```bash
npx hardhat run scripts/deploy.js --network baseSepolia
```

### 2. Bridge $ABLE to NEAR via OmniBridge

- Use [OmniBridge CLI](https://github.com/Near-One/omni-bridge) or [SDK](https://github.com/Near-One/bridge-sdk-js).
- Bridge the desired portion of the supply from Base to NEAR.
- This creates a NEP-141 wrapped representation of $ABLE on NEAR.

### 3. Use $ABLE on Aurora Virtual Chain

- Configure the Aurora Virtual Chain to accept the NEP-141 version of $ABLE.
- **USDC will be used as the base gas token.**
- $ABLE will be used solely as a utility token within Tradable’s services (AI, staking, payments).

### 4. Deploy Smart Contracts on Aurora Virtual Chain

- Deploy upgradable contracts directly on the Aurora VC EVM.
- These contracts will interact with $ABLE as the utility token.
- Users will experience **gasless transactions**, with Tradable covering gas fees in USDC via Aurora’s relayer.

```bash
npx hardhat run scripts/deploy.js --network <aurora-vc>
```

---

## Upgradeability Considerations

### Aurora VC ($ABLE on NEAR)

- Logic contracts (staking, AI payments, governance) are upgradeable using UUPS on the VC.
- $ABLE as NEP-141 on VC is used **only for transfer/balance; all logic lives in your contracts**.

### Base ($ABLE on Base)

- No smart contract logic beyond ERC-20.
- Solely for liquidity, listings, and bridging.

---

## Why This Architecture?

- **Gasless UX** on Aurora VC.
- **Simplified upgrades**: only maintain upgrade paths on Aurora VC.
- **Cleaner user journey**: $ABLE behaves consistently within Tradable.
- **Base version remains simple for liquidity and CEXs.**

---

## Final Notes

- Inform users and partners about bridging.
- Ensure NEP-141 behavior is audited.
- Coordinate with Aurora for any future changes to bridging, intents, or VC configurations.

---

**Resources:**

- [OmniBridge CLI](https://github.com/Near-One/omni-bridge)
- [Aurora Virtual Chains Docs](https://aurora.dev/virtual-chains)
- [Hardhat](https://hardhat.org)
