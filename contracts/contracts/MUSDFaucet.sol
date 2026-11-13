// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IActivityLedger} from "./interfaces/IMezoFlow.sol";

/// @title MUSDFaucet
/// @notice Testnet helper: hands out a small amount of real testnet MUSD (pre-funded by
/// the MezoFlow team) so anyone can try the full flow. Rate-limited per address.
contract MUSDFaucet is Ownable {
    using SafeERC20 for IERC20;

    uint8 private constant KIND_FAUCET = 7;

    IERC20 public immutable musd;
    IActivityLedger public immutable ledger;
    uint256 public amountPerClaim;
    uint64 public cooldown;
    mapping(address => uint64) public lastClaim;
    uint256 public totalClaimed;
    uint256 public claimCount;

    event Claimed(address indexed user, uint256 amount);
    event ParamsUpdated(uint256 amountPerClaim, uint64 cooldown);

    error CoolingDown(uint64 nextClaimAt);
    error FaucetEmpty();

    constructor(
        address owner_,
        IERC20 musd_,
        IActivityLedger ledger_,
        uint256 amountPerClaim_,
        uint64 cooldown_
    ) Ownable(owner_) {
        musd = musd_;
        ledger = ledger_;
        amountPerClaim = amountPerClaim_;
        cooldown = cooldown_;
    }

    function nextClaimAt(address user) public view returns (uint64) {
        uint64 last = lastClaim[user];
        return last == 0 ? 0 : last + cooldown;
    }

    function claim() external {
        uint64 next = nextClaimAt(msg.sender);
        if (block.timestamp < next) revert CoolingDown(next);
        uint256 amount = amountPerClaim;
        if (musd.balanceOf(address(this)) < amount) revert FaucetEmpty();
        lastClaim[msg.sender] = uint64(block.timestamp);
        totalClaimed += amount;
        claimCount += 1;
        musd.safeTransfer(msg.sender, amount);
        ledger.record(msg.sender, KIND_FAUCET, address(this), amount, 0, 0);
        emit Claimed(msg.sender, amount);
    }

    function setParams(uint256 amountPerClaim_, uint64 cooldown_) external onlyOwner {
        amountPerClaim = amountPerClaim_;
        cooldown = cooldown_;
        emit ParamsUpdated(amountPerClaim_, cooldown_);
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        musd.safeTransfer(to, amount);
    }

    function balance() external view returns (uint256) {
        return musd.balanceOf(address(this));
    }
}
