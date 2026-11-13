// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MezoFlowVault} from "./MezoFlowVault.sol";
import {IActivityLedger, IFeeManager} from "../interfaces/IMezoFlow.sol";

/// @title TermVault
/// @notice Strategy — Fixed-term savings. Deposits are locked for `lockDuration` in
/// exchange for a higher reserve-funded rate. Exiting early is always possible but
/// costs `earlyExitPenaltyBps`, which is returned to the reward reserve so it funds the
/// yield of depositors who stay. Adding to a position re-weights the unlock time by size.
contract TermVault is MezoFlowVault {
    uint16 public constant MAX_PENALTY_BPS = 500; // 5%
    uint64 public constant MAX_LOCK = 365 days;

    uint64 public lockDuration;
    uint16 public earlyExitPenaltyBps;
    mapping(address => uint64) public unlockAt;

    event LockUpdated(address indexed user, uint64 unlockAt);
    event LockTermsUpdated(uint64 lockDuration, uint16 earlyExitPenaltyBps);

    error SharesLocked(uint64 unlockAt);
    error InvalidTerms();

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

    function isLocked(address user) public view returns (bool) {
        return block.timestamp < unlockAt[user];
    }

    function _beforeDepositMint(address receiver, uint256 newShares) internal override {
        uint256 bal = balanceOf(receiver);
        uint256 current = unlockAt[receiver];
        uint256 remaining = current > block.timestamp ? current - block.timestamp : 0;
        uint256 weighted = (bal * remaining + newShares * lockDuration) / (bal + newShares);
        uint64 next = uint64(block.timestamp + weighted);
        unlockAt[receiver] = next;
        emit LockUpdated(receiver, next);
    }

    function _exitFee(address owner) internal view override returns (uint256 bps, bool toReserve) {
        if (owner != address(0) && isLocked(owner)) return (earlyExitPenaltyBps, true);
        return super._exitFee(owner);
    }

    function _unlockAt(address user) internal view override returns (uint256) {
        return unlockAt[user];
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && isLocked(from)) revert SharesLocked(unlockAt[from]);
        super._update(from, to, value);
    }
}
