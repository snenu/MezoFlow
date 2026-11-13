// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MezoFlowVault} from "./MezoFlowVault.sol";
import {IActivityLedger, IFeeManager} from "../interfaces/IMezoFlow.sol";
import {IStabilityPool, IPriceFeed, ISortedTroves, ITroveManager} from "../interfaces/IMezo.sol";

/// @title StabilityPoolVault
/// @notice Strategy B — routes MUSD into the official Mezo MUSD Stability Pool.
///
/// How it earns: when an MUSD trove is liquidated, the Stability Pool burns MUSD to
/// cancel the debt and receives the trove's BTC collateral, normally at a discount.
/// Depositors therefore see their MUSD balance shrink slightly and receive BTC worth
/// more than the MUSD lost. This vault passes that BTC to shareholders pro-rata; they
/// claim it with `claimBtc()`.
///
/// Liquidity: `bufferBps` of assets stay idle for instant exits. The rest can only be
/// pulled from the Stability Pool while no trove sits below the 110% MCR — this is a
/// rule of the Mezo protocol itself, surfaced live through `withdrawalsOpen()`.
contract StabilityPoolVault is MezoFlowVault {
    using Math for uint256;

    uint256 private constant ACC = 1e18;
    uint16 public constant MAX_BUFFER_BPS = 5_000;
    uint8 private constant KIND_CLAIM_BTC = 3;

    IStabilityPool public immutable stabilityPool;
    IPriceFeed public immutable priceFeed;
    ISortedTroves public immutable sortedTroves;
    ITroveManager public immutable troveManager;

    uint16 public bufferBps;
    uint256 public accBtcPerShare;
    uint256 public btcReserved;
    uint256 public totalBtcDistributed;
    uint256 public totalBtcClaimed;
    mapping(address => uint256) public btcDebt;
    mapping(address => uint256) public btcOwed;
    mapping(address => uint256) public btcClaimed;

    struct SpHealth {
        uint256 btcPrice;
        uint256 lowestIcr;
        uint256 mcr;
        uint256 tcr;
        uint256 poolTotalDeposits;
        uint256 vaultDeposit;
        uint256 vaultPendingGain;
        uint256 idle;
        uint256 bufferBps;
        bool withdrawalsOpen;
        address lowestTrove;
    }

    struct BtcStats {
        uint256 totalDistributed;
        uint256 totalClaimed;
        uint256 unclaimed;
        uint256 pendingFromPool;
        uint256 btcPrice;
    }

    event BtcDistributed(uint256 amount, uint256 accBtcPerShare);
    event BtcClaimed(address indexed user, uint256 amount);
    event BufferUpdated(uint16 bufferBps);
    event Rebalanced(uint256 toPool, uint256 idleAfter);

    error SPWithdrawalsLocked();
    error NothingToClaim();
    error BtcTransferFailed();
    error InvalidBuffer();

    constructor(
        IERC20 musd_,
        address owner_,
        IActivityLedger ledger_,
        IFeeManager feeManager_,
        uint256 minDeposit_,
        IStabilityPool stabilityPool_,
        IPriceFeed priceFeed_,
        ISortedTroves sortedTroves_,
        ITroveManager troveManager_,
        uint16 bufferBps_
    )
        MezoFlowVault(musd_, "MezoFlow Stability Pool", "mfSP", owner_, ledger_, feeManager_, 0, minDeposit_)
    {
        if (bufferBps_ > MAX_BUFFER_BPS) revert InvalidBuffer();
        stabilityPool = stabilityPool_;
        priceFeed = priceFeed_;
        sortedTroves = sortedTroves_;
        troveManager = troveManager_;
        bufferBps = bufferBps_;
        musd_.approve(address(stabilityPool_), type(uint256).max);
    }

    receive() external payable {}

    function kind() external pure override returns (uint8) {
        return 3;
    }

    // ---------------------------------------------------------------------
    // Assets & liquidity
    // ---------------------------------------------------------------------

    function _idle() internal view returns (uint256) {
        return idleAssets;
    }

    function _poolDeposit() internal view returns (uint256) {
        return stabilityPool.getCompoundedMUSDDeposit(address(this));
    }

    function _managedAssets() internal view override returns (uint256) {
        return _idle() + _poolDeposit();
    }

    function withdrawalsOpen() public view returns (bool) {
        try priceFeed.fetchPrice() returns (uint256 price) {
            address last;
            try sortedTroves.getLast() returns (address l) {
                last = l;
            } catch {
                return false;
            }
            if (last == address(0)) return true;
            try troveManager.getCurrentICR(last, price) returns (uint256 icr) {
                return icr >= troveManager.MCR();
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }

    function _availableLiquidity() internal view override returns (uint256) {
        uint256 liquid = _idle();
        if (withdrawalsOpen()) liquid += _poolDeposit();
        return liquid;
    }

    function _ensureLiquidity(uint256 amount) internal override {
        uint256 idle = idleAssets;
        if (idle >= amount) return;
        if (!withdrawalsOpen()) revert SPWithdrawalsLocked();
        uint256 before = _musd.balanceOf(address(this));
        stabilityPool.withdrawFromSP(amount - idle);
        // Credit exactly what the pool sent back.
        idleAssets += _musd.balanceOf(address(this)) - before;
        _syncBtc();
    }

    function _afterDeposit(uint256) internal override {
        _rebalance();
    }

    function _rebalance() internal {
        uint256 idle = _idle();
        uint256 target = (idle + _poolDeposit()).mulDiv(bufferBps, BPS);
        if (idle > target) {
            uint256 amount = idle - target;
            idleAssets = idle - amount;
            stabilityPool.provideToSP(amount);
            _syncBtc();
            emit Rebalanced(amount, _idle());
        }
    }

    /// @notice Push excess idle MUSD into the pool and collect BTC gains. Callable by anyone.
    function rebalance() external nonReentrant {
        _accrue();
        _rebalance();
        _checkpoint();
    }

    function setBufferBps(uint16 bufferBps_) external onlyOwner {
        if (bufferBps_ > MAX_BUFFER_BPS) revert InvalidBuffer();
        bufferBps = bufferBps_;
        emit BufferUpdated(bufferBps_);
    }

    // ---------------------------------------------------------------------
    // BTC gain distribution
    // ---------------------------------------------------------------------

    function _accrue() internal override {
        _harvest();
        super._accrue();
    }

    function _harvest() internal {
        if (
            stabilityPool.deposits(address(this)) > 0 &&
            stabilityPool.getDepositorCollateralGain(address(this)) > 0
        ) {
            stabilityPool.withdrawFromSP(0);
        }
        _syncBtc();
    }

    function _syncBtc() internal {
        uint256 bal = address(this).balance;
        if (bal <= btcReserved) return;
        uint256 supply = totalSupply();
        if (supply == 0) return;
        uint256 gain = bal - btcReserved;
        accBtcPerShare += gain.mulDiv(ACC, supply);
        btcReserved = bal;
        totalBtcDistributed += gain;
        emit BtcDistributed(gain, accBtcPerShare);
    }

    function _settle(address user) internal {
        uint256 accrued = balanceOf(user).mulDiv(accBtcPerShare, ACC);
        uint256 debt = btcDebt[user];
        if (accrued > debt) btcOwed[user] += accrued - debt;
    }

    function _update(address from, address to, uint256 value) internal override {
        _syncBtc();
        if (from != address(0)) _settle(from);
        if (to != address(0)) _settle(to);
        super._update(from, to, value);
        if (from != address(0)) btcDebt[from] = balanceOf(from).mulDiv(accBtcPerShare, ACC);
        if (to != address(0)) btcDebt[to] = balanceOf(to).mulDiv(accBtcPerShare, ACC);
    }

    function claimBtc() external nonReentrant returns (uint256 amount) {
        _harvest();
        _settle(msg.sender);
        btcDebt[msg.sender] = balanceOf(msg.sender).mulDiv(accBtcPerShare, ACC);
        amount = btcOwed[msg.sender];
        if (amount == 0) revert NothingToClaim();
        btcOwed[msg.sender] = 0;
        btcReserved -= amount;
        totalBtcClaimed += amount;
        btcClaimed[msg.sender] += amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert BtcTransferFailed();
        ledger.record(msg.sender, KIND_CLAIM_BTC, address(this), amount, 0, 0);
        emit BtcClaimed(msg.sender, amount);
    }

    function _pendingBtc(address user) internal view override returns (uint256) {
        uint256 acc = accBtcPerShare;
        uint256 supply = totalSupply();
        if (supply > 0) {
            uint256 bal = address(this).balance;
            uint256 unsynced = bal > btcReserved ? bal - btcReserved : 0;
            unsynced += stabilityPool.getDepositorCollateralGain(address(this));
            acc += unsynced.mulDiv(ACC, supply);
        }
        uint256 accrued = balanceOf(user).mulDiv(acc, ACC);
        uint256 debt = btcDebt[user];
        return btcOwed[user] + (accrued > debt ? accrued - debt : 0);
    }

    function _claimedBtc(address user) internal view override returns (uint256) {
        return btcClaimed[user];
    }

    function pendingBtc(address user) external view returns (uint256) {
        return _pendingBtc(user);
    }

    // ---------------------------------------------------------------------
    // Risk telemetry
    // ---------------------------------------------------------------------

    function spHealth() external view returns (SpHealth memory h) {
        h.poolTotalDeposits = stabilityPool.getTotalMUSDDeposits();
        h.vaultDeposit = _poolDeposit();
        h.vaultPendingGain = stabilityPool.getDepositorCollateralGain(address(this));
        h.idle = _idle();
        h.bufferBps = bufferBps;
        try priceFeed.fetchPrice() returns (uint256 price) {
            h.btcPrice = price;
            try troveManager.MCR() returns (uint256 mcr) {
                h.mcr = mcr;
            } catch {}
            try troveManager.getTCR(price) returns (uint256 tcr) {
                h.tcr = tcr;
            } catch {}
            try sortedTroves.getLast() returns (address last) {
                h.lowestTrove = last;
                if (last != address(0)) {
                    try troveManager.getCurrentICR(last, price) returns (uint256 icr) {
                        h.lowestIcr = icr;
                    } catch {}
                }
            } catch {}
        } catch {}
        h.withdrawalsOpen = withdrawalsOpen();
    }

    function btcStats() external view returns (BtcStats memory b) {
        b.totalDistributed = totalBtcDistributed;
        b.totalClaimed = totalBtcClaimed;
        b.unclaimed = btcReserved;
        b.pendingFromPool = stabilityPool.getDepositorCollateralGain(address(this));
        try priceFeed.fetchPrice() returns (uint256 price) {
            b.btcPrice = price;
        } catch {}
    }
}
