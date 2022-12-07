// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./lib/ERC20Upgradeable.sol";
import "./lib/PRBMathUD60x18Typed.sol";

error TAUT_CannotBeZeroAddress();
error TAUT_InvalidFeeRate();
error TAUT_NotFeeRateManager();
error TAUT_NotWhitelisted();

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
  // The account address that can change fee rate
  address public feeRateManager;
  // The address of fee recipient
  address public feeRecipient;
  // The account address that can add accounts to whitelist by transferring tokens
  address public whitelistManager;
  // The variable is used to track time and fee rate dynamics
  uint256 public feeIndex;
  // The number of days since the unix epoch, that fees was last collected at
  uint256 public feesCollectionDay;
  // Shows if the whitelisting is enabled
  bool public isWhitelisting;
  // Mapping from account address to the fee index value on the day when the balance of the corresponding account
  // was updated manually (i.e. not by automatic fee withdrawal).
  mapping(address => uint256) public accountsFeeIndices;
  // Mapping that shows if the account address is whitelisted.
  mapping(address => bool) public isWhitelisted;

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
   * @notice Emitted when `account` account added to whitelist.
   * @param account The account added to whitelist.
   */
  event AddToWhitelist(address account);

  /**
   * @notice Emitted when `account` account removed from whitelist.
   * @param account The account removed from whitelist.
   */
  event RemoveFromWhitelist(address account);

  /**
   * @notice Emitted when whitelisting was toggled.
   * @param isWhitelisting Shows if the whitelisting was enabled or disabled.
   */
  event ToggleWhitelisting(bool isWhitelisting);

  /**
   * @notice Emitted when fee rate was updated.
   * @param feeRate The new fee rate.
   */
  event UpdateFeeRate(uint256 feeRate);

  /**
   * @notice Emitted when fee rate manager's address was updated.
   * @param feeRateManager The new fee rate manager's address.
   */
  event UpdateFeeRateManager(address feeRateManager);

  /**
   * @notice Emitted when fee recipient's address was updated.
   * @param feeRecipient The new fee recipient's address.
   */
  event UpdateFeeRecipient(address feeRecipient);

  /**
   * @notice Emitted when whitelist manager's address was updated.
   * @param whitelistManager The new whitelist manager's address.
   */
  event UpdateWhitelistManager(address whitelistManager);

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

  /**
   * @dev Throws if called by any account other than the fee rate manager.
   */
  modifier onlyFeeRateManager() {
    if (msg.sender != feeRateManager) {
      revert TAUT_NotFeeRateManager();
    }
    _;
  }

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  /**
   * @notice Initializes the contract.
   * @param feeRecipient_ The address of fee recipient.
   * @param feeRate_ The fee rate.
   * @param whitelistManager_ The address of whitelist manager.
   * @param isWhitelisting_ The whitelisting state.
   */
  function initialize(
    uint256 feeRate_,
    address feeRateManager_,
    address feeRecipient_,
    address whitelistManager_,
    bool isWhitelisting_
  ) external initializer {
    __ERC20_init("Tresor Gold Token", "TAUT");
    __Ownable_init();
    __UUPSUpgradeable_init();

    feesCollectionDay = _timestampToDays(block.timestamp);
    feeIndex = type(uint128).max;

    _setFeeRate(feeRate_);
    _setFeeRateManager(feeRateManager_);
    _setFeeRecipient(feeRecipient_);
    _setWhitelistManager(whitelistManager_);
    _setIsWhitelisting(isWhitelisting_);
  }

  /**
   * @notice Adds `accounts` accounts to whitelist.
   * @param accounts Accounts to whitelist.
   */
  function addToWhitelist(address[] memory accounts) external onlyOwner {
    for (uint256 i; i < accounts.length; i = _unsafeIncrement(i)) {
      _addToWhitelist(accounts[i]);
    }
  }

  /**
   * @notice Returns the amount of tokens owned by `account` account, obtained after subtraction account fee.
   * @param account The address whose balance should be returned.
   * @return The amount of tokens owned by the specified account.
   */
  function balanceOf(address account) external view override returns (uint256) {
    uint256 accountFeeIndex = accountsFeeIndices[account];
    uint256 accountBalance = _balances[account];

    if (accountFeeIndex > 0 && accountBalance > 0) {
      (, uint256 newFeeIndex) = _calculateFeeData();

      return (accountBalance * newFeeIndex) / accountFeeIndex;
    }

    return 0;
  }

  /**
   * @notice Destroys `amount` tokens from the caller's account, reducing the total supply.
   * @param id User id, automatically generated in the web application backend.
   * @param amount The amount of tokens to burn.
   */
  function burn(bytes16 id, uint256 amount) external {
    _burn(msg.sender, amount);

    emit Burn(msg.sender, id, amount);
  }

  /**
   * @notice Calculates compound decay for which the rate is set for `FEE_PERIOD_DAYS`.
   * @param initialAmount The initial amount to decay.
   * @param decayRateBps The decay rate in basis points.
   * @param elapsedTimeDays The time period in days for which the calculation is performed.
   */
  function calculateCompoundDecay(
    uint256 initialAmount,
    uint256 decayRateBps,
    uint256 elapsedTimeDays
  ) external pure returns (uint256) {
    return _calculateCompoundDecay(initialAmount, decayRateBps, elapsedTimeDays);
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
    uint256 tokensAmount = amount * 10**decimals();
    _mint(account, tokensAmount);

    emit Mint(account, tokensAmount, data);
  }

  /**
   * @notice Removes `accounts` accounts from whitelist.
   * @param accounts Accounts to remove from whitelist.
   */
  function removeFromWhitelist(address[] memory accounts) external onlyOwner {
    for (uint256 i; i < accounts.length; i = _unsafeIncrement(i)) {
      address account = accounts[i];

      isWhitelisted[account] = false;

      emit RemoveFromWhitelist(account);
    }
  }

  /**
   * @notice Collects fees with previous fee rate and sets a new fee rate.
   * @param feeRate_ The new fee rate to set.
   */
  function setFeeRate(uint256 feeRate_) external onlyFeeRateManager {
    _setFeeRate(feeRate_);
  }

  /**
   * @notice Sets a new fee rate manager address.
   * @param feeRateManager_ The address of a new fee rate manager.
   */
  function setFeeRateManager(address feeRateManager_) external onlyFeeRateManager {
    _setFeeRateManager(feeRateManager_);
  }

  /**
   * @notice Sets a new fee recipient address.
   * @param feeRecipient_ The address of a new fee recipient.
   */
  function setFeeRecipient(address feeRecipient_) external onlyOwner {
    _setFeeRecipient(feeRecipient_);
  }

  /**
   * @notice Sets the whitelisting state.
   * @param isWhitelisting_ The whitelisting state.
   */
  function setIsWhitelisting(bool isWhitelisting_) external onlyOwner {
    _setIsWhitelisting(isWhitelisting_);
  }

  /**
   * @notice Sets a new whitelist manager address.
   * @param whitelistManager_ The address of a new whitelist manager.
   */
  function setWhitelistManager(address whitelistManager_) external onlyOwner {
    _setWhitelistManager(whitelistManager_);
  }

  /**
   * @notice Returns the total amount of tokens, considering accounts fees.
   * @return The amount of tokens owned by all accounts.
   */
  function totalSupply() external view override returns (uint256) {
    (, uint256 newFeeIndex) = _calculateFeeData();
    return (_totalSupply * newFeeIndex) / feeIndex;
  }

  function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

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
      if (from == owner() || from == whitelistManager) {
        if (!isWhitelisted[to]) _addToWhitelist(to);
      } else if (isWhitelisting && !isWhitelisted[to]) {
        revert TAUT_NotWhitelisted();
      }

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

  function _addToWhitelist(address account) internal {
    isWhitelisted[account] = true;

    emit AddToWhitelist(account);
  }

  /**
   * @dev Calculates fee for `account` account.
   */
  function _calculateAccountFee(address account) internal view returns (uint256) {
    uint256 accountFeeIndex = accountsFeeIndices[account];
    uint256 accountBalance = _balances[account];
    uint256 feeIndex_ = feeIndex;

    if (accountFeeIndex != feeIndex_ && accountFeeIndex > 0 && accountBalance > 0) {
      return accountBalance - (accountBalance * feeIndex_) / accountFeeIndex;
    }

    return 0;
  }

  function _calculateCompoundDecay(
    uint256 initialAmount,
    uint256 decayRateBps,
    uint256 elapsedTimeDays
  ) internal pure returns (uint256) {
    // initialAmount * (1 - (decayRateBps / (MAX_BPS * FEE_PERIOD_DAYS)))**elapsedTimeDays
    return
      PRBMathUD60x18Typed.toUint(
        PRBMathUD60x18Typed.mul(
          PRBMathUD60x18Typed.fromUint(initialAmount),
          PRBMathUD60x18Typed.powu(
            PRBMathUD60x18Typed.sub(
              PRBMathUD60x18Typed.fromUint(1),
              PRBMathUD60x18Typed.div(
                PRBMathUD60x18Typed.fromUint(decayRateBps),
                PRBMathUD60x18Typed.fromUint(DECAY_RATIO_DENOMINATOR)
              )
            ),
            elapsedTimeDays
          )
        )
      );
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

    uint256 newFeeIndex = _calculateCompoundDecay(feeIndex, feeRate, currentDay - prevFeesCollectionDay);

    return (currentDay, newFeeIndex);
  }

  function _collectFees() internal {
    (uint256 currentDay, uint256 newFeeIndex) = _calculateFeeData();

    if (currentDay == feesCollectionDay) {
      return;
    }

    uint256 totalSupply_ = _totalSupply;
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
    if (feeRate_ > MAX_FEE_RATE) {
      revert TAUT_InvalidFeeRate();
    }

    _collectFees();
    feeRate = feeRate_;

    emit UpdateFeeRate(feeRate_);
  }

  function _setFeeRateManager(address feeRateManager_) internal {
    if (feeRateManager_ == address(0)) {
      revert TAUT_CannotBeZeroAddress();
    }

    feeRateManager = feeRateManager_;

    emit UpdateFeeRateManager(feeRateManager_);
  }

  function _setFeeRecipient(address feeRecipient_) internal {
    if (feeRecipient_ == address(0)) {
      revert TAUT_CannotBeZeroAddress();
    }

    feeRecipient = feeRecipient_;

    emit UpdateFeeRecipient(feeRecipient_);
  }

  function _setIsWhitelisting(bool isWhitelisting_) internal {
    isWhitelisting = isWhitelisting_;

    emit ToggleWhitelisting(isWhitelisting_);
  }

  function _setWhitelistManager(address whitelistManager_) internal {
    if (whitelistManager_ == address(0)) {
      revert TAUT_CannotBeZeroAddress();
    }

    whitelistManager = whitelistManager_;

    emit UpdateWhitelistManager(whitelistManager_);
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
