// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IMezoRouter} from "./interfaces/IMezo.sol";
import {IActivityLedger, IStrategyRegistry, IAutoAllocator} from "./interfaces/IMezoFlow.sol";
import {SafePermit, PermitSig} from "./libraries/SafePermit.sol";

/// @title MezoFlowZap
/// @notice Turns BTC or MEZO into an MUSD position through Mezo Pools in one transaction.
///
/// Mezo's BTC (0x7b7C...0000) and MEZO (0x7B7c...0001) are ERC-20 precompiles that support
/// EIP-2612 permits, so a new user can go from the Mezo faucet to an MUSD vault position
/// with one signature and one transaction:
///   permit(BTC) -> swap on the Mezo Pools router -> deposit / allocate for the caller.
///
/// The zap never holds funds between transactions and has no owner or admin functions.
/// Every swap is recorded in the ActivityLedger.
contract MezoFlowZap is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 private constant KIND_SWAP = 9;
    uint256 private constant MAX_HOPS = 3;

    IMezoRouter public immutable router;
    address public immutable factory;
    IERC20 public immutable musd;
    IActivityLedger public immutable ledger;
    IStrategyRegistry public immutable registry;
    IAutoAllocator public immutable allocator;

    uint256 public swapCount;
    uint256 public totalMusdOut;

    event Swapped(address indexed user, address indexed tokenIn, uint256 amountIn, uint256 musdOut);
    event ZappedIntoVault(address indexed user, address indexed vault, uint256 musdIn, uint256 shares);
    event ZappedIntoPreset(address indexed user, uint256 indexed presetId, uint256 musdIn, uint256 allocated);

    error InvalidRoute();
    error InactiveVault(address vault);
    error InsufficientOutput(uint256 out, uint256 minOut);

    constructor(
        IMezoRouter router_,
        address factory_,
        IERC20 musd_,
        IActivityLedger ledger_,
        IStrategyRegistry registry_,
        IAutoAllocator allocator_
    ) {
        router = router_;
        factory = factory_;
        musd = musd_;
        ledger = ledger_;
        registry = registry_;
        allocator = allocator_;
    }

    // ---------------------------------------------------------------------
    // Quotes
    // ---------------------------------------------------------------------

    /// @notice MUSD out for `amountIn` along `routes`, straight from the Mezo Pools router.
    function quote(IMezoRouter.Route[] calldata routes, uint256 amountIn) external view returns (uint256) {
        _checkRoute(routes);
        uint256[] memory amounts = router.getAmountsOut(amountIn, routes);
        return amounts[amounts.length - 1];
    }

    // ---------------------------------------------------------------------
    // Swap to the wallet
    // ---------------------------------------------------------------------

    function swap(
        IMezoRouter.Route[] calldata routes,
        uint256 amountIn,
        uint256 minMusdOut,
        uint256 deadline
    ) public nonReentrant returns (uint256 out) {
        out = _swapIn(routes, amountIn, minMusdOut, deadline);
        musd.safeTransfer(msg.sender, out);
    }

    function swapWithPermit(
        IMezoRouter.Route[] calldata routes,
        uint256 amountIn,
        uint256 minMusdOut,
        uint256 deadline,
        PermitSig calldata sig
    ) external returns (uint256) {
        _permitIn(routes, amountIn, sig);
        return swap(routes, amountIn, minMusdOut, deadline);
    }

    // ---------------------------------------------------------------------
    // Swap and deposit into one vault
    // ---------------------------------------------------------------------

    function swapAndDeposit(
        IMezoRouter.Route[] calldata routes,
        uint256 amountIn,
        uint256 minMusdOut,
        address vault,
        uint256 deadline
    ) public nonReentrant returns (uint256 shares) {
        if (!registry.isActiveVault(vault)) revert InactiveVault(vault);
        uint256 out = _swapIn(routes, amountIn, minMusdOut, deadline);
        musd.forceApprove(vault, out);
        shares = IERC4626(vault).deposit(out, msg.sender);
        emit ZappedIntoVault(msg.sender, vault, out, shares);
    }

    function swapAndDepositWithPermit(
        IMezoRouter.Route[] calldata routes,
        uint256 amountIn,
        uint256 minMusdOut,
        address vault,
        uint256 deadline,
        PermitSig calldata sig
    ) external returns (uint256) {
        _permitIn(routes, amountIn, sig);
        return swapAndDeposit(routes, amountIn, minMusdOut, vault, deadline);
    }

    // ---------------------------------------------------------------------
    // Swap and allocate with an AutoAllocator preset
    // ---------------------------------------------------------------------

    function swapAndAllocate(
        IMezoRouter.Route[] calldata routes,
        uint256 amountIn,
        uint256 minMusdOut,
        uint256 presetId,
        uint256 deadline
    ) public nonReentrant returns (uint256 allocated) {
        uint256 out = _swapIn(routes, amountIn, minMusdOut, deadline);
        musd.forceApprove(address(allocator), out);
        allocated = allocator.allocatePresetFor(out, presetId, msg.sender);
        musd.forceApprove(address(allocator), 0);
        // The preset's unallocated share goes to the wallet, as with a direct allocation.
        if (out > allocated) musd.safeTransfer(msg.sender, out - allocated);
        emit ZappedIntoPreset(msg.sender, presetId, out, allocated);
    }

    function swapAndAllocateWithPermit(
        IMezoRouter.Route[] calldata routes,
        uint256 amountIn,
        uint256 minMusdOut,
        uint256 presetId,
        uint256 deadline,
        PermitSig calldata sig
    ) external returns (uint256) {
        _permitIn(routes, amountIn, sig);
        return swapAndAllocate(routes, amountIn, minMusdOut, presetId, deadline);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _permitIn(IMezoRouter.Route[] calldata routes, uint256 amountIn, PermitSig calldata sig) internal {
        if (routes.length == 0) revert InvalidRoute();
        SafePermit.usePermit(IERC20(routes[0].from), msg.sender, address(this), amountIn, sig);
    }

    function _swapIn(
        IMezoRouter.Route[] calldata routes,
        uint256 amountIn,
        uint256 minMusdOut,
        uint256 deadline
    ) internal returns (uint256 out) {
        _checkRoute(routes);
        IERC20 tokenIn = IERC20(routes[0].from);
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);
        tokenIn.forceApprove(address(router), amountIn);
        uint256 before = musd.balanceOf(address(this));
        router.swapExactTokensForTokens(amountIn, minMusdOut, routes, address(this), deadline);
        out = musd.balanceOf(address(this)) - before;
        if (out == 0 || out < minMusdOut) revert InsufficientOutput(out, minMusdOut);

        swapCount += 1;
        totalMusdOut += out;
        ledger.record(msg.sender, KIND_SWAP, address(tokenIn), out, amountIn, 0);
        emit Swapped(msg.sender, address(tokenIn), amountIn, out);
    }

    /// @dev Routes must start from a non-MUSD token, end in MUSD, chain hop to hop and
    /// only use Mezo's own pool factory.
    function _checkRoute(IMezoRouter.Route[] calldata routes) internal view {
        uint256 n = routes.length;
        if (n == 0 || n > MAX_HOPS) revert InvalidRoute();
        if (routes[0].from == address(musd) || routes[n - 1].to != address(musd)) revert InvalidRoute();
        for (uint256 i = 0; i < n; i++) {
            if (routes[i].factory != factory) revert InvalidRoute();
            if (i > 0 && routes[i].from != routes[i - 1].to) revert InvalidRoute();
        }
    }
}
