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
contract FeeManager is Ownable {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_WITHDRAWAL_FEE_BPS = 200; // hard cap: 2%

    IERC20 public immutable musd;
    mapping(address => uint16) public withdrawalFeeBps;
    mapping(address => bool) public isVault;
    mapping(address => uint256) public feesByVault;
    uint256 public totalFeesCollected;
    uint256 public totalRecycled;

    event VaultSet(address indexed vault, bool allowed);
    event WithdrawalFeeSet(address indexed vault, uint16 oldBps, uint16 newBps);
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

    function setWithdrawalFee(address vault, uint16 bps) external onlyOwner {
        if (bps > MAX_WITHDRAWAL_FEE_BPS) revert FeeTooHigh();
        emit WithdrawalFeeSet(vault, withdrawalFeeBps[vault], bps);
        withdrawalFeeBps[vault] = bps;
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
