const { ethers, upgrades } = require("hardhat");
const hre = require("hardhat");

async function main() {
  // 1. Log the network and deployer
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;
  console.log(`\nDeploying to network: ${network}`);
  console.log(`Deploying from account: ${deployer.address}`);

  // 2. Get token parameters from environment variables
  const tokenName = process.env.TOKEN_NAME;
  const tokenSymbol = process.env.TOKEN_SYMBOL;
  const initialSupply = process.env.INITIAL_SUPPLY;
  const ownerAddress = process.env.OWNER_ADDRESS;

  if (!tokenName || !tokenSymbol || !initialSupply || !ownerAddress) {
    throw new Error(
      "Missing token configuration in your .env file. Please check TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY, and OWNER_ADDRESS.",
    );
  }

  console.log("Token Parameters:");
  console.log(`  Name:          ${tokenName}`);
  console.log(`  Symbol:        ${tokenSymbol}`);
  console.log(`  Initial Supply:  ${ethers.formatEther(initialSupply)} tokens`);
  console.log(`  Owner Address:   ${ownerAddress}`);

  // 3. Deploy the contract
  const AbleToken = await ethers.getContractFactory("AbleToken");
  console.log("\nDeploying AbleToken proxy...");

  const ableTokenProxy = await upgrades.deployProxy(
    AbleToken,
    [tokenName, tokenSymbol, initialSupply, ownerAddress], // Pass all arguments here
    {
      initializer: "initialize",
      kind: "uups",
      timeout: 60000, // Optional: Increase timeout for slow networks
    },
  );

  await ableTokenProxy.waitForDeployment();
  const proxyAddress = await ableTokenProxy.getAddress();
  console.log(`✅ AbleToken proxy deployed to: ${proxyAddress}`);

  // 4. (Optional but Recommended) Verify the contract on Etherscan
  console.log(
    "\nWaiting for 1 minute before starting verification to allow for block propagation...",
  );
  await new Promise((resolve) => setTimeout(resolve, 60000)); // 60-second delay

  try {
    console.log("Verifying contract on Etherscan...");
    await hre.run("verify:verify", {
      address: proxyAddress,
      constructorArguments: [], // No constructor args for proxy
    });
    console.log("✅ Contract verified successfully!");
  } catch (error) {
    console.error("Verification failed:", error.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
