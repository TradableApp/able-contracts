require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("hardhat-gas-reporter");

const dotenv = require("dotenv");

// 1. Load the environment-specific file first.
// Its variables take precedence and are loaded into the process.
if (process.env.ENV_FILE) {
  dotenv.config({ path: process.env.ENV_FILE });
}

// 2. Load the base .env file.
// This will only fill in variables that were NOT defined in the specific file.
// If a variable already exists, this command will NOT overwrite it.
dotenv.config({ path: ".env" });

const {
  PRIVATE_KEY,
  BASE_SEPOLIA_RPC,
  BASE_MAINNET_RPC,
  ETHERSCAN_API_KEY,
  COINMARKETCAP_API_KEY,
} = process.env;

module.exports = {
  // Best practice: Set the default network to `hardhat` for testing and development.
  // This avoids accidental transactions on live networks.
  defaultNetwork: "hardhat",

  networks: {
    hardhat: {
      chainId: 1337,
    },
    base: {
      url: BASE_MAINNET_RPC || "https://mainnet.base.org",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 8453,
    },
    baseSepolia: {
      url: BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 84532,
    },
  },

  solidity: {
    version: "0.8.24",
    settings: {
      // The optimizer is crucial for reducing contract size and gas costs.
      // It's a standard practice for production deployments.
      optimizer: {
        enabled: true,
        runs: 10000, // The number of runs should be tuned based on contract usage.
      },
    },
  },

  // Configuration for Etherscan contract verification
  // In your hardhat.config.js

  etherscan: {
    // It's good practice to provide a fallback to prevent errors
    apiKey: process.env.ETHERSCAN_API_KEY || "",
    // Your customChains block is the correct and most robust way to define L2s
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },

  // Configuration for the hardhat-gas-reporter plugin
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true", // Run with `REPORT_GAS=true npx hardhat test`
    currency: "USD",
    currencyDisplayPrecision: 8,
    L2: "base", // Use 'base' for Base Mainnet
    outputFile: "gas-report.txt",
    noColors: true,
    // gasPriceApi: "https://api.basescan.org/api?module=proxy&action=eth_gasPrice",
    coinmarketcap: COINMARKETCAP_API_KEY || "",
    etherscan: ETHERSCAN_API_KEY || "",
  },

  // Named accounts for more readable deployment scripts (used with hardhat-deploy)
  namedAccounts: {
    deployer: {
      default: 0, // The first account (index 0) is the deployer by default
    },
    user1: {
      default: 1, // The second account is user1
    },
  },
};
