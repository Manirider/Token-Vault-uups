const { ethers, upgrades } = require("hardhat");
const fs = require("fs");

async function main() {
  let deploymentInfo;
  if (fs.existsSync("deployment-v2.json")) {
    deploymentInfo = JSON.parse(fs.readFileSync("deployment-v2.json", "utf8"));
  } else if (fs.existsSync("deployment-v1.json")) {
    deploymentInfo = JSON.parse(fs.readFileSync("deployment-v1.json", "utf8"));
  } else {
    console.error("No deployment file found. Run deploy-v1.js first.");
    process.exit(1);
  }

  const proxyAddress = process.env.PROXY_ADDRESS || deploymentInfo.contracts.proxy;

  if (!proxyAddress) {
    console.error("Proxy address not found. Set PROXY_ADDRESS env or run deploy-v1.js first.");
    process.exit(1);
  }

  const [admin] = await ethers.getSigners();
  console.log("Upgrading contracts with account:", admin.address);
  console.log("Proxy address:", proxyAddress);

  const currentVault = await ethers.getContractAt("TokenVaultV2", proxyAddress);
  const currentVersion = await currentVault.getImplementationVersion();
  console.log("Current version:", currentVersion);

  console.log("\nUpgrading to TokenVaultV3...");
  const VaultV3 = await ethers.getContractFactory("TokenVaultV3");

  const upgraded = await upgrades.upgradeProxy(proxyAddress, VaultV3, {
    kind: "uups",
    timeout: 0,
    unsafeAllow: ['constructor']
  });
  await upgraded.waitForDeployment();

  console.log("Initializing V3 features...");
  const tx = await upgraded.initializeV3();
  await tx.wait();

  const newImplementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("\n=== Upgrade Summary ===");
  console.log("Proxy Address:", proxyAddress);
  console.log("New Implementation:", newImplementation);
  console.log("New Version:", await upgraded.getImplementationVersion());

  console.log("\n=== State Verification ===");
  console.log("Yield Rate:", (await upgraded.getYieldRate()).toString());
  console.log("Deposits Paused:", await upgraded.isDepositsPaused());
  console.log("Withdrawal Delay:", (await upgraded.getWithdrawalDelay()).toString());

  deploymentInfo.contracts.implementationV3 = newImplementation;
  deploymentInfo.upgradeV3Timestamp = new Date().toISOString();

  fs.writeFileSync(
    "deployment-v3.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("\nDeployment info saved to deployment-v3.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
