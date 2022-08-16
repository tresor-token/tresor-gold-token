# Tresor Gold Token (TAUT)

Gold-collateralized ERC20 stablecoin smart contract repository.

https://tresor-token.li

## Contract

### Documentation

The link to the docs is supposed to be here.

### ERC20

Tresor Gold Token uses OpenZeppelin's [ERC20Upgradeable](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/51e11611c40ec1ad772e2a075cdc8487bbadf8ad/contracts/token/ERC20/ERC20Upgradeable.sol) as base contract ([Click here](https://docs.openzeppelin.com/contracts/4.x/api/token/erc20) to see OpenZeppelin's ERC20 docs). However, its visibility of the `_balances` state variable has been changed from private to internal to be able to change accounts balances without changing the total supply in order to implement the specific fee model. Original `balanceOf` has been overriden and returns account's balance, obtained after subtraction account's fee (See [here](#balanceof)). Hook `_beforeTokenTransfer` is used to call `collectFees` function (See [here](#collectfees)).

### Contract public API

#### <ins>MAX_BPS</ins>

```solidity
function MAX_BPS() public view returns (uint256)
```

Returns constant value of 100 percent in basis points.

#### <ins>MAX_FEE_RATE</ins>

```solidity
function MAX_FEE_RATE() public view returns (uint256)
```

Returns constant maximum possible fee rate per constant [time period](#fee_period_days) in basis points.

#### <ins>FEE_PERIOD_DAYS</ins>

```solidity
function FEE_PERIOD_DAYS() public view returns (uint256)
```

Returns constant time period in days for which the fee rate is determined.

#### <ins>DECAY_RATIO_DENOMINATOR</ins>

```solidity
function DECAY_RATIO_DENOMINATOR() public view returns (uint256)
```

Returns constant product of [MAX_BPS](#max_bps) and [FEE_PERIOD_DAYS](#fee_period_days) which is used for the compound decay calculation.

#### <ins>feeRate</ins>

```solidity
function feeRate() public view returns (uint256)
```

Returns current fee rate, which was set by contract's owner. Fee rate cannot be greater than [MAX_FEE_RATE](#max_fee_rate).

#### <ins>feeRecipient</ins>

```solidity
function feeRecipient() public view returns (address)
```

Returns current fee recipient's address.

#### <ins>feeIndex</ins>

```solidity
function feeIndex() public view returns (uint256)
```

Returns current fee index, which is used to track time's and fee rate's dynamics.

#### <ins>feesCollectionDay</ins>

```solidity
function feesCollectionDay() public view returns (uint256)
```

Returns the number of days since the unix epoch when fees was last collected at.

#### <ins>accountsFeeIndices</ins>

```solidity
function accountsFeeIndices(address account) public view returns (uint256)
```

Returns the value of [fee index](#feeindex) on the day when `account` balance was last changed manually
(i.e. not by automatic fee withdrawal).

| Name    | Type    | Description                         |
| ------- | ------- | ----------------------------------- |
| account | address | The account which fee index to get. |

#### <ins>burn</ins>

```solidity
function burn(bytes16 id, uint256 amount) external
```

If `amount` of tokens is multiple of 1000000000000000000000, destroys the amount
from the caller's account, reducing the total supply.

| Name   | Type    | Description                                                      |
| ------ | ------- | ---------------------------------------------------------------- |
| id     | bytes16 | User id, automatically generated in the web application backend. |
| amount | uint256 | The amount of tokens to burn.                                    |

#### <ins>collectFees</ins>

```solidity
function collectFees() external
```

Collects total fees and fee recipient fees and transfers them to the fee recipient.

#### <ins>balanceOf</ins>

```solidity
function balanceOf(address account) public view returns (uint256)
```

Returns the amount of tokens owned by `account` account, obtained after subtraction account fee.

| Name    | Type    | Description                                   |
| ------- | ------- | --------------------------------------------- |
| account | address | The address whose balance should be returned. |

### Contract Events

#### <ins>Mint</ins>

```solidity
event Mint(address to, uint256 amount, string data)
```

Emitted when `amount` of tokens was minted to `to` account.

| Name   | Type    | Description                                     |
| ------ | ------- | ----------------------------------------------- |
| to     | address | The account minted tokens were assigned to.     |
| amount | uint256 | The amount of minted tokens.                    |
| data   | string  | The data about minting (e.g. bank document id). |

#### <ins>Burn</ins>

```solidity
event Burn(address from, bytes16 id, uint256 amount)
```

Emitted when `from` account burned `amount` of tokens.

| Name   | Type    | Description                                                      |
| ------ | ------- | ---------------------------------------------------------------- |
| from   | address | The caller.                                                      |
| id     | bytes16 | User id, automatically generated in the web application backend. |
| amount | uint256 | The amount of burned tokens.                                     |

#### <ins>UpdateFeeRate</ins>

```solidity
event UpdateFeeRate(uint256 feeRate)
```

Emitted when fee rate was updated.

| Name    | Type    | Description       |
| ------- | ------- | ----------------- |
| feeRate | uint256 | The new fee rate. |

#### <ins>UpdateFeeRecipient</ins>

```solidity
event UpdateFeeRecipient(address feeRecipient)
```

Emitted when fee recipient's address was updated.

| Name         | Type    | Description                      |
| ------------ | ------- | -------------------------------- |
| feeRecipient | address | The new fee recipient's address. |

#### <ins>CollectFees</ins>

```solidity
event CollectFees(uint256 amount, uint256 feeIndex)
```

Emitted when fees were collected.

| Name     | Type    | Description                                          |
| -------- | ------- | ---------------------------------------------------- |
| amount   | uint256 | The amount of collected fees.                        |
| feeIndex | uint256 | The feeIndex value calculated on the collection day. |

#### <ins>BurnFee</ins>

```solidity
event BurnFee(address from, uint256 amount, uint256 balance, uint256 feeIndex)
```

Emitted when `amount` of fee was burned from `from` account.

| Name     | Type    | Description                                                  |
| -------- | ------- | ------------------------------------------------------------ |
| from     | address | The account fee was burned from.                             |
| amount   | uint256 | The amount of burned fee.                                    |
| balance  | uint256 | The account balance.                                         |
| feeIndex | uint256 | The feeIndex value calculated on the day of the fee burning. |

### Ownable

The contract has an owner and its corresponding functionality, following OpenZeppelin's [OwnableUpgradeable](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/51e11611c40ec1ad772e2a075cdc8487bbadf8ad/contracts/access/OwnableUpgradeable.sol). The owner can mint tokens, set fee rate, and change `owner` and `feeRecipient` addresses.

### Upgradeable

A new implementation contract can be deployed, and the proxy contract will forward calls to the new contract. Access to the upgrade functionality is guarded by an [`owner`](#ownable). Upgradeability provided by OpenZeppelin's [UUPSUpgradeable](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/51e11611c40ec1ad772e2a075cdc8487bbadf8ad/contracts/proxy/utils/UUPSUpgradeable.sol) and [Initializable](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/51e11611c40ec1ad772e2a075cdc8487bbadf8ad/contracts/proxy/utils/Initializable.sol).

## Testing

### Prerequisites

- Node (>= v12.0.0)
- npm (>= v6.9.0)
- solc (v0.8.9)

### Testing Environment Setup:

- Clone the repository and install dependencies

```
git clone git@bitbucket.org:tresor-token/smart-contracts.git
cd smart-contracts
npm install
```

- Compile contracts

```
npx hardhat compile
```

- Run tests

```
npx hardhat test
```

- Run tests and generate test coverage

```
npx hardhat coverage
```

## License

The smart contract (i.e. all code inside of the contracts and test directories) is licensed under the MIT License.
