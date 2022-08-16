import { run } from "hardhat";

export const verify = async (contractAddress: string, args?: unknown[]) => {
  console.log("Verifying contract...");
  try {
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: args,
    });
  } catch (e) {
    console.error(e);
  }
};
