// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title StrategyRegistry (Strategy Manager)
/// @notice On-chain catalogue of MezoFlow strategies and the protocol announcement feed.
/// The marketplace, risk dashboard and alerts all read from here.
contract StrategyRegistry is Ownable {
    struct Strategy {
        address vault;
        uint8 kind; // 1 flexible, 2 term, 3 stability pool
        uint8 riskScore; // 1 (lowest) .. 5 (highest)
        bool active;
        uint64 addedAt;
        string name;
        string slug;
        string protocol;
        string summary;
        string liquidityTerms;
    }

    struct Announcement {
        uint64 timestamp;
        uint8 severity; // 0 info, 1 notice, 2 warning, 3 critical
        uint256 strategyId; // type(uint256).max = protocol-wide
        string title;
        string body;
    }

    uint256 public constant GLOBAL = type(uint256).max;

    Strategy[] private _strategies;
    mapping(address => uint256) private _idPlusOne;
    Announcement[] private _announcements;

    event StrategyAdded(uint256 indexed id, address indexed vault, string name);
    event StrategyUpdated(uint256 indexed id);
    event StrategyStatusChanged(uint256 indexed id, bool active);
    event RiskScoreChanged(uint256 indexed id, uint8 oldScore, uint8 newScore);
    event AnnouncementPosted(uint256 indexed id, uint256 indexed strategyId, uint8 severity, string title);

    error AlreadyRegistered();
    error UnknownStrategy();
    error InvalidRisk();

    constructor(address owner_) Ownable(owner_) {}

    function addStrategy(
        address vault,
        uint8 kind,
        uint8 riskScore,
        string calldata name,
        string calldata slug,
        string calldata protocol,
        string calldata summary,
        string calldata liquidityTerms
    ) external onlyOwner returns (uint256 id) {
        if (_idPlusOne[vault] != 0) revert AlreadyRegistered();
        if (riskScore == 0 || riskScore > 5) revert InvalidRisk();
        id = _strategies.length;
        _strategies.push(
            Strategy({
                vault: vault,
                kind: kind,
                riskScore: riskScore,
                active: true,
                addedAt: uint64(block.timestamp),
                name: name,
                slug: slug,
                protocol: protocol,
                summary: summary,
                liquidityTerms: liquidityTerms
            })
        );
        _idPlusOne[vault] = id + 1;
        emit StrategyAdded(id, vault, name);
    }

    function updateStrategy(
        uint256 id,
        string calldata summary,
        string calldata liquidityTerms
    ) external onlyOwner {
        if (id >= _strategies.length) revert UnknownStrategy();
        _strategies[id].summary = summary;
        _strategies[id].liquidityTerms = liquidityTerms;
        emit StrategyUpdated(id);
    }

    function setRiskScore(uint256 id, uint8 riskScore) external onlyOwner {
        if (id >= _strategies.length) revert UnknownStrategy();
        if (riskScore == 0 || riskScore > 5) revert InvalidRisk();
        emit RiskScoreChanged(id, _strategies[id].riskScore, riskScore);
        _strategies[id].riskScore = riskScore;
    }

    function setActive(uint256 id, bool active) external onlyOwner {
        if (id >= _strategies.length) revert UnknownStrategy();
        _strategies[id].active = active;
        emit StrategyStatusChanged(id, active);
    }

    function announce(
        uint256 strategyId,
        uint8 severity,
        string calldata title,
        string calldata body
    ) external onlyOwner returns (uint256 id) {
        if (strategyId != GLOBAL && strategyId >= _strategies.length) revert UnknownStrategy();
        id = _announcements.length;
        _announcements.push(Announcement(uint64(block.timestamp), severity, strategyId, title, body));
        emit AnnouncementPosted(id, strategyId, severity, title);
    }

    function strategyCount() external view returns (uint256) {
        return _strategies.length;
    }

    function getStrategy(uint256 id) external view returns (Strategy memory) {
        return _strategies[id];
    }

    function getStrategies() external view returns (Strategy[] memory) {
        return _strategies;
    }

    function idOf(address vault) external view returns (uint256) {
        uint256 v = _idPlusOne[vault];
        if (v == 0) revert UnknownStrategy();
        return v - 1;
    }

    /// @notice True for any vault ever registered, active or retired. Exits from a
    /// retired strategy must keep working.
    function isRegistered(address vault) external view returns (bool) {
        return _idPlusOne[vault] != 0;
    }

    function isActiveVault(address vault) external view returns (bool) {
        uint256 v = _idPlusOne[vault];
        return v != 0 && _strategies[v - 1].active;
    }

    function announcementCount() external view returns (uint256) {
        return _announcements.length;
    }

    /// @notice Newest-first page of announcements.
    function getAnnouncements(uint256 offset, uint256 limit) external view returns (Announcement[] memory page) {
        uint256 n = _announcements.length;
        if (offset >= n) return new Announcement[](0);
        uint256 count = n - offset < limit ? n - offset : limit;
        page = new Announcement[](count);
        for (uint256 i = 0; i < count; i++) page[i] = _announcements[n - 1 - offset - i];
    }
}
