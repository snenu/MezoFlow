// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IActivityLedger {
    function record(
        address user,
        uint8 kind,
        address vault,
        uint256 assets,
        uint256 shares,
        uint256 fee
    ) external;
}

interface IFeeManager {
    function withdrawalFeeBps(address vault) external view returns (uint16);

    function notifyFee(uint256 amount) external;
}

interface IStrategyRegistry {
    function isActiveVault(address vault) external view returns (bool);

    function isRegistered(address vault) external view returns (bool);
}

/// @notice Shared read interface every MezoFlow vault implements.
interface IMezoFlowVault {
    struct VaultStats {
        uint256 totalAssets;
        uint256 totalSupply;
        uint256 sharePrice; // assets per 1e18 shares
        uint256 rewardReserve;
        uint16 rateBps; // annual reserve-funded rate
        uint256 totalRewardsPaid;
        uint256 cumulativeDeposits;
        uint256 cumulativeWithdrawals;
        uint256 depositorCount;
        uint256 minDeposit;
        uint16 exitFeeBps;
        bool paused;
        uint256 availableLiquidity;
        uint256 runwaySeconds;
        uint256 feesCollected;
    }

    struct UserInfo {
        uint256 shares;
        uint256 assets; // gross value of shares
        uint256 maxWithdraw; // net of fees and capped by liquidity
        uint256 exitFeeBps;
        uint256 unlockAt; // TermVault only
        uint256 pendingBtc; // StabilityPoolVault only
        uint256 claimedBtc; // StabilityPoolVault only
    }

    struct Checkpoint {
        uint64 timestamp;
        uint192 sharePrice;
    }

    struct RatePoint {
        uint64 timestamp;
        uint16 rateBps;
    }

    function kind() external pure returns (uint8);

    function stats() external view returns (VaultStats memory);

    function userInfo(address user) external view returns (UserInfo memory);
}
