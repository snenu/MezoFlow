// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StrategyRegistry} from "./StrategyRegistry.sol";
import {ActivityLedger} from "./ActivityLedger.sol";
import {FeeManager} from "./FeeManager.sol";
import {MUSDFaucet} from "./MUSDFaucet.sol";
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
    }

    IERC20 public immutable musd;
    StrategyRegistry public immutable registry;
    ActivityLedger public immutable ledger;
    FeeManager public immutable feeManager;
    MUSDFaucet public immutable faucet;
    address public immutable allocator;

    constructor(
        IERC20 musd_,
        StrategyRegistry registry_,
        ActivityLedger ledger_,
        FeeManager feeManager_,
        MUSDFaucet faucet_,
        address allocator_
    ) {
        musd = musd_;
        registry = registry_;
        ledger = ledger_;
        feeManager = feeManager_;
        faucet = faucet_;
        allocator = allocator_;
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
    }

    function getAll(
        address user
    ) external view returns (ProtocolView memory p, StrategyView[] memory s, AccountView memory a) {
        p = getProtocol();
        s = getStrategies(user);
        if (user != address(0)) a = getAccount(user);
    }
}
