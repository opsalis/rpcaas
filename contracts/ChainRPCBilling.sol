// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ChainRPCBilling
 * @notice Pull-based billing contract for ChainRPC subscriptions.
 *         Users call subscribe() to link their wallet + key hash + tier.
 *         Operator pulls subscription fees monthly and overflow charges as needed.
 *         All funds go directly to the treasury (Tangem wallet).
 *
 * @dev Supports USDC and USDT (ERC-20 with 6 decimals).
 *      Tier 1 = Growth ($29/month = 29_000000)
 *      Tier 2 = Pro    ($99/month = 99_000000)
 *
 * Deployed to Base Sepolia (chainId 84532).
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract ChainRPCBilling {

    // ── Constants ────────────────────────────────────────────────────

    uint256 public constant GROWTH_PRICE = 29_000_000; // $29 in 6-decimal USDC/USDT
    uint256 public constant PRO_PRICE    = 99_000_000; // $99 in 6-decimal USDC/USDT

    uint8 public constant TIER_FREE   = 0;
    uint8 public constant TIER_GROWTH = 1;
    uint8 public constant TIER_PRO    = 2;

    // ── State ────────────────────────────────────────────────────────

    address public owner;
    address public operator;
    address public treasury;

    struct Subscription {
        address wallet;      // wallet that approved and can be pulled from
        address token;       // USDC or USDT address
        uint8   tier;        // 1=Growth, 2=Pro
        uint256 subscribedAt; // timestamp
        bool    active;
    }

    // keyHash => Subscription
    mapping(bytes32 => Subscription) public subscriptions;

    // keyHash => registered timestamp (KeyRegistered event + this mapping)
    mapping(bytes32 => uint256) public keyRegistrations;

    // ── Events ───────────────────────────────────────────────────────

    event KeyRegistered(bytes32 indexed keyHash, uint256 timestamp);

    event Subscribed(
        bytes32 indexed keyHash,
        address indexed wallet,
        address token,
        uint8 tier,
        uint256 amount
    );

    event Pulled(
        bytes32 indexed keyHash,
        address indexed wallet,
        address token,
        uint256 amount
    );

    event OverflowCharged(
        bytes32 indexed keyHash,
        address indexed wallet,
        address token,
        uint256 amount
    );

    event SubscriptionCancelled(bytes32 indexed keyHash);

    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event OperatorUpdated(address oldOperator, address newOperator);

    // ── Modifiers ─────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == owner, "Not operator");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────

    constructor(address _treasury, address _operator) {
        owner     = msg.sender;
        treasury  = _treasury;
        operator  = _operator;
    }

    // ── Key Registration ──────────────────────────────────────────────

    /**
     * @notice Register a key hash on-chain (called by backend worker when a
     *         free key is generated). Emits KeyRegistered event for indexing.
     * @param keyHash SHA-256 hash of the API key (bytes32)
     */
    function registerKey(bytes32 keyHash) external onlyOperator {
        require(keyRegistrations[keyHash] == 0, "Key already registered");
        keyRegistrations[keyHash] = block.timestamp;
        emit KeyRegistered(keyHash, block.timestamp);
    }

    // ── Subscription ──────────────────────────────────────────────────

    /**
     * @notice Link a wallet to an API key and choose a paid tier.
     *         Caller must have approved this contract for at least one month's
     *         fee in the chosen token BEFORE calling subscribe().
     *         The first month's fee is pulled immediately on subscribe.
     *
     * @param keyHash  SHA-256 hash of the API key (bytes32)
     * @param token    Address of USDC or USDT on Base
     * @param tier     1 = Growth ($29/mo), 2 = Pro ($99/mo)
     */
    function subscribe(bytes32 keyHash, address token, uint8 tier) external {
        require(tier == TIER_GROWTH || tier == TIER_PRO, "Invalid tier");
        require(token != address(0), "Invalid token");

        uint256 amount = _tierPrice(tier);

        // Check allowance is sufficient
        uint256 allowed = IERC20(token).allowance(msg.sender, address(this));
        require(allowed >= amount, "Insufficient allowance: approve USDC/USDT first");

        // Pull first month immediately
        require(IERC20(token).transferFrom(msg.sender, treasury, amount), "Transfer failed");

        subscriptions[keyHash] = Subscription({
            wallet:       msg.sender,
            token:        token,
            tier:         tier,
            subscribedAt: block.timestamp,
            active:       true
        });

        emit Subscribed(keyHash, msg.sender, token, tier, amount);
    }

    /**
     * @notice Pull the monthly subscription fee from the subscriber's wallet.
     *         Called by operator once per billing cycle.
     * @param keyHash SHA-256 hash of the API key
     */
    function pull(bytes32 keyHash) external onlyOperator {
        Subscription storage sub = subscriptions[keyHash];
        require(sub.active, "No active subscription");

        uint256 amount = _tierPrice(sub.tier);

        uint256 allowed = IERC20(sub.token).allowance(sub.wallet, address(this));
        if (allowed < amount) {
            // Approval revoked — mark inactive
            sub.active = false;
            emit SubscriptionCancelled(keyHash);
            return;
        }

        require(IERC20(sub.token).transferFrom(sub.wallet, treasury, amount), "Transfer failed");
        emit Pulled(keyHash, sub.wallet, sub.token, amount);
    }

    /**
     * @notice Charge overflow fees when a subscriber exceeds their included
     *         monthly quota. Can be called multiple times per period.
     * @param keyHash SHA-256 hash of the API key
     * @param amount  Amount to charge in token units (6 decimals)
     */
    function pullOverflow(bytes32 keyHash, uint256 amount) external onlyOperator {
        require(amount > 0, "Zero amount");
        Subscription storage sub = subscriptions[keyHash];
        require(sub.active, "No active subscription");

        uint256 allowed = IERC20(sub.token).allowance(sub.wallet, address(this));
        require(allowed >= amount, "Insufficient allowance for overflow");

        require(IERC20(sub.token).transferFrom(sub.wallet, treasury, amount), "Transfer failed");
        emit OverflowCharged(keyHash, sub.wallet, sub.token, amount);
    }

    // ── Views ─────────────────────────────────────────────────────────

    /**
     * @notice Get subscription details for a key hash.
     */
    function getSubscription(bytes32 keyHash)
        external
        view
        returns (
            address wallet,
            address token,
            uint8   tier,
            uint256 subscribedAt,
            bool    active
        )
    {
        Subscription storage sub = subscriptions[keyHash];
        return (sub.wallet, sub.token, sub.tier, sub.subscribedAt, sub.active);
    }

    /**
     * @notice Get the current allowance a subscriber has granted this contract.
     */
    function getAllowance(bytes32 keyHash) external view returns (uint256) {
        Subscription storage sub = subscriptions[keyHash];
        if (sub.wallet == address(0)) return 0;
        return IERC20(sub.token).allowance(sub.wallet, address(this));
    }

    /**
     * @notice Check if a key is registered (even free tier).
     */
    function isKeyRegistered(bytes32 keyHash) external view returns (bool) {
        return keyRegistrations[keyHash] > 0;
    }

    // ── Admin ──────────────────────────────────────────────────────────

    function setTreasury(address _treasury) external onlyOwner {
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    function setOperator(address _operator) external onlyOwner {
        emit OperatorUpdated(operator, _operator);
        operator = _operator;
    }

    // ── Internal ───────────────────────────────────────────────────────

    function _tierPrice(uint8 tier) internal pure returns (uint256) {
        if (tier == TIER_GROWTH) return GROWTH_PRICE;
        if (tier == TIER_PRO)    return PRO_PRICE;
        revert("Invalid tier");
    }
}
