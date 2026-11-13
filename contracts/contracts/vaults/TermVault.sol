// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MezoFlowVault} from "./MezoFlowVault.sol";
import {IActivityLedger, IFeeManager} from "../interfaces/IMezoFlow.sol";

/// @title TermVault
/// @notice Strategy — Fixed-term savings. Deposits are locked for `lockDuration` in
/// exchange for a higher reserve-funded rate. Exiting early is always possible but
/// costs an early-exit penalty, which is returned to the reward reserve so it funds the
/// yield of depositors who stay. Adding to a position re-weights the unlock time by size.
///
/// Fairness rules (audit F-01, F-05, F-08):
/// - Only the holder, or a trusted router acting for its own caller (AutoAllocator,
///   MezoFlowZap), can deposit into a position, so nobody can extend someone else's lock.
/// - The penalty a holder pays is the one in force when they last deposited; later
///   increases never apply to them, decreases always do.
/// - ERC-4626 previews assume the penalty, so they never over-promise.
contract TermVault is MezoFlowVault {
    uint16 public constant MAX_PENALTY_BPS = 500; // 5%
    uint64 public constant MAX_LOCK = 365 days;

    uint64 public lockDuration;
    uint16 public earlyExitPenaltyBps;
    mapping(address => uint64) public unlockAt;
    mapping(address => uint16) public penaltyBpsOf;
    mapping(address => bool) public isRouter;

    event LockUpdated(address indexed user, uint64 unlockAt, uint16 penaltyBps);
    event LockTermsUpdated(uint64 lockDuration, uint16 earlyExitPenaltyBps);
    event RouterSet(address indexed router, bool allowed);

    error SharesLocked(uint64 unlockAt);
    error InvalidTerms();
    error ThirdPartyDeposit();

    constructor(
        IERC20 musd_,
        address owner_,
        IActivityLedger ledger_,
        IFeeManager feeManager_,
        uint16 rateBps_,
        uint256 minDeposit_,
        uint64 lockDuration_,
        uint16 earlyExitPenaltyBps_
    )
        MezoFlowVault(musd_, "MezoFlow Term Savings", "mfTERM", owner_, ledger_, feeManager_, rateBps_, minDeposit_)
    {
        if (lockDuration_ > MAX_LOCK || earlyExitPenaltyBps_ > MAX_PENALTY_BPS) revert InvalidTerms();
        lockDuration = lockDuration_;
        earlyExitPenaltyBps = earlyExitPenaltyBps_;
    }

    function kind() external pure override returns (uint8) {
        return 2;
    }

    function setLockTerms(uint64 lockDuration_, uint16 earlyExitPenaltyBps_) external onlyOwner {
        if (lockDuration_ > MAX_LOCK || earlyExitPenaltyBps_ > MAX_PENALTY_BPS) revert InvalidTerms();
        lockDuration = lockDuration_;
        earlyExitPenaltyBps = earlyExitPenaltyBps_;
        emit LockTermsUpdated(lockDuration_, earlyExitPenaltyBps_);
    }

    /// @notice Allow a router contract to deposit on behalf of its own caller.
    function setRouter(address router, bool allowed) external onlyOwner {
        isRouter[router] = allowed;
        emit RouterSet(router, allowed);
    }

    function isLocked(address user) public view returns (bool) {
        return block.timestamp < unlockAt[user];
    }

    /// @notice Early-exit penalty `user` would pay right now if still locked.
    function penaltyFor(address user) public view returns (uint16) {
        uint16 own = penaltyBpsOf[user];
        uint16 current = earlyExitPenaltyBps;
        return own < current ? own : current;
    }

    function _beforeDepositMint(address caller, address receiver, uint256 newShares) internal override {
        if (caller != receiver && !isRouter[caller]) revert ThirdPartyDeposit();
        uint256 bal = balanceOf(receiver);
        uint256 current = unlockAt[receiver];
        uint256 remaining = current > block.timestamp ? current - block.timestamp : 0;
        uint256 weighted = (bal * remaining + newShares * lockDuration) / (bal + newShares);
        uint64 next = uint64(block.timestamp + weighted);
        uint16 penalty = earlyExitPenaltyBps;
        unlockAt[receiver] = next;
        penaltyBpsOf[receiver] = penalty;
        emit LockUpdated(receiver, next, penalty);
    }

    function _exitFee(address owner) internal view override returns (uint256 bps, bool toReserve) {
        if (owner != address(0) && isLocked(owner)) return (penaltyFor(owner), true);
        return super._exitFee(owner);
    }

    function _previewFeeBps() internal view override returns (uint256) {
        uint256 base = super._previewFeeBps();
        return earlyExitPenaltyBps > base ? earlyExitPenaltyBps : base;
    }

    function _unlockAt(address user) internal view override returns (uint256) {
        return unlockAt[user];
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && isLocked(from)) revert SharesLocked(unlockAt[from]);
        super._update(from, to, value);
    }
}
