import { ethers, network, upgrades } from "hardhat";
import { verify } from "../utils/deploy.utils";
import { typedDeployProxy } from "../utils/upgrades.utils";

async function main() {
  const feeRate = 400;
  const feeRecipient =
    network.name === "polygon"
      ? "0x450927fd8EADF7Af1EA5718D1A8DEFCf37CA7415"
      : "0x36352f274E54e29bc36d08DEe5f409D011c8dBCb";
  const feeRateManager = "0xF8484e94e87f2E30674f1F641A5bb16868C4b20f";
  const whitelistManager = feeRecipient;
  const isWhitelisting = false;
  const Token = await ethers.getContractFactory("TAUT");
  const token = await typedDeployProxy(Token, [
    feeRate,
    feeRateManager,
    feeRecipient,
    whitelistManager,
    isWhitelisting,
  ]);
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
