
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TokenVaultV1 is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    uint256 public constant MAX_DEPOSIT_FEE = 1000;

    IERC20 internal token;
    uint256 internal depositFee;
    uint256 internal _totalDeposits;
    uint256 internal _collectedFees;

    mapping(address => uint256) internal balances;

    event Deposit(
        address indexed user,
        uint256 amount,
        uint256 credited,
        uint256 fee
    );
    event Withdraw(address indexed user, uint256 amount);
    event DepositFeeUpdated(uint256 oldFee, uint256 newFee);
    event UpgradeAuthorized(
        address indexed newImplementation,
        address indexed authorizedBy
    );
    event FeesWithdrawn(address indexed to, uint256 amount);

    error InvalidToken();
    error InvalidAdmin();
    error InvalidAmount();
    error FeeTooHigh();
    error InsufficientBalance();
    error NoFeesToWithdraw();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _admin,
        uint256 _depositFee
    ) external initializer {
        if (_token == address(0)) revert InvalidToken();
        if (_admin == address(0)) revert InvalidAdmin();
        if (_depositFee > MAX_DEPOSIT_FEE) revert FeeTooHigh();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        token = IERC20(_token);
        depositFee = _depositFee;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(UPGRADER_ROLE, _admin);
    }

    function deposit(uint256 amount) external virtual nonReentrant {
        if (amount == 0) revert InvalidAmount();

        uint256 fee = (amount * depositFee) / 10_000;
        uint256 credited = amount - fee;

        token.safeTransferFrom(msg.sender, address(this), amount);

        balances[msg.sender] += credited;
        _totalDeposits += credited;
        _collectedFees += fee;

        emit Deposit(msg.sender, amount, credited, fee);
    }

    function withdraw(uint256 amount) public virtual nonReentrant {
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        balances[msg.sender] -= amount;
        _totalDeposits -= amount;

        token.safeTransfer(msg.sender, amount);

        emit Withdraw(msg.sender, amount);
    }

    function withdrawFees(address to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert InvalidAdmin();
        uint256 fees = _collectedFees;
        if (fees == 0) revert NoFeesToWithdraw();
        _collectedFees = 0;
        token.safeTransfer(to, fees);
        emit FeesWithdrawn(to, fees);
    }

    function getCollectedFees() external view returns (uint256) {
        return _collectedFees;
    }

    function balanceOf(address user) external view returns (uint256) {
        return balances[user];
    }

    function totalDeposits() external view returns (uint256) {
        return _totalDeposits;
    }

    function getDepositFee() external view returns (uint256) {
        return depositFee;
    }

    function getToken() external view returns (address) {
        return address(token);
    }

    function getImplementationVersion()
        external
        pure
        virtual
        returns (string memory)
    {
        return "V1";
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override onlyRole(UPGRADER_ROLE) {
        emit UpgradeAuthorized(newImplementation, msg.sender);
    }

    uint256[44] private __gap;
}
