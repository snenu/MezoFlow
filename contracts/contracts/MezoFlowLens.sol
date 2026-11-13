// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {StrategyRegistry} from "./StrategyRegistry.sol";
import {ActivityLedger} from "./ActivityLedger.sol";
import {FeeManager} from "./FeeManager.sol";
import {MUSDFaucet} from "./MUSDFaucet.sol";
import {MezoFlowZap} from "./MezoFlowZap.sol";
import {IMezoFlowVault} from "./interfaces/IMezoFlow.sol";

/// @title MezoFlowLens
/// @notice Read-only aggregator: returns the full marketplace and a user's whole
/// account in single eth_calls so the app stays fast and fully on-chain.
contract MezoFlowLens {
    struct StrategyView {
        uint256 id;
        StrategyRegistry.Strategy meta;
        IMezoFlowVault.VaultStats stats;
        IMezoFlowVault.UserInfo user;
        uint256 musdAllowance; // user -> vault
        uint256 shareAllowanceToAllocator; // vault shares user -> allocator
        uint256 shareNonce; // EIP-2612 nonce of the vault share token
    }

    struct AccountView {
        uint256 musdBalance;
        uint256 btcBalance;
        uint256 allocatorAllowance;
        uint128 deposited;
        uint128 withdrawn;
        uint128 fees;
        uint64 firstActivity;
        uint64 actions;
        uint256 entryCount;
        uint64 faucetNextClaimAt;
        uint256 musdNonce; // EIP-2612 nonces for one-transaction permits
        uint256 btcNonce;
        uint256 mezoNonce;
        uint256 mezoBalance;
        uint256 btcAllowanceToZap;
        uint256 mezoAllowanceToZap;
    }

    struct ProtocolView {
        uint256 strategyCount;
        uint256 tvl;
        uint256 uniqueUsers;
        uint256 globalDeposited;
        uint256 globalWithdrawn;
        uint256 globalFees;
        uint256 entryCount;
        uint256 treasuryBalance;
        uint256 totalFeesCollected;
        uint256 announcementCount;
        uint256 faucetBalance;
        uint256 faucetAmount;
        uint64 faucetCooldown;
        uint256 swapCount;
        uint256 swapMusdOut;
    }

    IERC20 public immutable musd;
    StrategyRegistry public immutable registry;
    ActivityLedger public immutable ledger;
    FeeManager public immutable feeManager;
    MUSDFaucet public immutable faucet;
    address public immutable allocator;
    MezoFlowZap public immutable zap;
    IERC20 public immutable btc; // Mezo BTC ERC-20 precompile
    IERC20 public immutable mezo; // Mezo MEZO ERC-20 precompile

    constructor(
        IERC20 musd_,
        StrategyRegistry registry_,
        ActivityLedger ledger_,
        FeeManager feeManager_,
        MUSDFaucet faucet_,
        address allocator_,
        MezoFlowZap zap_,
        IERC20 btc_,
        IERC20 mezo_
    ) {
        musd = musd_;
        registry = registry_;
        ledger = ledger_;
        feeManager = feeManager_;
        faucet = faucet_;
        allocator = allocator_;
        zap = zap_;
        btc = btc_;
        mezo = mezo_;
    }

    function getStrategies(address user) public view returns (StrategyView[] memory views) {
        StrategyRegistry.Strategy[] memory list = registry.getStrategies();
        views = new StrategyView[](list.length);
        for (uint256 i = 0; i < list.length; i++) {
            IMezoFlowVault v = IMezoFlowVault(list[i].vault);
            views[i].id = i;
            views[i].meta = list[i];
            views[i].stats = v.stats();
            if (user != address(0)) {
                views[i].user = v.userInfo(user);
                views[i].musdAllowance = musd.allowance(user, list[i].vault);
                views[i].shareAllowanceToAllocator = IERC20(list[i].vault).allowance(user, allocator);
                views[i].shareNonce = IERC20Permit(list[i].vault).nonces(user);
            }
        }
    }

    function getAccount(address user) public view returns (AccountView memory a) {
        a.musdBalance = musd.balanceOf(user);
        a.btcBalance = user.balance;
        a.allocatorAllowance = musd.allowance(user, allocator);
        (a.deposited, a.withdrawn, a.fees, a.firstActivity, a.actions) = ledger.totals(user);
        a.entryCount = ledger.userEntryCount(user);
        a.faucetNextClaimAt = faucet.nextClaimAt(user);
        a.musdNonce = IERC20Permit(address(musd)).nonces(user);
        a.btcNonce = _nonce(btc, user);
        a.mezoNonce = _nonce(mezo, user);
        a.mezoBalance = _balance(mezo, user);
        a.btcAllowanceToZap = _allowance(btc, user);
        a.mezoAllowanceToZap = _allowance(mezo, user);
    }

    // Precompile reads are wrapped so a missing token never breaks the whole account view.
    function _nonce(IERC20 token, address user) internal view returns (uint256) {
        try IERC20Permit(address(token)).nonces(user) returns (uint256 n) {
            return n;
        } catch {
            return 0;
        }
    }

    function _balance(IERC20 token, address user) internal view returns (uint256) {
        try token.balanceOf(user) returns (uint256 b) {
            return b;
        } catch {
            return 0;
        }
    }

    function _allowance(IERC20 token, address user) internal view returns (uint256) {
        try token.allowance(user, address(zap)) returns (uint256 a) {
            return a;
        } catch {
            return 0;
        }
    }

    function getProtocol() public view returns (ProtocolView memory p) {
        StrategyRegistry.Strategy[] memory list = registry.getStrategies();
        p.strategyCount = list.length;
        for (uint256 i = 0; i < list.length; i++) {
            p.tvl += IMezoFlowVault(list[i].vault).stats().totalAssets;
        }
        p.uniqueUsers = ledger.uniqueUsers();
        p.globalDeposited = ledger.globalDeposited();
        p.globalWithdrawn = ledger.globalWithdrawn();
        p.globalFees = ledger.globalFees();
        p.entryCount = ledger.entryCount();
        p.treasuryBalance = feeManager.treasuryBalance();
        p.totalFeesCollected = feeManager.totalFeesCollected();
        p.announcementCount = registry.announcementCount();
        p.faucetBalance = faucet.balance();
        p.faucetAmount = faucet.amountPerClaim();
        p.faucetCooldown = faucet.cooldown();
        p.swapCount = zap.swapCount();
        p.swapMusdOut = zap.totalMusdOut();
    }

    function getAll(
        address user
    ) external view returns (ProtocolView memory p, StrategyView[] memory s, AccountView memory a) {
        p = getProtocol();
        s = getStrategies(user);
        if (user != address(0)) a = getAccount(user);
    }
}
