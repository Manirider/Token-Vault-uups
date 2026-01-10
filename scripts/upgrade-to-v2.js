const { ethers, upgrades } = require("hardhat");
const fs = require("fs");

async function main() {
  if (!fs.existsSync("deployment-v1.json")) {
    console.error("deployment-v1.json not found. Run deploy-v1.js first.");
    process.exit(1);
  }

  const deploymentInfo = JSON.parse(fs.readFileSync("deployment-v1.json", "utf8"));
  const proxyAddress = process.env.PROXY_ADDRESS || deploymentInfo.contracts.proxy;

  if (!proxyAddress) {
    console.error("Proxy address not found. Set PROXY_ADDRESS env or run deploy-v1.js first.");
    process.exit(1);
  }

  const [admin] = await ethers.getSigners();
  console.log("Upgrading contracts with account:", admin.address);
  console.log("Proxy address:", proxyAddress);

  const currentVault = await ethers.getContractAt("TokenVaultV1", proxyAddress);
  const currentVersion = await currentVault.getImplementationVersion();
  console.log("Current version:", currentVersion);

  console.log("\nUpgrading to TokenVaultV2...");
  const VaultV2 = await ethers.getContractFactory("TokenVaultV2");

  const upgraded = await upgrades.upgradeProxy(proxyAddress, VaultV2, {
    kind: "uups",
    timeout: 0,
    unsafeAllow: ['constructor']
  });
  await upgraded.waitForDeployment();

  console.log("Initializing V2 features...");
  const tx = await upgraded.initializeV2();
  await tx.wait();

  const newImplementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("\n=== Upgrade Summary ===");
  console.log("Proxy Address:", proxyAddress);
  console.log("New Implementation:", newImplementation);
  console.log("New Version:", await upgraded.getImplementationVersion());
  console.log("PAUSER_ROLE granted to:", admin.address);

  deploymentInfo.contracts.implementationV2 = newImplementation;
  deploymentInfo.upgradeV2Timestamp = new Date().toISOString();

  fs.writeFileSync(
    "deployment-v2.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("\nDeployment info saved to deployment-v2.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Upgrade failed:", error.message);
    if (error.data) console.error("Error data:", error.data);
    process.exit(1);
  });
