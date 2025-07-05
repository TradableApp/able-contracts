const { ethers, upgrades } = require("hardhat");

async function main() {
  const AbleToken = await ethers.getContractFactory("AbleToken");
  const able = await upgrades.deployProxy(
    AbleToken,
    [process.env.INITIAL_SUPPLY, process.env.OWNER_ADDRESS],
    {
      initializer: "initialize",
      kind: "uups",
    },
  );
  await able.waitForDeployment();
  console.log(`AbleToken proxy deployed to: ${await able.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
