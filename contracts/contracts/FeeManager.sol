// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IReserveFundable {
    function fundReserve(uint256 amount) external;
}

/// @title FeeManager
/// @notice Holds the disclosed fee schedule for every MezoFlow vault and acts as the
/// protocol treasury. Collected fees can be recycled into vault reward reserves, which
/// is what funds the reserve-backed savings rates (fee-backed yield).
///
/// Fee increases on a vault that already has depositors only take effect after
/// FEE_INCREASE_DELAY, so holders always have time to leave at the old fee (audit F-06).
/// Decreases apply immediately.
contract FeeManager is Ownable {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_WITHDRAWAL_FEE_BPS = 200; // hard cap: 2%
    uint64 public constant FEE_INCREASE_DELAY = 2 days;

    struct FeeSchedule {
        uint16 current;
        uint16 pending;
        uint64 effectiveAt; // 0 = nothing scheduled
    }

    IERC20 public immutable musd;
    mapping(address => FeeSchedule) public feeSchedule;
    mapping(address => bool) public isVault;
    mapping(address => uint256) public feesByVault;
    uint256 public totalFeesCollected;
    uint256 public totalRecycled;

    event VaultSet(address indexed vault, bool allowed);
    event WithdrawalFeeSet(address indexed vault, uint16 oldBps, uint16 newBps);
    event WithdrawalFeeScheduled(address indexed vault, uint16 currentBps, uint16 newBps, uint64 effectiveAt);
    event FeeReceived(address indexed vault, uint256 amount);
    event Recycled(address indexed vault, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error FeeTooHigh();
    error NotVault();

    constructor(address owner_, IERC20 musd_) Ownable(owner_) {
        musd = musd_;
    }

    function setVault(address vault, bool allowed) external onlyOwner {
        isVault[vault] = allowed;
        emit VaultSet(vault, allowed);
    }

    /// @notice Fee in force right now for exits from `vault`.
    function withdrawalFeeBps(address vault) public view returns (uint16) {
        FeeSchedule memory f = feeSchedule[vault];
        if (f.effectiveAt != 0 && block.timestamp >= f.effectiveAt) return f.pending;
        return f.current;
    }

    /// @notice Set a vault's exit fee. Lowering it, or setting it before anyone has
    /// deposited, is immediate; raising it on a live vault is scheduled.
    function setWithdrawalFee(address vault, uint16 bps) external onlyOwner {
        if (bps > MAX_WITHDRAWAL_FEE_BPS) revert FeeTooHigh();
        uint16 current = withdrawalFeeBps(vault);
        if (bps <= current || IERC20(vault).totalSupply() == 0) {
            feeSchedule[vault] = FeeSchedule(bps, 0, 0);
            emit WithdrawalFeeSet(vault, current, bps);
        } else {
            uint64 at = uint64(block.timestamp) + FEE_INCREASE_DELAY;
            feeSchedule[vault] = FeeSchedule(current, bps, at);
            emit WithdrawalFeeScheduled(vault, current, bps, at);
        }
    }

    /// @notice Called by a vault right after it transferred `amount` MUSD of fees here.
    function notifyFee(uint256 amount) external {
        if (!isVault[msg.sender]) revert NotVault();
        feesByVault[msg.sender] += amount;
        totalFeesCollected += amount;
        emit FeeReceived(msg.sender, amount);
    }

    /// @notice Route treasury MUSD into a vault's reward reserve.
    function recycle(address vault, uint256 amount) external onlyOwner {
        if (!isVault[vault]) revert NotVault();
        musd.forceApprove(vault, amount);
        IReserveFundable(vault).fundReserve(amount);
        totalRecycled += amount;
        emit Recycled(vault, amount);
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        musd.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function treasuryBalance() external view returns (uint256) {
        return musd.balanceOf(address(this));
    }
}
