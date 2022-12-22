import { ethers, upgrades } from "hardhat";
import args from "../arguments";
import { verify } from "../utils/deploy.utils";
import { typedDeployProxy } from "../utils/upgrades.utils";

async function main() {
  const Token = await ethers.getContractFactory("TAUT");
  const token = await typedDeployProxy(Token, args);
  await token.deployed();

  const currentImplementationAddress = await upgrades.erc1967.getImplementationAddress(token.address);
  console.log("Proxy address:", token.address);
  console.log("Implementation address:", currentImplementationAddress);

  await token.deployTransaction.wait(6);

  await verify(currentImplementationAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
