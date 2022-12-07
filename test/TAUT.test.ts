import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, BigNumberish } from "ethers";
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
  const prevFeeIndex = await contract.feeIndex();

  const feeIndex = await contract.calculateCompoundDecay(prevFeeIndex, feeRate, dayDelta);

  return feeIndex;
};

describe("TAUT", () => {
  let TAUT: TAUT__factory;
  let contractProxy: TAUT;
  let oneToken: BigNumber;
  let owner: SignerWithAddress;
  let account1: SignerWithAddress;
  let account2: SignerWithAddress;
  let initialFeeRateManager: SignerWithAddress;
  let constructorArgs: [BigNumberish, string, string, string, boolean];

  const initialFeeRate = 400;
  const initialFeeRecipient = ethers.Wallet.createRandom().address;
  const initialWhitelistManager = ethers.Wallet.createRandom().address;
  const initialIsWhitelisting = false;
  const secondsPerDay = 24 * 60 * 60;
  const deploymentDay = Math.floor(Date.now() / 1000 / secondsPerDay);
  const defaultData = "";
  const transferEventName = "Transfer";
  const burnFeeEventName = "BurnFee";

  beforeEach(async () => {
    [owner, account1, account2, initialFeeRateManager] = await ethers.getSigners();

    constructorArgs = [
      initialFeeRate,
      initialFeeRateManager.address,
      initialFeeRecipient,
      initialWhitelistManager,
      initialIsWhitelisting,
    ];

    TAUT = await ethers.getContractFactory("TAUT");

    contractProxy = await typedDeployProxy(TAUT, constructorArgs);

    oneToken = BigNumber.from(10).pow(await contractProxy.decimals());
  });

  describe("deploy", () => {
    it("sets fee rate", async () => {
      expect(await contractProxy.feeRate()).equals(initialFeeRate);
    });

    it("sets fee rate manager address", async () => {
      expect(await contractProxy.feeRateManager()).equals(initialFeeRateManager.address);
    });

    it("sets fee recipient address", async () => {
      expect(await contractProxy.feeRecipient()).equals(initialFeeRecipient);
    });

    it("sets initial collection day as a day of deployment", async () => {
      expect(await contractProxy.feesCollectionDay()).equals(deploymentDay);
    });

    it("reverts if initial fee rate exceeds maximum allowed fee", async () => {
      const maxAllowedFee = await contractProxy.MAX_FEE_RATE();
      const newConstructorArgs = [maxAllowedFee.add(1).toNumber(), ...constructorArgs.slice(1)];

      await expect(typedDeployProxy(TAUT, newConstructorArgs)).to.be.reverted;
    });

    it("reverts if fee rate manager's address is the Zero Address", async () => {
      const newConstructorArgs = [
        ...constructorArgs.slice(0, 1),
        ethers.constants.AddressZero,
        ...constructorArgs.slice(2),
      ];

      await expect(typedDeployProxy(TAUT, newConstructorArgs)).to.be.reverted;
    });

    it("reverts if fee recipient's address is the Zero Address", async () => {
      const newConstructorArgs = [
        ...constructorArgs.slice(0, 2),
        ethers.constants.AddressZero,
        ...constructorArgs.slice(3),
      ];

      await expect(typedDeployProxy(TAUT, newConstructorArgs)).to.be.reverted;
    });
  });

  describe("addToWhitelist", () => {
    const addToWhitelistEventName = "AddToWhitelist";
    const account = ethers.Wallet.createRandom().address;

    it("allows the owner to whitelist accounts", async () => {
      const accounts = Array.from(
        { length: chance.natural({ min: 1, max: 20 }) },
        () => ethers.Wallet.createRandom().address
      );

      await contractProxy.addToWhitelist(accounts);

      const results = await Promise.all(accounts.map((a) => contractProxy.isWhitelisted(a)));

      results.forEach((r) => expect(r).true);
    });

    it(`emits ${addToWhitelistEventName} event`, async () => {
      await expect(contractProxy.addToWhitelist([account]))
        .to.emit(contractProxy, addToWhitelistEventName)
        .withArgs(account);
    });

    it("reverts if caller is not the owner", async () => {
      await expect(contractProxy.connect(account2).addToWhitelist([account])).to.be.reverted;
    });
  });

  describe("removeFromWhitelist", () => {
    const removeFromWhitelistEventName = "RemoveFromWhitelist";
    const whitelistedAccount = ethers.Wallet.createRandom().address;

    beforeEach(async () => {
      await contractProxy.addToWhitelist([whitelistedAccount]);
    });

    it("allows the owner to remove accounts from whitelist", async () => {
      const accounts = Array.from(
        { length: chance.natural({ min: 1, max: 10 }) },
        () => ethers.Wallet.createRandom().address
      );

      await contractProxy.addToWhitelist(accounts);

      const addResults = await Promise.all(accounts.map((a) => contractProxy.isWhitelisted(a)));

      addResults.forEach((r) => expect(r).true);

      await contractProxy.removeFromWhitelist(accounts);

      const removeResults = await Promise.all(accounts.map((a) => contractProxy.isWhitelisted(a)));

      removeResults.forEach((r) => expect(r).false);
    });

    it(`emits ${removeFromWhitelistEventName} event`, async () => {
      await expect(contractProxy.removeFromWhitelist([whitelistedAccount]))
        .to.emit(contractProxy, removeFromWhitelistEventName)
        .withArgs(whitelistedAccount);
    });

    it("reverts if caller is not the owner", async () => {
      await expect(contractProxy.connect(account2).removeFromWhitelist([whitelistedAccount])).to.be.reverted;
    });
  });

  describe("setFeeRate", () => {
    const updateFeeRateEventName = "UpdateFeeRate";
    let maxAllowedFeeRate: BigNumber;

    beforeEach(async () => {
      maxAllowedFeeRate = await contractProxy.MAX_FEE_RATE();
      expect(initialFeeRateManager.address).equals(await contractProxy.feeRateManager());
    });

    it("sets a new fee rate", async () => {
      const feeRate = await contractProxy.feeRate();
      const newFeeRate = maxAllowedFeeRate.sub(feeRate);

      await contractProxy.connect(initialFeeRateManager).setFeeRate(newFeeRate);

      expect(await contractProxy.feeRate()).equals(newFeeRate);
      expect(newFeeRate).not.equals(feeRate);
    });

    it(`emits ${updateFeeRateEventName} event`, async () => {
      const feeRate = await contractProxy.feeRate();
      const newFeeRate = maxAllowedFeeRate.sub(feeRate);

      await expect(contractProxy.connect(initialFeeRateManager).setFeeRate(newFeeRate))
        .to.emit(contractProxy, updateFeeRateEventName)
        .withArgs(newFeeRate);
    });

    it("reverts if a new fee rate exceeds the max allowed fee rate", async () => {
      await expect(contractProxy.connect(initialFeeRateManager).setFeeRate(maxAllowedFeeRate.add(1))).to.be
        .reverted;
    });

    it("reverts if caller is not the fee rate manager", async () => {
      const notFeeRateManager = owner;
      const fee = await contractProxy.feeRate();
      const newFee = maxAllowedFeeRate.sub(fee);

      expect(initialFeeRateManager.address).not.equals(notFeeRateManager.address);
      await expect(contractProxy.connect(notFeeRateManager).setFeeRate(newFee)).to.be.reverted;
    });
  });

  describe("setFeeRateManager", () => {
    const updateFeeRateManagerEventName = "UpdateFeeRateManager";

    beforeEach(async () => {
      expect(initialFeeRateManager.address).equals(await contractProxy.feeRateManager());
    });

    it("sets a new fee rate manager's address", async () => {
      const feeRateManager = await contractProxy.feeRateManager();
      const newFeeRateManager = ethers.Wallet.createRandom().address;

      await contractProxy.connect(initialFeeRateManager).setFeeRateManager(newFeeRateManager);

      expect(await contractProxy.feeRateManager()).equals(newFeeRateManager);
      expect(newFeeRateManager).not.equals(feeRateManager);
    });

    it(`emits ${updateFeeRateManagerEventName} event`, async () => {
      const newFeeRateManager = ethers.Wallet.createRandom().address;
      await expect(contractProxy.connect(initialFeeRateManager).setFeeRateManager(newFeeRateManager))
        .to.emit(contractProxy, updateFeeRateManagerEventName)
        .withArgs(newFeeRateManager);
    });

    it("reverts if a new fee rate manager's address is the Zero Address", async () => {
      await expect(contractProxy.connect(initialFeeRateManager).setFeeRateManager(ethers.constants.AddressZero)).to
        .be.reverted;
    });

    it("reverts if caller is not the fee rate manager", async () => {
      const notFeeRateManager = owner;

      expect(await contractProxy.feeRateManager()).not.to.equal(notFeeRateManager.address);
      await expect(contractProxy.connect(notFeeRateManager).setFeeRateManager(notFeeRateManager.address)).to.be
        .reverted;
    });
  });

  describe("setFeeRecipient", () => {
    const updateFeeRecipientEventName = "UpdateFeeRecipient";

    it("sets a new fee recipient's address", async () => {
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

      expect(await contractProxy.owner()).not.to.equal(notOwner.address);
      await expect(contractProxy.connect(notOwner).setFeeRecipient(notOwner.address)).to.be.reverted;
    });
  });

  describe("setIsWhitelisting", () => {
    const toggleWhitelistingEventName = "ToggleWhitelisting";

    it("sets the whitelisting state", async () => {
      const whitelistingIsTrue = true;
      await contractProxy.setIsWhitelisting(whitelistingIsTrue);

      expect(await contractProxy.isWhitelisting()).equals(whitelistingIsTrue);

      const whitelistingIsFalse = false;
      await contractProxy.setIsWhitelisting(whitelistingIsFalse);

      expect(await contractProxy.isWhitelisting()).equals(whitelistingIsFalse);
    });

    it(`emits ${toggleWhitelistingEventName} event`, async () => {
      const whitelistingIsTrue = true;
      const feeRate = await contractProxy.feeRate();

      await expect(contractProxy.setIsWhitelisting(whitelistingIsTrue))
        .to.emit(contractProxy, toggleWhitelistingEventName)
        .withArgs(whitelistingIsTrue);
    });

    it("reverts if caller is not the owner", async () => {
      const notOwner = account1;

      expect(await contractProxy.owner()).not.equals(notOwner.address);
      await expect(contractProxy.connect(notOwner).setIsWhitelisting(false)).to.be.reverted;
    });
  });

  describe("setWhitelistManager", () => {
    const updateWhitelistManagerEventName = "UpdateWhitelistManager";

    it("sets a new whitelist manager's address", async () => {
      const whitelistManager = await contractProxy.whitelistManager();
      const newWhitelistManager = ethers.Wallet.createRandom().address;

      await contractProxy.setWhitelistManager(newWhitelistManager);

      expect(await contractProxy.whitelistManager()).equals(newWhitelistManager);
      expect(newWhitelistManager).not.equals(whitelistManager);
    });

    it(`emits ${updateWhitelistManagerEventName} event`, async () => {
      const newWhitelistManager = ethers.Wallet.createRandom().address;
      await expect(contractProxy.setWhitelistManager(newWhitelistManager))
        .to.emit(contractProxy, updateWhitelistManagerEventName)
        .withArgs(newWhitelistManager);
    });

    it("reverts if a new whitelist manager's address is the Zero Address", async () => {
      await expect(contractProxy.setWhitelistManager(ethers.constants.AddressZero)).to.be.reverted;
    });

    it("reverts if caller is not the owner", async () => {
      const notOwner = account1;

      expect(await contractProxy.owner()).not.to.equal(notOwner.address);
      await expect(contractProxy.connect(notOwner).setWhitelistManager(notOwner.address)).to.be.reverted;
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

    it("burns caller's tokens", async () => {
      const { address } = account1;
      const amountToMint = BigNumber.from(getPositiveInteger());

      await contractProxy.mint(address, amountToMint, defaultData);

      const amountToBurn = oneToken.mul(chance.natural({ min: 0, max: amountToMint }));
      const initialBalance = await contractProxy.balanceOf(address);
      const initialTotalSupply = await contractProxy.totalSupply();

      await contractProxy.connect(account1).burn(userId, amountToBurn);

      expect(await contractProxy.balanceOf(address)).equals(initialBalance.sub(amountToBurn));
      expect(await contractProxy.totalSupply()).equals(initialTotalSupply.sub(amountToBurn));
    });

    it(`emits ${burnEventName} event`, async () => {
      const { address } = owner;
      const amount = BigNumber.from(getPositiveInteger());
      await contractProxy.mint(address, amount, defaultData);

      await expect(contractProxy.burn(userId, oneToken.mul(amount)))
        .to.emit(contractProxy, burnEventName)
        .withArgs(address, userId, oneToken.mul(amount));
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

      const feeRecipientBalanceWithFee = await contractProxy.balanceOf(feeRecipient);

      await contractProxy.collectFees();

      const totalSupply = await contractProxy.totalSupply();
      const feesAccumulated = totalSupply.sub(totalSupply.mul(expectedFeeIndex).div(prevFeeIndex));

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

      await expect(contractProxy.collectFees())
        .to.emit(contractProxy, collectFeesEventName)
        .withArgs(
          (
            await contractProxy.totalSupply()
          ).sub((await contractProxy.totalSupply()).mul(expectedFeeIndex).div(feeIndex)),
          expectedFeeIndex
        );
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

      await expect(contractProxy.collectFees())
        .to.emit(contractProxy, burnFeeEventName)
        .withArgs(
          feeRecipient,
          fee,
          feeRecipientBalanceWithFee.add(
            (
              await contractProxy.totalSupply()
            ).sub((await contractProxy.totalSupply()).mul(expectedFeeIndex).div(feeIndex))
          ),
          expectedFeeIndex
        );
    });
  });

  describe("totalSupply", () => {
    it("it shows total supply considering fees", async () => {
      const { address } = account1;
      const amountToMint = getPositiveInteger();

      await contractProxy.mint(address, amountToMint, defaultData);

      const totalSupply1 = await contractProxy.totalSupply();

      expect(totalSupply1).equals(oneToken.mul(amountToMint));

      const daysLater = getDaysLater();

      await ethers.provider.send("evm_increaseTime", [daysLater * secondsPerDay]);
      await ethers.provider.send("evm_mine", []);

      const feeIndex = await contractProxy.feeIndex();
      const expectedFeeIndex = await calculateFeeIndex(contractProxy, daysLater);

      const totalSupply2 = await contractProxy.totalSupply();

      expect(totalSupply2).equals(totalSupply1.mul(expectedFeeIndex).div(feeIndex));
    });
  });

  describe("whitelisting", () => {
    let amountToTransfer: BigNumber;

    const amountToMint = getPositiveInteger();
    beforeEach(async () => {
      amountToTransfer = oneToken.mul(amountToMint).sub(oneToken);
      await contractProxy.setIsWhitelisting(true);
    });

    it("allows to transfer from balances of the owner or whitelist manager to not whitelisted addresses", async () => {
      // transfer from owner's balance
      await contractProxy.mint(owner.address, amountToMint, defaultData);

      const recipientFromOwner = ethers.Wallet.createRandom().address;

      expect(await contractProxy.isWhitelisted(recipientFromOwner)).false;

      const recipientFromOwnerInitialBalance = await contractProxy.balanceOf(recipientFromOwner);

      await contractProxy.transfer(recipientFromOwner, amountToTransfer);

      const recipientFromOwnerBalanceAfterTransfer = await contractProxy.balanceOf(recipientFromOwner);

      expect(recipientFromOwnerBalanceAfterTransfer).equals(
        recipientFromOwnerInitialBalance.add(amountToTransfer)
      );

      // transfer from whitelist manager's balance
      await contractProxy.setWhitelistManager(account1.address);

      expect(account1.address).equals(await contractProxy.whitelistManager());

      await contractProxy.mint(account1.address, amountToMint, defaultData);

      await contractProxy.connect(account1).approve(account2.address, amountToTransfer);

      const recipientFromWhitelistManager = ethers.Wallet.createRandom().address;

      expect(await contractProxy.isWhitelisted(recipientFromWhitelistManager)).false;

      const recipientFromWhitelistManagerInitialBalance = await contractProxy.balanceOf(
        recipientFromWhitelistManager
      );

      await contractProxy
        .connect(account2)
        .transferFrom(account1.address, recipientFromWhitelistManager, amountToTransfer);

      const recipientFromWhitelistManagerBalanceAfterTransfer = await contractProxy.balanceOf(
        recipientFromWhitelistManager
      );

      expect(recipientFromWhitelistManagerBalanceAfterTransfer).equals(
        recipientFromWhitelistManagerInitialBalance.add(amountToTransfer)
      );
    });

    it("reverts when transferring from not authorized balance to not whitelisted address", async () => {
      await contractProxy.mint(account2.address, amountToMint, defaultData);

      const recipient = ethers.Wallet.createRandom().address;

      expect(await contractProxy.isWhitelisted(recipient)).false;
      await expect(contractProxy.connect(account2).transfer(recipient, amountToTransfer)).to.be.reverted;

      await contractProxy.connect(account2).approve(owner.address, amountToMint);

      await expect(contractProxy.transferFrom(account2.address, recipient, amountToTransfer)).to.be.reverted;
    });

    it("whitelists the recipient after the transfer from authorized balances regardless of whitelisting state", async () => {
      await contractProxy.mint(owner.address, amountToMint, defaultData);

      const recipient1 = ethers.Wallet.createRandom().address;

      expect(await contractProxy.isWhitelisted(recipient1)).false;

      await contractProxy.transfer(recipient1, amountToTransfer);

      expect(await contractProxy.isWhitelisted(recipient1)).true;

      await contractProxy.setIsWhitelisting(false);
      await contractProxy.setWhitelistManager(account1.address);

      await contractProxy.mint(owner.address, amountToMint, defaultData);

      const recipient2 = ethers.Wallet.createRandom().address;

      expect(await contractProxy.isWhitelisted(recipient2)).false;

      await contractProxy.transfer(recipient2, amountToTransfer);

      expect(await contractProxy.isWhitelisted(recipient2)).true;
    });
  });
});
