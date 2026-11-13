// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IActivityLedger, IStrategyRegistry} from "./interfaces/IMezoFlow.sol";

/// @title AutoAllocator (Smart Auto Allocator)
/// @notice Splits a user's MUSD across registered MezoFlow vaults in a single
/// transaction, following an on-chain preset (Conservative / Balanced / Growth) or a
/// custom split. Shares are minted straight to the user — the allocator never holds
/// funds between transactions. Any unallocated share of the amount stays in the
/// user's wallet. `reallocate` moves an existing position to a new split atomically.
contract AutoAllocator is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint32 public constant CUSTOM = type(uint32).max;
    uint8 private constant KIND_ALLOCATE = 2;
    uint8 private constant KIND_REALLOCATE = 8;

    struct Preset {
        string name;
        string description;
        uint8 riskLevel; // 1..5
        bool active;
        address[] vaults;
        uint16[] weightsBps; // remainder up to 10_000 stays unallocated in the wallet
    }

    struct Plan {
        uint64 timestamp;
        uint32 presetId;
        uint128 amount;
    }

    IERC20 public immutable musd;
    IActivityLedger public immutable ledger;
    IStrategyRegistry public immutable registry;

    Preset[] private _presets;
    mapping(address => Plan) public plans;
    uint256 public totalAllocated;
    uint256 public allocationCount;

    event PresetAdded(uint256 indexed id, string name);
    event PresetStatusChanged(uint256 indexed id, bool active);
    event Allocated(address indexed user, uint32 indexed presetId, uint256 requested, uint256 allocated);
    event Reallocated(address indexed user, uint32 indexed presetId, uint256 moved, uint256 returned);

    error LengthMismatch();
    error WeightsTooHigh();
    error InactiveVault(address vault);
    error UnknownVault(address vault);
    error InactivePreset();
    error NothingAllocated();

    constructor(address owner_, IERC20 musd_, IActivityLedger ledger_, IStrategyRegistry registry_) Ownable(owner_) {
        musd = musd_;
        ledger = ledger_;
        registry = registry_;
    }

    // --- presets ---

    function addPreset(
        string calldata name,
        string calldata description,
        uint8 riskLevel,
        address[] calldata vaults,
        uint16[] calldata weightsBps
    ) external onlyOwner returns (uint256 id) {
        _validate(vaults, weightsBps);
        id = _presets.length;
        _presets.push(Preset(name, description, riskLevel, true, vaults, weightsBps));
        emit PresetAdded(id, name);
    }

    function setPresetActive(uint256 id, bool active) external onlyOwner {
        _presets[id].active = active;
        emit PresetStatusChanged(id, active);
    }

    function presetCount() external view returns (uint256) {
        return _presets.length;
    }

    function getPreset(uint256 id) external view returns (Preset memory) {
        return _presets[id];
    }

    function getPresets() external view returns (Preset[] memory) {
        return _presets;
    }

    // --- allocation ---

    function previewAllocation(
        uint256 amount,
        address[] calldata vaults,
        uint16[] calldata weightsBps
    ) public view returns (uint256[] memory parts, uint256 unallocated) {
        _validate(vaults, weightsBps);
        parts = new uint256[](vaults.length);
        uint256 used;
        for (uint256 i = 0; i < vaults.length; i++) {
            parts[i] = (amount * weightsBps[i]) / BPS;
            used += parts[i];
        }
        unallocated = amount - used;
    }

    function previewPreset(
        uint256 amount,
        uint256 presetId
    ) external view returns (address[] memory vaults, uint256[] memory parts, uint256 unallocated) {
        Preset storage p = _presets[presetId];
        vaults = p.vaults;
        parts = new uint256[](vaults.length);
        uint256 used;
        for (uint256 i = 0; i < vaults.length; i++) {
            parts[i] = (amount * p.weightsBps[i]) / BPS;
            used += parts[i];
        }
        unallocated = amount - used;
    }

    function allocate(
        uint256 amount,
        address[] calldata vaults,
        uint16[] calldata weightsBps
    ) external nonReentrant returns (uint256 allocated) {
        allocated = _allocateFromWallet(amount, vaults, weightsBps, CUSTOM);
    }

    function allocatePreset(uint256 amount, uint256 presetId) external nonReentrant returns (uint256 allocated) {
        Preset storage p = _presets[presetId];
        if (!p.active) revert InactivePreset();
        allocated = _allocateFromWallet(amount, p.vaults, p.weightsBps, uint32(presetId));
    }

    /// @notice Redeem `shares` from `fromVaults` (requires share approvals to this
    /// contract) and re-deposit the proceeds using the new split. Any unallocated
    /// remainder is returned to the user's wallet.
    function reallocate(
        address[] calldata fromVaults,
        uint256[] calldata shares,
        address[] calldata toVaults,
        uint16[] calldata weightsBps,
        uint32 presetId
    ) external nonReentrant returns (uint256 moved) {
        if (fromVaults.length != shares.length || fromVaults.length == 0) revert LengthMismatch();
        _validate(toVaults, weightsBps);
        // Only MezoFlow vaults, and only the MUSD that actually arrived, count (audit F-04).
        uint256 before = musd.balanceOf(address(this));
        for (uint256 i = 0; i < fromVaults.length; i++) {
            if (!registry.isRegistered(fromVaults[i])) revert UnknownVault(fromVaults[i]);
            if (shares[i] == 0) continue;
            IERC4626(fromVaults[i]).redeem(shares[i], address(this), msg.sender);
        }
        moved = musd.balanceOf(address(this)) - before;
        if (moved == 0) revert NothingAllocated();
        uint256 deposited = _depositSplit(moved, toVaults, weightsBps);
        uint256 returned = moved - deposited;
        if (returned > 0) musd.safeTransfer(msg.sender, returned);

        plans[msg.sender] = Plan(uint64(block.timestamp), presetId, uint128(moved));
        ledger.record(msg.sender, KIND_REALLOCATE, address(this), moved, 0, 0);
        emit Reallocated(msg.sender, presetId, moved, returned);
    }

    function _allocateFromWallet(
        uint256 amount,
        address[] memory vaults,
        uint16[] memory weightsBps,
        uint32 presetId
    ) internal returns (uint256 allocated) {
        _validate(vaults, weightsBps);
        for (uint256 i = 0; i < vaults.length; i++) allocated += (amount * weightsBps[i]) / BPS;
        if (allocated == 0) revert NothingAllocated();
        musd.safeTransferFrom(msg.sender, address(this), allocated);
        uint256 deposited = _depositSplit(amount, vaults, weightsBps);
        // _depositSplit uses the same rounding, so deposited == allocated.
        assert(deposited == allocated);

        totalAllocated += allocated;
        allocationCount += 1;
        plans[msg.sender] = Plan(uint64(block.timestamp), presetId, uint128(amount));
        ledger.record(msg.sender, KIND_ALLOCATE, address(this), allocated, 0, 0);
        emit Allocated(msg.sender, presetId, amount, allocated);
    }

    function _depositSplit(
        uint256 amount,
        address[] memory vaults,
        uint16[] memory weightsBps
    ) internal returns (uint256 deposited) {
        for (uint256 i = 0; i < vaults.length; i++) {
            uint256 part = (amount * weightsBps[i]) / BPS;
            if (part == 0) continue;
            musd.forceApprove(vaults[i], part);
            IERC4626(vaults[i]).deposit(part, msg.sender);
            deposited += part;
        }
    }

    function _validate(address[] memory vaults, uint16[] memory weightsBps) internal view {
        if (vaults.length != weightsBps.length || vaults.length == 0) revert LengthMismatch();
        uint256 sum;
        for (uint256 i = 0; i < vaults.length; i++) {
            if (!registry.isActiveVault(vaults[i])) revert InactiveVault(vaults[i]);
            sum += weightsBps[i];
        }
        if (sum > BPS) revert WeightsTooHigh();
    }
}
