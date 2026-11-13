// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IActivityLedger, IStrategyRegistry} from "./interfaces/IMezoFlow.sol";
import {SafePermit, PermitSig} from "./libraries/SafePermit.sol";

/// @title AutoAllocator (Smart Auto Allocator)
/// @notice Splits a user's MUSD across registered MezoFlow vaults in a single
/// transaction, following an on-chain preset (Conservative / Balanced / Growth) or a
/// custom split. Shares are minted straight to the user — the allocator never holds
/// funds between transactions. Any unallocated share of the amount stays in the
/// user's wallet. `reallocate` moves an existing position to a new split atomically.
///
/// Every entry point has a `...WithPermit` twin: MUSD (and vault shares, for
/// reallocation) are pulled with EIP-2612 signatures, so each action is one transaction.
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
    /// @notice Contracts (the MezoFlow zap) allowed to allocate for their own caller.
    mapping(address => bool) public isRouter;
    uint256 public totalAllocated;
    uint256 public allocationCount;

    event PresetAdded(uint256 indexed id, string name);
    event PresetStatusChanged(uint256 indexed id, bool active);
    event RouterSet(address indexed router, bool allowed);
    event Allocated(address indexed user, uint32 indexed presetId, uint256 requested, uint256 allocated);
    event Reallocated(address indexed user, uint32 indexed presetId, uint256 moved, uint256 returned);

    error LengthMismatch();
    error WeightsTooHigh();
    error InactiveVault(address vault);
    error UnknownVault(address vault);
    error InactivePreset();
    error UnknownPreset();
    error NothingAllocated();
    error NotRouter();

    constructor(address owner_, IERC20 musd_, IActivityLedger ledger_, IStrategyRegistry registry_) Ownable(owner_) {
        musd = musd_;
        ledger = ledger_;
        registry = registry_;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

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
        if (id >= _presets.length) revert UnknownPreset();
        _presets[id].active = active;
        emit PresetStatusChanged(id, active);
    }

    function setRouter(address router, bool allowed) external onlyOwner {
        isRouter[router] = allowed;
        emit RouterSet(router, allowed);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function presetCount() external view returns (uint256) {
        return _presets.length;
    }

    function getPreset(uint256 id) external view returns (Preset memory) {
        return _presets[id];
    }

    function getPresets() external view returns (Preset[] memory) {
        return _presets;
    }

    function previewAllocation(
        uint256 amount,
        address[] calldata vaults,
        uint16[] calldata weightsBps
    ) public view returns (uint256[] memory parts, uint256 unallocated) {
        _validate(vaults, weightsBps);
        (parts, unallocated) = _split(amount, weightsBps);
    }

    function previewPreset(
        uint256 amount,
        uint256 presetId
    ) external view returns (address[] memory vaults, uint256[] memory parts, uint256 unallocated) {
        Preset storage p = _preset(presetId);
        vaults = p.vaults;
        (parts, unallocated) = _split(amount, p.weightsBps);
    }

    // ---------------------------------------------------------------------
    // Allocate from the wallet
    // ---------------------------------------------------------------------

    function allocate(
        uint256 amount,
        address[] calldata vaults,
        uint16[] calldata weightsBps
    ) public nonReentrant returns (uint256 allocated) {
        allocated = _allocate(msg.sender, msg.sender, amount, vaults, weightsBps, CUSTOM);
    }

    /// @notice `allocate` with an MUSD permit for `amount` — one transaction.
    function allocateWithPermit(
        uint256 amount,
        address[] calldata vaults,
        uint16[] calldata weightsBps,
        PermitSig calldata sig
    ) external returns (uint256) {
        SafePermit.usePermit(musd, msg.sender, address(this), amount, sig);
        return allocate(amount, vaults, weightsBps);
    }

    function allocatePreset(uint256 amount, uint256 presetId) public nonReentrant returns (uint256 allocated) {
        Preset storage p = _activePreset(presetId);
        allocated = _allocate(msg.sender, msg.sender, amount, p.vaults, p.weightsBps, uint32(presetId));
    }

    /// @notice `allocatePreset` with an MUSD permit for `amount` — one transaction.
    function allocatePresetWithPermit(uint256 amount, uint256 presetId, PermitSig calldata sig) external returns (uint256) {
        SafePermit.usePermit(musd, msg.sender, address(this), amount, sig);
        return allocatePreset(amount, presetId);
    }

    /// @notice Router entry point: pulls MUSD from the router and allocates it for
    /// `beneficiary`. Routers are owner-approved contracts that always pass their own
    /// caller as the beneficiary (MezoFlowZap: swap BTC -> MUSD -> preset in one tx).
    function allocatePresetFor(
        uint256 amount,
        uint256 presetId,
        address beneficiary
    ) external nonReentrant returns (uint256 allocated) {
        if (!isRouter[msg.sender]) revert NotRouter();
        Preset storage p = _activePreset(presetId);
        allocated = _allocate(msg.sender, beneficiary, amount, p.vaults, p.weightsBps, uint32(presetId));
    }

    // ---------------------------------------------------------------------
    // Reallocate an existing position
    // ---------------------------------------------------------------------

    /// @notice Redeem `shares` from `fromVaults` (requires share approvals to this
    /// contract) and re-deposit the proceeds using the new split. Any unallocated
    /// remainder is returned to the user's wallet.
    function reallocate(
        address[] calldata fromVaults,
        uint256[] calldata shares,
        address[] calldata toVaults,
        uint16[] calldata weightsBps,
        uint32 presetId
    ) public nonReentrant returns (uint256 moved) {
        moved = _reallocate(fromVaults, shares, toVaults, weightsBps, presetId);
    }

    /// @notice `reallocate` with one vault-share permit per source vault — one transaction.
    function reallocateWithPermit(
        address[] calldata fromVaults,
        uint256[] calldata shares,
        PermitSig[] calldata sigs,
        address[] calldata toVaults,
        uint16[] calldata weightsBps,
        uint32 presetId
    ) external returns (uint256) {
        if (sigs.length != fromVaults.length) revert LengthMismatch();
        for (uint256 i = 0; i < fromVaults.length; i++) {
            if (shares[i] == 0) continue;
            if (!registry.isRegistered(fromVaults[i])) revert UnknownVault(fromVaults[i]);
            SafePermit.usePermit(IERC20(fromVaults[i]), msg.sender, address(this), shares[i], sigs[i]);
        }
        return reallocate(fromVaults, shares, toVaults, weightsBps, presetId);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _allocate(
        address payer,
        address beneficiary,
        uint256 amount,
        address[] memory vaults,
        uint16[] memory weightsBps,
        uint32 presetId
    ) internal returns (uint256 allocated) {
        _validate(vaults, weightsBps);
        (, uint256 unallocated) = _split(amount, weightsBps);
        allocated = amount - unallocated;
        if (allocated == 0) revert NothingAllocated();
        musd.safeTransferFrom(payer, address(this), allocated);
        _depositSplit(amount, vaults, weightsBps, beneficiary);

        totalAllocated += allocated;
        allocationCount += 1;
        plans[beneficiary] = Plan(uint64(block.timestamp), presetId, uint128(amount));
        ledger.record(beneficiary, KIND_ALLOCATE, address(this), allocated, 0, 0);
        emit Allocated(beneficiary, presetId, amount, allocated);
    }

    function _reallocate(
        address[] calldata fromVaults,
        uint256[] calldata shares,
        address[] calldata toVaults,
        uint16[] calldata weightsBps,
        uint32 presetId
    ) internal returns (uint256 moved) {
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
        uint256 deposited = _depositSplit(moved, toVaults, weightsBps, msg.sender);
        uint256 returned = moved - deposited;
        if (returned > 0) musd.safeTransfer(msg.sender, returned);

        plans[msg.sender] = Plan(uint64(block.timestamp), presetId, uint128(moved));
        ledger.record(msg.sender, KIND_REALLOCATE, address(this), moved, 0, 0);
        emit Reallocated(msg.sender, presetId, moved, returned);
    }

    function _depositSplit(
        uint256 amount,
        address[] memory vaults,
        uint16[] memory weightsBps,
        address beneficiary
    ) internal returns (uint256 deposited) {
        for (uint256 i = 0; i < vaults.length; i++) {
            uint256 part = (amount * weightsBps[i]) / BPS;
            if (part == 0) continue;
            musd.forceApprove(vaults[i], part);
            IERC4626(vaults[i]).deposit(part, beneficiary);
            deposited += part;
        }
    }

    function _split(
        uint256 amount,
        uint16[] memory weightsBps
    ) internal pure returns (uint256[] memory parts, uint256 unallocated) {
        parts = new uint256[](weightsBps.length);
        uint256 used;
        for (uint256 i = 0; i < weightsBps.length; i++) {
            parts[i] = (amount * weightsBps[i]) / BPS;
            used += parts[i];
        }
        unallocated = amount - used;
    }

    function _preset(uint256 id) internal view returns (Preset storage) {
        if (id >= _presets.length) revert UnknownPreset();
        return _presets[id];
    }

    function _activePreset(uint256 id) internal view returns (Preset storage p) {
        p = _preset(id);
        if (!p.active) revert InactivePreset();
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
