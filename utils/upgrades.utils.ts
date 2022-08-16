import { DeployProxyOptions } from "@openzeppelin/hardhat-upgrades/dist/utils";
import { ContractFactory } from "ethers";
import { upgrades } from "hardhat";

export const typedDeployProxy = <T extends ContractFactory>(
  ImplFactory: T,
  args?: unknown[] | DeployProxyOptions,
  opts?: DeployProxyOptions
): Promise<ReturnType<T["attach"]>> => {
  if (Array.isArray(args)) {
    return upgrades.deployProxy(ImplFactory, args, opts) as Promise<
      ReturnType<T["attach"]>
    >;
  } else {
    return upgrades.deployProxy(ImplFactory, opts) as Promise<
      ReturnType<T["attach"]>
    >;
  }
};
