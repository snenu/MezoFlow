// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MezoFlowVault} from "./MezoFlowVault.sol";
import {IActivityLedger, IFeeManager} from "../interfaces/IMezoFlow.sol";

/// @title FlexibleSavingsVault
/// @notice Strategy A — MUSD held 100% idle in the vault. Instant withdrawals at any
/// time; yield comes only from the on-chain reward reserve at the published rate.
contract FlexibleSavingsVault is MezoFlowVault {
    constructor(
        IERC20 musd_,
        address owner_,
        IActivityLedger ledger_,
        IFeeManager feeManager_,
        uint16 rateBps_,
        uint256 minDeposit_
    )
        MezoFlowVault(musd_, "MezoFlow Flexible Savings", "mfSAVE", owner_, ledger_, feeManager_, rateBps_, minDeposit_)
    {}

    function kind() external pure override returns (uint8) {
        return 1;
    }
}
