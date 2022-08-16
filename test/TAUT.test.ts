import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import Chance from "chance";
import { TAUT, TAUT__factory } from "../typechain";
import { typedDeployProxy } from "../utils/upgrades.utils";

const chance = new Chance();

const getPositiveInteger = () => chance.natural({ min: 1 });

const getDaysLater = () =>
  chance.natural({
    min: 1,
    max: 366 * 5,
  });

const calculateFeeIndex = async (contract: TAUT, dayDelta: number) => {
  const feeRate = await contract.feeRate();
  const denominator = await contract.DECAY_RATIO_DENOMINATOR();
  let prevFeeIndex = await contract.feeIndex();
  let feeIndex = prevFeeIndex;

  for (let index = 0; index < dayDelta; index++) {
    feeIndex = prevFeeIndex.sub(prevFeeIndex.mul(feeRate).div(denominator));
    prevFeeIndex = feeIndex;
  }

  return feeIndex;
};

describe("TAUT", () => {
  let TAUT: TAUT__factory;
  let contractProxy: TAUT;
  let oneToken: BigNumber;
  let owner: SignerWithAddress;
  let account1: SignerWithAddress;
  let account2: SignerWithAddress;

  const initialFeeRecipient = ethers.Wallet.createRandom().address;
  const initialFeeRate = 400;
  const secondsPerDay = 24 * 60 * 60;
  const deploymentDay = Math.floor(Date.now() / 1000 / secondsPerDay);
  const defaultData = "";
  const transferEventName = "Transfer";
  const burnFeeEventName = "BurnFee";

  beforeEach(async () => {
    TAUT = await ethers.getContractFactory("TAUT");

    contractProxy = await typedDeployProxy(TAUT, [initialFeeRecipient, initialFeeRate]);

    oneToken = BigNumber.from(10).pow(await contractProxy.decimals());

    [owner, account1, account2] = await ethers.getSigners();
  });

  describe("deploy", () => {
    it("sets fee recipient address", async () => {
      expect(await contractProxy.feeRecipient()).equals(initialFeeRecipient);
    });

    it("sets fee rate", async () => {
      expect(await contractProxy.feeRate()).equals(initialFeeRate);
    });

    it("sets initial collection day as a day of deployment", async () => {
      expect(await contractProxy.feesCollectionDay()).equals(deploymentDay);
    });

    it("reverts if fee recipient's address is the Zero Address", async () => {
      await expect(typedDeployProxy(TAUT, [ethers.constants.AddressZero, initialFeeRate])).to.be.reverted;
    });

    it("reverts if initial fee rate exceeds maximum allowed fee", async () => {
      const maxAllowedFee = await contractProxy.MAX_FEE_RATE();

      await expect(typedDeployProxy(TAUT, [initialFeeRecipient, maxAllowedFee.add(1)])).to.be.reverted;
    });
  });

  describe("setFeeRecipient", () => {
    const updateFeeRecipientEventName = "UpdateFeeRecipient";

    it("sets a new recipient's address", async () => {
      const feeRecipient = await contractProxy.feeRecipient();
      const newFeeRecipient = ethers.Wallet.createRandom().address;

      await contractProxy.setFeeRecipient(newFeeRecipient);

      expect(await contractProxy.feeRecipient()).equals(newFeeRecipient);
      expect(newFeeRecipient).not.equals(feeRecipient);
    });

    it(`emits ${updateFeeRecipientEventName} event`, async () => {
      const newfeeRecipient = ethers.Wallet.createRandom().address;
      await expect(contractProxy.setFeeRecipient(newfeeRecipient))
        .to.emit(contractProxy, updateFeeRecipientEventName)
        .withArgs(newfeeRecipient);
    });

    it("reverts if a new fee recipient's address is the Zero Address", async () => {
      await expect(contractProxy.setFeeRecipient(ethers.constants.AddressZero)).to.be.reverted;
    });

    it("reverts if caller is not the owner", async () => {
      const notOwner = account1;

      expect(contractProxy.owner()).not.to.equal(notOwner.address);
      await expect(contractProxy.connect(notOwner).setFeeRecipient(notOwner.address)).to.be.reverted;
    });
  });

  describe("setFeeRate", () => {
    const updateFeeRateEventName = "UpdateFeeRate";
    let maxAllowedFeeRate: BigNumber;

    beforeEach(async () => {
      maxAllowedFeeRate = await contractProxy.MAX_FEE_RATE();
    });

    it("sets a new fee rate", async () => {
      const feeRate = await contractProxy.feeRate();
      const newFeeRate = maxAllowedFeeRate.sub(feeRate);

      await contractProxy.setFeeRate(newFeeRate);

      expect(await contractProxy.feeRate()).equals(newFeeRate);
      expect(newFeeRate).not.equals(feeRate);
    });

    it(`emits ${updateFeeRateEventName} event`, async () => {
      const feeRate = await contractProxy.feeRate();
      const newFeeRate = maxAllowedFeeRate.sub(feeRate);

      await expect(contractProxy.setFeeRate(newFeeRate))
        .to.emit(contractProxy, updateFeeRateEventName)
        .withArgs(newFeeRate);
    });

    it("reverts if a new fee rate exceeds the max allowed fee rate", async () => {
      await expect(contractProxy.setFeeRate(maxAllowedFeeRate.add(1))).to.be.reverted;
    });

    it("reverts if caller is not the owner", async () => {
      const notOwner = account1;
      const fee = await contractProxy.feeRate();
      const newFee = maxAllowedFeeRate.sub(fee);

      expect(contractProxy.owner()).not.equals(notOwner.address);
      await expect(contractProxy.connect(notOwner).setFeeRate(newFee)).to.be.reverted;
    });
  });

  describe("mint", () => {
    const mintEventName = "Mint";

    it("converts the passed amount argument to tokens and mints the result amount", async () => {
      const { address } = owner;

      const amountToMint = BigNumber.from(getPositiveInteger());

      const amountTokensToMint = amountToMint.mul(oneToken);
      const initialTotalSupply = await contractProxy.totalSupply();

      await expect(() => contractProxy.mint(address, amountToMint, defaultData)).changeTokenBalance(
        contractProxy,
        owner,
        amountTokensToMint
      );
      expect(await contractProxy.totalSupply()).equals(initialTotalSupply.add(amountTokensToMint));
    });

    it(`emits ${mintEventName} event`, async () => {
      const { address } = account1;
      const amountToMint = getPositiveInteger();
      const mintingData = "some data";

      await expect(contractProxy.mint(address, amountToMint, mintingData))
        .to.emit(contractProxy, mintEventName)
        .withArgs(address, oneToken.mul(amountToMint), mintingData);
    });

    it("reverts if caller is not the owner", async () => {
      const notOwner = account1;

      expect(await contractProxy.owner()).not.equals(notOwner.address);
      await expect(contractProxy.connect(notOwner).mint(notOwner.address, oneToken, defaultData)).to.be.reverted;
    });
  });

  describe("balanceOf", () => {
    it("it returns given account balance with fee", async () => {
      const { address } = account2;
      const amountToMint = getPositiveInteger();

      await contractProxy.mint(address, amountToMint, defaultData);

      const balanceWithoutFee = await contractProxy.balanceOf(address);

      expect(balanceWithoutFee).equals(oneToken.mul(amountToMint));

      const daysLater = getDaysLater();

      await ethers.provider.send("evm_increaseTime", [daysLater * secondsPerDay]);
      await ethers.provider.send("evm_mine", []);

      const newFeeIndex = await calculateFeeIndex(contractProxy, daysLater);

      const accountFeeIndex = await contractProxy.accountsFeeIndices(address);

      expect(await contractProxy.balanceOf(address)).equals(
        balanceWithoutFee.mul(newFeeIndex).div(accountFeeIndex)
      );
    });
  });

  describe("burn", () => {
    const burnEventName = "Burn";
    const { hexlify, randomBytes } = ethers.utils;
    const userId = hexlify(randomBytes(16));

    it("burns caller's tokens, if their amount is multiple of 1000 tokens", async () => {
      const { address } = account1;
      const multiplier = chance.natural({ min: 1, max: 100 });
      await contractProxy.mint(address, chance.natural({ min: 1000 * multiplier }), defaultData);
      const amountToBurn = oneToken.mul(1000 * multiplier);
      const initialBalance = await contractProxy.balanceOf(address);
      const initialTotalSupply = await contractProxy.totalSupply();

      await contractProxy.connect(account1).burn(userId, amountToBurn);

      expect(await contractProxy.balanceOf(address)).equals(initialBalance.sub(amountToBurn));
      expect(await contractProxy.totalSupply()).equals(initialTotalSupply.sub(amountToBurn));
    });

    it(`emits ${burnEventName} event`, async () => {
      const { address } = owner;
      const amount = 1000;
      await contractProxy.mint(address, amount, defaultData);

      await expect(contractProxy.burn(userId, oneToken.mul(amount)))
        .to.emit(contractProxy, burnEventName)
        .withArgs(address, userId, oneToken.mul(amount));
    });

    it("reverts if caller's amount of tokens isn't multiple of 1000 tokens", async () => {
      const { address } = owner;
      await contractProxy.mint(address, 1000, defaultData);

      await expect(contractProxy.burn(userId, oneToken.mul(999))).to.be.reverted;
    });
  });

  describe("collectFees", () => {
    const collectFeesEventName = "CollectFees";

    it("transfers all collected fees to fee recipient's account, updates global and fee recipient's", async () => {
      const feeRecipient = await contractProxy.feeRecipient();
      await contractProxy.mint(owner.address, getPositiveInteger(), defaultData);
      await contractProxy.mint(feeRecipient, getPositiveInteger(), defaultData);

      const prevFeeIndex = await contractProxy.feeIndex();
      const prevFeeRecipientFeeIndex = await contractProxy.accountsFeeIndices(feeRecipient);

      expect(prevFeeIndex).equals(prevFeeRecipientFeeIndex);

      const daysLater = getDaysLater();

      await ethers.provider.send("evm_increaseTime", [daysLater * secondsPerDay]);
      await ethers.provider.send("evm_mine", []);

      const expectedFeeIndex = await calculateFeeIndex(contractProxy, daysLater);

      const totalSupply = await contractProxy.totalSupply();
      const feesAccumulated = totalSupply.sub(totalSupply.mul(expectedFeeIndex).div(prevFeeIndex));

      const feeRecipientBalanceWithFee = await contractProxy.balanceOf(feeRecipient);

      await contractProxy.collectFees();

      expect(await contractProxy.balanceOf(feeRecipient)).equals(feeRecipientBalanceWithFee.add(feesAccumulated));
      expect(await contractProxy.accountsFeeIndices(feeRecipient)).not.equals(prevFeeRecipientFeeIndex);
      expect(await contractProxy.accountsFeeIndices(feeRecipient)).equals(expectedFeeIndex);
    });

    it("updates fee collection day", async () => {
      const prevFeesCollectionDay = await contractProxy.feesCollectionDay();

      const daysLater = getDaysLater();

      await ethers.provider.send("evm_increaseTime", [daysLater * secondsPerDay]);
      await ethers.provider.send("evm_mine", []);

      const expectedFeesCollectionDay = prevFeesCollectionDay.add(daysLater);

      await contractProxy.collectFees();

      expect(await contractProxy.feesCollectionDay()).equals(expectedFeesCollectionDay);
    });

    it(`emits ${transferEventName} event`, async () => {
      const feeRecipient = await contractProxy.feeRecipient();
      await contractProxy.mint(feeRecipient, getPositiveInteger(), defaultData);

      const feeRecipientBalance = await contractProxy.balanceOf(feeRecipient);
      const daysLater = getDaysLater();

      await ethers.provider.send("evm_increaseTime", [daysLater * secondsPerDay]);
      await ethers.provider.send("evm_mine", []);

      const feeIndex = await contractProxy.feeIndex();
      const expectedFeeIndex = await calculateFeeIndex(contractProxy, daysLater);

      const totalSupply = await contractProxy.totalSupply();
      const feesCollected = totalSupply.sub(totalSupply.mul(expectedFeeIndex).div(feeIndex));

      const feeRecipientBalanceWithFee = await contractProxy.balanceOf(feeRecipient);
      const feeRecipientFee = feeRecipientBalance.sub(feeRecipientBalanceWithFee);

      await expect(contractProxy.collectFees())
        .to.emit(contractProxy, transferEventName)
        .withArgs(
          ethers.constants.AddressZero,
          feeRecipient,
          feesCollected.gt(feeRecipientFee) ? feesCollected.sub(feeRecipientFee) : BigNumber.from(0)
        );
    });

    it(`emits ${collectFeesEventName} event`, async () => {
      const feeRecipient = await contractProxy.feeRecipient();
      await contractProxy.mint(feeRecipient, getPositiveInteger(), defaultData);

      const daysLater = getDaysLater();

      await ethers.provider.send("evm_increaseTime", [daysLater * secondsPerDay]);
      await ethers.provider.send("evm_mine", []);

      const feeIndex = await contractProxy.feeIndex();
      const expectedFeeIndex = await calculateFeeIndex(contractProxy, daysLater);

      const totalSupply = await contractProxy.totalSupply();
      const feesCollected = totalSupply.sub(totalSupply.mul(expectedFeeIndex).div(feeIndex));

      await expect(contractProxy.collectFees())
        .to.emit(contractProxy, collectFeesEventName)
        .withArgs(feesCollected, expectedFeeIndex);
    });

    it(`emits ${burnFeeEventName} event`, async () => {
      const feeRecipient = await contractProxy.feeRecipient();
      await contractProxy.mint(feeRecipient, getPositiveInteger(), defaultData);

      const feeRecipientBalance = await contractProxy.balanceOf(feeRecipient);

      const daysLater = getDaysLater();

      await ethers.provider.send("evm_increaseTime", [daysLater * secondsPerDay]);
      await ethers.provider.send("evm_mine", []);

      const feeRecipientBalanceWithFee = await contractProxy.balanceOf(feeRecipient);
      const fee = feeRecipientBalance.sub(feeRecipientBalanceWithFee);
      const feeIndex = await contractProxy.feeIndex();
      const expectedFeeIndex = await calculateFeeIndex(contractProxy, daysLater);

      const totalSupply = await contractProxy.totalSupply();
      const feesCollected = totalSupply.sub(totalSupply.mul(expectedFeeIndex).div(feeIndex));

      await expect(contractProxy.collectFees())
        .to.emit(contractProxy, burnFeeEventName)
        .withArgs(feeRecipient, fee, feeRecipientBalanceWithFee.add(feesCollected), expectedFeeIndex);
    });
  });

  describe("tokens transferring", () => {
    it("transfers tokens", async () => {
      const amountToMint = getPositiveInteger();
      const amountToTransfer = oneToken.mul(amountToMint).sub(oneToken);
      const recipientInitialBalance = await contractProxy.balanceOf(account1.address);

      await contractProxy.mint(owner.address, amountToMint, defaultData);

      const senderBalanceAfterMint = await contractProxy.balanceOf(owner.address);

      await contractProxy.connect(owner).transfer(account1.address, amountToTransfer);

      expect(await contractProxy.balanceOf(account1.address)).equals(
        recipientInitialBalance.add(amountToTransfer)
      );
      expect(await contractProxy.balanceOf(owner.address)).equals(senderBalanceAfterMint.sub(amountToTransfer));
    });

    it("transfers tokens from third-party account", async () => {
      const amountToMint = getPositiveInteger();
      const amountToTransferFrom = oneToken.mul(amountToMint).sub(oneToken);
      const recipientInitialBalance = await contractProxy.balanceOf(account2.address);

      await contractProxy.mint(owner.address, amountToMint, defaultData);

      const senderBalanceAfterMint = await contractProxy.balanceOf(owner.address);

      await contractProxy.connect(owner).approve(account1.address, amountToTransferFrom);

      await contractProxy.connect(account1).transferFrom(owner.address, account2.address, amountToTransferFrom);

      expect(await contractProxy.balanceOf(account2.address)).equals(
        recipientInitialBalance.add(amountToTransferFrom)
      );
      expect(await contractProxy.balanceOf(owner.address)).equals(
        senderBalanceAfterMint.sub(amountToTransferFrom)
      );
    });
  });
});
