// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./lib/ERC20Upgradeable.sol";

contract TAUT is Initializable, ERC20Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
  // 100% in basis points
  uint256 public constant MAX_BPS = 10000;
  // Maximum possible fee rate per FEE_PERIOD_DAYS in basis points
  uint256 public constant MAX_FEE_RATE = (4 * MAX_BPS) / 100;
  // Time period in days for which the fee rate is determined
  uint256 public constant FEE_PERIOD_DAYS = 366;
  // Constant denominator which is used for the compound decay calculation
  uint256 public constant DECAY_RATIO_DENOMINATOR = MAX_BPS * FEE_PERIOD_DAYS;
  // Fee rate in basis points
  uint256 public feeRate;
  // Fee recipients address
  address public feeRecipient;
  // The variable is used to track time and fee rate dynamics
  uint256 public feeIndex;
  // The number of days since the unix epoch, that fees was last collected at.
  uint256 public feesCollectionDay;
  // Mapping from account address to the fee index value on the day when the balance of the corresponding account
  // was updated manually (i.e. not by automatic fee withdrawal).
  mapping(address => uint256) public accountsFeeIndices;

  /**
   * @notice Emitted when `amount` of tokens was minted to `to` account.
   * @param to The account minted tokens were assigned to.
   * @param amount The amount of minted tokens.
   * @param data The data about minting (e.g. bank document id).
   */
  event Mint(address indexed to, uint256 amount, string indexed data);

  /**
   * @notice Emitted when `from` account burned `amount` of tokens.
   * @param from The caller.
   * @param id User id, automatically generated in the web application backend.
   * @param amount The amount of burned tokens.
   */
  event Burn(address indexed from, bytes16 id, uint256 amount);

  /**
   * @notice Emitted when fee rate was updated.
   * @param feeRate The new fee rate.
   */
  event UpdateFeeRate(uint256 feeRate);

  /**
   * @notice Emitted when fee recipient's address was updated.
   * @param feeRecipient The new fee recipient's address.
   */
  event UpdateFeeRecipient(address feeRecipient);

  /**
   * @notice Emitted when fees were collected.
   * @param amount The amount of collected fees.
   * @param feeIndex The feeIndex value calculated on the collection day.
   */
  event CollectFees(uint256 amount, uint256 feeIndex);

  /**
   * @notice Emitted when `amount` of fee was burned from `from` account.
   * @param from The account fee was burned from.
   * @param amount The amount of burned fee.
   * @param balance The account balance.
   * @param feeIndex The feeIndex value calculated on the day of the fee burning.
   */
  event BurnFee(address indexed from, uint256 amount, uint256 balance, uint256 feeIndex);

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  /**
   * @notice Initializes the contract.
   * @param feeRecipient_ The address of initial fee recipient.
   * @param feeRate_ The initial fee rate.
   */
  function initialize(address feeRecipient_, uint256 feeRate_) public initializer {
    __ERC20_init("Tresor Gold Token", "TAUT");
    __Ownable_init();
    __UUPSUpgradeable_init();

    feesCollectionDay = _timestampToDays(block.timestamp);
    feeIndex = type(uint128).max;

    _setFeeRecipient(feeRecipient_);
    _setFeeRate(feeRate_);
  }

  function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

  /**
   * @notice If `amount` of tokens is multiple of 1000000000000000000000, destroys the amount
   * from the caller's account, reducing the total supply.
   * @param id User id, automatically generated in the web application backend.
   * @param amount The amount of tokens to burn.
   */
  function burn(bytes16 id, uint256 amount) external {
    require(amount % 1e21 == 0, "Must be multiple of 1000 tokens");

    _burn(msg.sender, amount);

    emit Burn(msg.sender, id, amount);
  }

  /**
   * @notice Collects total fees and fee recipient fees and transfers them to the fee recipient.
   */
  function collectFees() external {
    _collectFees();
  }

  /**
   * @notice Converts `amount` to tokens and assigns the result to `account` account, increasing the total supply.
   * @param account The account to assign minted tokens to.
   * @param amount The amount of tokens to mint.
   * @param data The data about minting (e.g. bank document id).
   */
  function mint(
    address account,
    uint256 amount,
    string calldata data
  ) external onlyOwner {
    uint256 tokensAmount = amount * 10 ** decimals();
    _mint(account, tokensAmount);

    emit Mint(account, tokensAmount, data);
  }

  /**
   * @notice Collects fees with previous fee rate and sets a new fee rate.
   * @param feeRate_ The new fee rate to set.
   */
  function setFeeRate(uint256 feeRate_) external onlyOwner {
    _setFeeRate(feeRate_);
  }

  /**
   * @notice Sets a new fee recipient address.
   * @param feeRecipient_ The address of a new fee recipient.
   */
  function setFeeRecipient(address feeRecipient_) external onlyOwner {
    _setFeeRecipient(feeRecipient_);
  }

  /**
   * @notice Returns the amount of tokens owned by `account` account, obtained after subtraction account fee.
   * @param account The address whose balance should be returned.
   * @return The amount of tokens owned by the specified account.
   */
  function balanceOf(address account) public view override returns (uint256) {
    uint256 accountFeeIndex = accountsFeeIndices[account];
    uint256 accountBalance = super.balanceOf(account);

    if (accountFeeIndex > 0 && accountBalance > 0) {
      (, uint256 newFeeIndex) = _calculateFeeData();

      return (accountBalance * newFeeIndex) / accountFeeIndex;
    }

    return 0;
  }

  /**
   * @dev Collects all fees and burn fees from provided addresses.
   */
  function _beforeTokenTransfer(
    address from,
    address to,
    uint256 amount
  ) internal virtual override {
    super._beforeTokenTransfer(from, to, amount);

    address[] memory accounts;

    if (from == address(0) || to == address(0)) {
      accounts = new address[](1);
      accounts[0] = from == address(0) ? to : from;
    } else {
      accounts = new address[](2);
      accounts[0] = from;
      accounts[1] = to;
    }

    _burnAccountsFee(accounts);
  }

  /**
   * @dev Burns fees from provided accounts.
   */
  function _burnAccountsFee(address[] memory accounts) internal {
    _collectFees();
    uint256 feeIndex_ = feeIndex;

    for (uint256 i; i < accounts.length; i = _unsafeIncrement(i)) {
      address account = accounts[i];
      uint256 accountFee = _calculateAccountFee(account);

      _balances[account] -= accountFee;
      accountsFeeIndices[account] = feeIndex_;

      emit Transfer(account, address(0), accountFee);
      emit BurnFee(account, accountFee, _balances[account], feeIndex_);
    }
  }

  /**
   * @dev Calculates fee for `account` account.
   */
  function _calculateAccountFee(address account) internal view returns (uint256) {
    uint256 accountFeeIndex = accountsFeeIndices[account];
    uint256 accountBalance = super.balanceOf(account);
    uint256 feeIndex_ = feeIndex;

    if (accountFeeIndex != feeIndex_ && accountFeeIndex > 0 && accountBalance > 0) {
      return accountBalance - (accountBalance * feeIndex_) / accountFeeIndex;
    }

    return 0;
  }

  /**
   * @dev Calculates and returns data used to calculate fees.
   */
  function _calculateFeeData() internal view returns (uint256, uint256) {
    uint256 currentDay = _timestampToDays(block.timestamp);
    uint256 prevFeesCollectionDay = feesCollectionDay;

    if (currentDay == prevFeesCollectionDay) {
      return (feesCollectionDay, feeIndex);
    }

    uint256 dayDelta = currentDay - prevFeesCollectionDay;
    uint256 feeRate_ = feeRate;
    uint256 prevFeeIndex = feeIndex;
    uint256 newFeeIndex;

    for (uint256 i; i < dayDelta; i = _unsafeIncrement(i)) {
      unchecked {
        newFeeIndex = prevFeeIndex - (prevFeeIndex * feeRate_) / DECAY_RATIO_DENOMINATOR;
      }
      prevFeeIndex = newFeeIndex;
    }

    return (currentDay, newFeeIndex);
  }

  function _collectFees() internal {
    (uint256 currentDay, uint256 newFeeIndex) = _calculateFeeData();

    if (currentDay == feesCollectionDay) {
      return;
    }

    uint256 totalSupply_ = totalSupply();
    uint256 feesCollected = totalSupply_ - ((totalSupply_ * newFeeIndex) / feeIndex);

    feeIndex = newFeeIndex;
    feesCollectionDay = currentDay;

    address feeRecipient_ = feeRecipient;
    uint256 feeRecipientFee = _calculateAccountFee(feeRecipient_);
    _balances[feeRecipient_] = _balances[feeRecipient_] - feeRecipientFee + feesCollected;
    accountsFeeIndices[feeRecipient_] = newFeeIndex;

    emit Transfer(
      address(0),
      feeRecipient_,
      feesCollected > feeRecipientFee ? feesCollected - feeRecipientFee : 0
    );
    emit CollectFees(feesCollected, newFeeIndex);
    emit BurnFee(feeRecipient_, feeRecipientFee, _balances[feeRecipient_], newFeeIndex);
  }

  function _setFeeRate(uint256 feeRate_) internal {
    require(feeRate_ <= MAX_FEE_RATE, "Invalid fee");
    _collectFees();
    feeRate = feeRate_;

    emit UpdateFeeRate(feeRate_);
  }

  function _setFeeRecipient(address feeRecipient_) internal {
    require(feeRecipient_ != address(0), "Invalid address");

    feeRecipient = feeRecipient_;

    emit UpdateFeeRecipient(feeRecipient_);
  }

  function _timestampToDays(uint256 timestamp) internal pure returns (uint256) {
    return timestamp / 1 days;
  }

  function _unsafeIncrement(uint256 x) internal pure returns (uint256) {
    unchecked {
      return x + 1;
    }
  }
}
