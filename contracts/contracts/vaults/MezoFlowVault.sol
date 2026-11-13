// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IActivityLedger, IFeeManager, IMezoFlowVault} from "../interfaces/IMezoFlow.sol";
import {SafePermit, PermitSig} from "../libraries/SafePermit.sol";

/// @title MezoFlowVault
/// @notice Base ERC-4626 MUSD vault shared by every MezoFlow strategy.
///
/// Yield model: an optional, publicly visible reward reserve drips into the vault at a
/// fixed annual rate (`rateBps`) on deposited assets, capped by what is left in the
/// reserve. The reserve is funded by protocol fees (via FeeManager.recycle) or by anyone
/// calling `fundReserve`. Nothing is promised beyond what the reserve holds on-chain.
///
/// Deposits can be paused in an emergency; withdrawals can never be paused.
///
/// MUSD is pulled with EIP-2612 permits (`depositWithPermit`, `fundReserveWithPermit`), so
/// every action is one transaction. Vault shares are EIP-2612 tokens themselves, which lets
/// the AutoAllocator move a position with a signature instead of an approve.
abstract contract MezoFlowVault is ERC4626, ERC20Permit, Ownable, Pausable, ReentrancyGuard, IMezoFlowVault {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 internal constant YEAR = 365 days;
    uint256 internal constant BPS = 10_000;
    uint16 public constant MAX_RATE_BPS = 2_000; // 20% APR hard cap

    uint8 internal constant KIND_DEPOSIT = 0;
    uint8 internal constant KIND_WITHDRAW = 1;
    uint8 internal constant KIND_EARLY_EXIT = 4;
    uint8 internal constant KIND_TRANSFER_IN = 5;
    uint8 internal constant KIND_TRANSFER_OUT = 6;

    IActivityLedger public immutable ledger;
    IFeeManager public immutable feeManager;
    IERC20 internal immutable _musd;

    /// @notice MUSD owned by shareholders that is held by this contract. Tracked
    /// internally (never read from balanceOf) so a direct MUSD transfer cannot move the
    /// share price or the reward drip. Stray MUSD can be swept into the reserve by `skim`.
    uint256 public idleAssets;
    uint256 public rewardReserve;
    uint16 public rateBps;
    uint64 public lastAccrual;
    uint256 public totalRewardsPaid;
    uint256 public minDeposit;
    uint256 public cumulativeDeposits;
    uint256 public cumulativeWithdrawals;
    uint256 public depositorCount;
    uint256 public feesCollected;
    uint64 public checkpointInterval = 15 minutes;
    mapping(address => bool) public hasDeposited;

    Checkpoint[] internal _checkpoints;
    RatePoint[] internal _rateHistory;

    event RewardsAccrued(uint256 amount);
    event ReserveFunded(address indexed from, uint256 amount);
    event ReserveWithdrawn(address indexed to, uint256 amount);
    event RateUpdated(uint16 oldRateBps, uint16 newRateBps);
    event MinDepositUpdated(uint256 minDeposit);
    event ExitFeeCharged(address indexed owner, uint256 fee, bool toReserve);
    event CheckpointRecorded(uint64 timestamp, uint256 sharePrice);
    event Skimmed(uint256 amount);
    event DustSwept(uint256 amount);

    error BelowMinDeposit(uint256 minDeposit);
    error ZeroShares();
    error RateTooHigh();
    error InsufficientReserve();

    constructor(
        IERC20 musd_,
        string memory name_,
        string memory symbol_,
        address owner_,
        IActivityLedger ledger_,
        IFeeManager feeManager_,
        uint16 rateBps_,
        uint256 minDeposit_
    ) ERC20(name_, symbol_) ERC20Permit(name_) ERC4626(musd_) Ownable(owner_) {
        if (rateBps_ > MAX_RATE_BPS) revert RateTooHigh();
        _musd = musd_;
        ledger = ledger_;
        feeManager = feeManager_;
        rateBps = rateBps_;
        minDeposit = minDeposit_;
        lastAccrual = uint64(block.timestamp);
        _rateHistory.push(RatePoint(uint64(block.timestamp), rateBps_));
        _checkpoints.push(Checkpoint(uint64(block.timestamp), uint192(1e18)));
    }

    function decimals() public view virtual override(ERC20, ERC4626) returns (uint8) {
        return super.decimals();
    }

    // ---------------------------------------------------------------------
    // Strategy hooks
    // ---------------------------------------------------------------------

    function kind() external pure virtual returns (uint8);

    /// @dev Assets owned by depositors right now, excluding the reward reserve and
    /// excluding reserve rewards that have not been accrued yet.
    function _managedAssets() internal view virtual returns (uint256) {
        return idleAssets;
    }

    /// @dev Assets that can be paid out to exiting users right now (gross).
    function _availableLiquidity() internal view virtual returns (uint256) {
        return totalAssets();
    }

    /// @dev Make sure at least `amount` MUSD is held idle by the vault.
    function _ensureLiquidity(uint256 amount) internal virtual {}

    function _afterDeposit(uint256 assets) internal virtual {}

    function _beforeDepositMint(address caller, address receiver, uint256 shares) internal virtual {}

    /// @dev Exit fee in bps for `owner`, and whether it is retained by the vault's
    /// reserve (true) or sent to the treasury (false).
    function _exitFee(address /* owner */) internal view virtual returns (uint256 bps, bool toReserve) {
        return (feeManager.withdrawalFeeBps(address(this)), false);
    }

    /// @dev Fee used by the owner-agnostic ERC-4626 previews. Must be the highest fee any
    /// holder could pay, so previews never promise more than an exit returns.
    function _previewFeeBps() internal view virtual returns (uint256 bps) {
        (bps, ) = _exitFee(address(0));
    }

    function _unlockAt(address) internal view virtual returns (uint256) {
        return 0;
    }

    function _pendingBtc(address) internal view virtual returns (uint256) {
        return 0;
    }

    function _claimedBtc(address) internal view virtual returns (uint256) {
        return 0;
    }

    // ---------------------------------------------------------------------
    // Reserve-funded yield
    // ---------------------------------------------------------------------

    function _pendingDrip() internal view returns (uint256) {
        if (rateBps == 0 || rewardReserve == 0 || totalSupply() == 0) return 0;
        uint256 elapsed = block.timestamp - lastAccrual;
        if (elapsed == 0) return 0;
        uint256 drip = _managedAssets().mulDiv(uint256(rateBps) * elapsed, YEAR * BPS);
        return drip > rewardReserve ? rewardReserve : drip;
    }

    function _accrue() internal virtual {
        uint256 drip = _pendingDrip();
        if (drip > 0) {
            rewardReserve -= drip;
            idleAssets += drip;
            totalRewardsPaid += drip;
            emit RewardsAccrued(drip);
        }
        lastAccrual = uint64(block.timestamp);
    }

    function totalAssets() public view virtual override returns (uint256) {
        return _managedAssets() + _pendingDrip();
    }

    /// @notice Add MUSD to the reward reserve. Anyone can fund it.
    function fundReserve(uint256 amount) public nonReentrant {
        _accrue();
        _musd.safeTransferFrom(msg.sender, address(this), amount);
        rewardReserve += amount;
        emit ReserveFunded(msg.sender, amount);
    }

    /// @notice `fundReserve` with an MUSD permit — one transaction, no approve.
    function fundReserveWithPermit(uint256 amount, PermitSig calldata sig) external {
        SafePermit.usePermit(_musd, msg.sender, address(this), amount, sig);
        fundReserve(amount);
    }

    function withdrawReserve(uint256 amount, address to) external onlyOwner nonReentrant {
        _accrue();
        if (amount > rewardReserve) revert InsufficientReserve();
        rewardReserve -= amount;
        // The reserve is always held idle by the vault, never deployed to a strategy.
        _musd.safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount);
    }

    /// @notice Sweep MUSD sent to the vault without a deposit into the reward reserve,
    /// where it is paid out to shareholders over time. Callable by anyone.
    function skim() external nonReentrant returns (uint256 excess) {
        _accrue();
        uint256 bal = _musd.balanceOf(address(this));
        uint256 owed = idleAssets + rewardReserve;
        if (bal > owed) {
            excess = bal - owed;
            rewardReserve += excess;
            emit Skimmed(excess);
        }
    }

    function setRate(uint16 newRateBps) external onlyOwner {
        if (newRateBps > MAX_RATE_BPS) revert RateTooHigh();
        _accrue();
        emit RateUpdated(rateBps, newRateBps);
        rateBps = newRateBps;
        _rateHistory.push(RatePoint(uint64(block.timestamp), newRateBps));
        _checkpoint();
    }

    function setMinDeposit(uint256 newMin) external onlyOwner {
        minDeposit = newMin;
        emit MinDepositUpdated(newMin);
    }

    function setCheckpointInterval(uint64 interval) external onlyOwner {
        checkpointInterval = interval;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Accrue rewards and record a share-price checkpoint. Callable by anyone.
    function poke() external nonReentrant {
        _accrue();
        _checkpoint();
    }

    // ---------------------------------------------------------------------
    // ERC-4626 entry points
    // ---------------------------------------------------------------------

    function deposit(uint256 assets, address receiver) public virtual override nonReentrant returns (uint256) {
        _accrue();
        return super.deposit(assets, receiver);
    }

    /// @notice `deposit` with an MUSD permit — one transaction, no approve.
    function depositWithPermit(uint256 assets, address receiver, PermitSig calldata sig) external returns (uint256) {
        SafePermit.usePermit(_musd, msg.sender, address(this), assets, sig);
        return deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public virtual override nonReentrant returns (uint256) {
        _accrue();
        return super.mint(shares, receiver);
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public virtual override nonReentrant returns (uint256 shares) {
        _accrue();
        uint256 maxAssets = maxWithdraw(owner);
        if (assets > maxAssets) revert ERC4626ExceededMaxWithdraw(owner, assets, maxAssets);
        (uint256 bps, bool toReserve) = _exitFee(owner);
        uint256 fee = assets.mulDiv(bps, BPS, Math.Rounding.Ceil);
        shares = _convertToShares(assets + fee, Math.Rounding.Ceil);
        _exit(_msgSender(), receiver, owner, assets, shares, fee, toReserve);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public virtual override nonReentrant returns (uint256 assets) {
        _accrue();
        uint256 maxShares = maxRedeem(owner);
        if (shares > maxShares) revert ERC4626ExceededMaxRedeem(owner, shares, maxShares);
        (uint256 bps, bool toReserve) = _exitFee(owner);
        uint256 gross = _convertToAssets(shares, Math.Rounding.Floor);
        uint256 fee = gross.mulDiv(bps, BPS + bps, Math.Rounding.Ceil);
        assets = gross - fee;
        _exit(_msgSender(), receiver, owner, assets, shares, fee, toReserve);
    }

    function maxDeposit(address) public view virtual override returns (uint256) {
        return paused() ? 0 : type(uint256).max;
    }

    function maxMint(address) public view virtual override returns (uint256) {
        return paused() ? 0 : type(uint256).max;
    }

    function maxWithdraw(address owner) public view virtual override returns (uint256) {
        (uint256 bps, ) = _exitFee(owner);
        uint256 gross = _convertToAssets(balanceOf(owner), Math.Rounding.Floor);
        uint256 liquidity = _availableLiquidity();
        if (gross > liquidity) gross = liquidity;
        return gross.mulDiv(BPS, BPS + bps, Math.Rounding.Floor);
    }

    function maxRedeem(address owner) public view virtual override returns (uint256) {
        uint256 bal = balanceOf(owner);
        uint256 liquidity = _availableLiquidity();
        uint256 liquidShares = _convertToShares(liquidity, Math.Rounding.Floor);
        return bal < liquidShares ? bal : liquidShares;
    }

    function previewWithdraw(uint256 assets) public view virtual override returns (uint256) {
        uint256 bps = _previewFeeBps();
        uint256 fee = assets.mulDiv(bps, BPS, Math.Rounding.Ceil);
        return _convertToShares(assets + fee, Math.Rounding.Ceil);
    }

    function previewRedeem(uint256 shares) public view virtual override returns (uint256) {
        uint256 bps = _previewFeeBps();
        uint256 gross = _convertToAssets(shares, Math.Rounding.Floor);
        return gross - gross.mulDiv(bps, BPS + bps, Math.Rounding.Ceil);
    }

    /// @notice Owner-aware redeem preview (accounts for lock penalties).
    function previewRedeemFor(address owner, uint256 shares) external view returns (uint256 assets, uint256 fee) {
        (uint256 bps, ) = _exitFee(owner);
        uint256 gross = _convertToAssets(shares, Math.Rounding.Floor);
        fee = gross.mulDiv(bps, BPS + bps, Math.Rounding.Ceil);
        assets = gross - fee;
    }

    /// @notice Owner-aware withdraw preview (accounts for lock penalties).
    function previewWithdrawFor(address owner, uint256 assets) external view returns (uint256 shares, uint256 fee) {
        (uint256 bps, ) = _exitFee(owner);
        fee = assets.mulDiv(bps, BPS, Math.Rounding.Ceil);
        shares = _convertToShares(assets + fee, Math.Rounding.Ceil);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal virtual override whenNotPaused {
        if (assets < minDeposit) revert BelowMinDeposit(minDeposit);
        if (shares == 0) revert ZeroShares();
        _beforeDepositMint(caller, receiver, shares);
        super._deposit(caller, receiver, assets, shares);
        idleAssets += assets;
        _afterDeposit(assets);

        cumulativeDeposits += assets;
        if (!hasDeposited[receiver]) {
            hasDeposited[receiver] = true;
            depositorCount += 1;
        }
        ledger.record(receiver, KIND_DEPOSIT, address(this), assets, shares, 0);
        _checkpoint();
    }

    function _exit(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares,
        uint256 fee,
        bool toReserve
    ) internal virtual {
        if (shares == 0) revert ZeroShares();
        if (caller != owner) _spendAllowance(owner, caller, shares);
        _burn(owner, shares);

        _ensureLiquidity(assets + fee);
        idleAssets -= assets + fee;
        _musd.safeTransfer(receiver, assets);

        if (fee > 0) {
            if (toReserve) {
                rewardReserve += fee;
            } else {
                _musd.safeTransfer(address(feeManager), fee);
                feeManager.notifyFee(fee);
            }
            feesCollected += fee;
            emit ExitFeeCharged(owner, fee, toReserve);
        }

        cumulativeWithdrawals += assets;
        if (totalSupply() == 0) _sweepDust();
        ledger.record(
            owner,
            (toReserve && fee > 0) ? KIND_EARLY_EXIT : KIND_WITHDRAW,
            address(this),
            assets,
            shares,
            fee
        );
        emit Withdraw(caller, receiver, owner, assets, shares);
        _checkpoint();
    }

    /// @dev When the last share is burned, rounding can leave a few wei of assets with no
    /// owner. Left in place they would price the next depositor's shares at 2:1 or 3:1
    /// (audit F-11), so they go to the reward reserve instead.
    function _sweepDust() internal virtual {
        uint256 dust = idleAssets;
        if (dust > 0) {
            idleAssets = 0;
            rewardReserve += dust;
            emit DustSwept(dust);
        }
    }

    function _update(address from, address to, uint256 value) internal virtual override {
        super._update(from, to, value);
        if (from != address(0) && to != address(0) && value > 0) {
            uint256 assets = _convertToAssets(value, Math.Rounding.Floor);
            ledger.record(from, KIND_TRANSFER_OUT, address(this), assets, value, 0);
            ledger.record(to, KIND_TRANSFER_IN, address(this), assets, value, 0);
        }
    }

    function _checkpoint() internal {
        uint256 price = _convertToAssets(1e18, Math.Rounding.Floor);
        uint256 n = _checkpoints.length;
        if (n > 0 && block.timestamp - _checkpoints[n - 1].timestamp < checkpointInterval) {
            _checkpoints[n - 1].sharePrice = uint192(price);
        } else {
            _checkpoints.push(Checkpoint(uint64(block.timestamp), uint192(price)));
        }
        emit CheckpointRecorded(uint64(block.timestamp), price);
    }

    function _runway() internal view returns (uint256) {
        if (rateBps == 0) return type(uint256).max;
        uint256 perYear = totalAssets().mulDiv(rateBps, BPS);
        if (perYear == 0) return type(uint256).max;
        uint256 reserveNow = rewardReserve - _pendingDrip();
        return reserveNow.mulDiv(YEAR, perYear);
    }

    // ---------------------------------------------------------------------
    // Views for the app
    // ---------------------------------------------------------------------

    function stats() external view virtual returns (VaultStats memory s) {
        uint256 pending = _pendingDrip();
        (uint256 bps, ) = _exitFee(address(0));
        s.totalAssets = totalAssets();
        s.totalSupply = totalSupply();
        s.sharePrice = _convertToAssets(1e18, Math.Rounding.Floor);
        s.rewardReserve = rewardReserve - pending;
        s.rateBps = rateBps;
        s.totalRewardsPaid = totalRewardsPaid + pending;
        s.cumulativeDeposits = cumulativeDeposits;
        s.cumulativeWithdrawals = cumulativeWithdrawals;
        s.depositorCount = depositorCount;
        s.minDeposit = minDeposit;
        s.exitFeeBps = uint16(bps);
        s.paused = paused();
        s.availableLiquidity = _availableLiquidity();
        s.runwaySeconds = _runway();
        s.feesCollected = feesCollected;
    }

    function userInfo(address user) external view virtual returns (UserInfo memory u) {
        (uint256 bps, ) = _exitFee(user);
        u.shares = balanceOf(user);
        u.assets = _convertToAssets(u.shares, Math.Rounding.Floor);
        u.maxWithdraw = maxWithdraw(user);
        u.exitFeeBps = bps;
        u.unlockAt = _unlockAt(user);
        u.pendingBtc = _pendingBtc(user);
        u.claimedBtc = _claimedBtc(user);
    }

    function checkpointCount() external view returns (uint256) {
        return _checkpoints.length;
    }

    /// @notice Oldest-first slice of share-price checkpoints.
    function getCheckpoints(uint256 offset, uint256 limit) external view returns (Checkpoint[] memory page) {
        uint256 n = _checkpoints.length;
        if (offset >= n) return new Checkpoint[](0);
        uint256 count = n - offset < limit ? n - offset : limit;
        page = new Checkpoint[](count);
        for (uint256 i = 0; i < count; i++) page[i] = _checkpoints[offset + i];
    }

    function getRateHistory() external view returns (RatePoint[] memory) {
        return _rateHistory;
    }
}
