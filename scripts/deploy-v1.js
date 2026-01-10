const { ethers, upgrades } = require("hardhat");
const fs = require("fs");

async function main() {
  const [admin] = await ethers.getSigners();
  console.log("Deploying contracts with account:", admin.address);

  console.log("\nDeploying MockERC20...");
  const Token = await ethers.getContractFactory("MockERC20");
  const token = await Token.deploy();
  await token.waitForDeployment();
  console.log("MockERC20 deployed at:", token.target);


  console.log("\nDeploying TokenVaultV1 as UUPS Proxy...");
  const depositFee = 500; // 5%

  const Vault = await ethers.getContractFactory("TokenVaultV1");
  const vault = await upgrades.deployProxy(
    Vault,
    [token.target, admin.address, depositFee],
    {
      initializer: "initialize",
      kind: "uups",
      timeout: 0,
      unsafeAllow: ['constructor']
    }
  );
  await vault.waitForDeployment();

  const implementationAddress = await upgrades.erc1967.getImplementationAddress(vault.target);

  console.log("\n=== Deployment Summary ===");
  console.log("Token Address:", token.target);
  console.log("Proxy Address:", vault.target);
  console.log("Implementation Address:", implementationAddress);
  console.log("Admin Address:", admin.address);
  console.log("Deposit Fee:", depositFee, "basis points (", depositFee / 100, "%)");
  console.log("Version:", await vault.getImplementationVersion());

  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    timestamp: new Date().toISOString(),
    contracts: {
      token: token.target,
      proxy: vault.target,
      implementation: implementationAddress
    },
    admin: admin.address,
    depositFee: depositFee
  };

  fs.writeFileSync(
    "deployment-v1.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("\nDeployment info saved to deployment-v1.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
