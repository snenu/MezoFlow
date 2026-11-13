// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title AlertCenter
/// @notice Stores each user's notification preferences on-chain. The app evaluates
/// live on-chain metrics against these thresholds to raise alerts.
contract AlertCenter {
    // Bit flags for `mask`
    uint32 public constant ALERT_DEPOSIT = 1 << 0;
    uint32 public constant ALERT_WITHDRAW = 1 << 1;
    uint32 public constant ALERT_RATE_CHANGE = 1 << 2;
    uint32 public constant ALERT_ANNOUNCEMENT = 1 << 3;
    uint32 public constant ALERT_RISK = 1 << 4;
    uint32 public constant ALERT_LIQUIDITY = 1 << 5;
    uint32 public constant ALERT_BTC_GAINS = 1 << 6;
    uint32 public constant ALERT_UNLOCK = 1 << 7;
    uint32 public constant ALL = (1 << 8) - 1;

    struct Preferences {
        uint32 mask;
        uint16 rateChangeBps; // alert when a strategy rate moves by at least this much
        uint8 maxRiskScore; // alert when a held strategy's risk score exceeds this
        uint16 minRunwayDays; // alert when a reserve-funded rate has less runway
        uint16 minIcrBps; // alert when the lowest trove ICR drops under this (e.g. 11500)
        uint64 updatedAt;
    }

    mapping(address => Preferences) private _prefs;
    uint256 public subscriberCount;

    event PreferencesUpdated(
        address indexed user,
        uint32 mask,
        uint16 rateChangeBps,
        uint8 maxRiskScore,
        uint16 minRunwayDays,
        uint16 minIcrBps
    );

    function setPreferences(
        uint32 mask,
        uint16 rateChangeBps,
        uint8 maxRiskScore,
        uint16 minRunwayDays,
        uint16 minIcrBps
    ) external {
        if (_prefs[msg.sender].updatedAt == 0) subscriberCount += 1;
        _prefs[msg.sender] = Preferences(
            mask & ALL,
            rateChangeBps,
            maxRiskScore,
            minRunwayDays,
            minIcrBps,
            uint64(block.timestamp)
        );
        emit PreferencesUpdated(msg.sender, mask & ALL, rateChangeBps, maxRiskScore, minRunwayDays, minIcrBps);
    }

    /// @notice Returns stored preferences, or sensible defaults if the user never set any.
    function getPreferences(address user) external view returns (Preferences memory p, bool isDefault) {
        p = _prefs[user];
        if (p.updatedAt == 0) {
            return (Preferences(ALL, 50, 3, 14, 11500, 0), true);
        }
        return (p, false);
    }
}
