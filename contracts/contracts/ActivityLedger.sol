// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ActivityLedger
/// @notice Append-only on-chain record of every MezoFlow user action. Vaults, the
/// allocator and the faucet write to it; the app reads history, totals and the
/// global activity feed straight from here, so no off-chain indexer is needed.
contract ActivityLedger is Ownable {
    uint8 public constant KIND_DEPOSIT = 0;
    uint8 public constant KIND_WITHDRAW = 1;
    uint8 public constant KIND_ALLOCATE = 2;
    uint8 public constant KIND_CLAIM_BTC = 3;
    uint8 public constant KIND_EARLY_EXIT = 4;
    uint8 public constant KIND_TRANSFER_IN = 5;
    uint8 public constant KIND_TRANSFER_OUT = 6;
    uint8 public constant KIND_FAUCET = 7;
    uint8 public constant KIND_REALLOCATE = 8;

    struct Entry {
        uint64 timestamp;
        uint64 blockNumber;
        uint8 kind;
        address vault;
        address user;
        uint128 assets;
        uint128 shares;
        uint128 fee;
    }

    struct Totals {
        uint128 deposited;
        uint128 withdrawn;
        uint128 fees;
        uint64 firstActivity;
        uint64 actions;
    }

    mapping(address => bool) public isWriter;
    Entry[] private _entries;
    mapping(address => uint256[]) private _userEntries;
    mapping(address => Totals) public totals;
    uint256 public uniqueUsers;
    uint256 public globalDeposited;
    uint256 public globalWithdrawn;
    uint256 public globalFees;

    event WriterSet(address indexed writer, bool allowed);
    event Recorded(
        uint256 indexed id,
        address indexed user,
        address indexed vault,
        uint8 kind,
        uint256 assets,
        uint256 shares,
        uint256 fee
    );

    error NotWriter();

    constructor(address owner_) Ownable(owner_) {}

    function setWriter(address writer, bool allowed) external onlyOwner {
        isWriter[writer] = allowed;
        emit WriterSet(writer, allowed);
    }

    function record(
        address user,
        uint8 kind,
        address vault,
        uint256 assets,
        uint256 shares,
        uint256 fee
    ) external {
        if (!isWriter[msg.sender]) revert NotWriter();

        uint256 id = _entries.length;
        _entries.push(
            Entry({
                timestamp: uint64(block.timestamp),
                blockNumber: uint64(block.number),
                kind: kind,
                vault: vault,
                user: user,
                assets: uint128(assets),
                shares: uint128(shares),
                fee: uint128(fee)
            })
        );
        _userEntries[user].push(id);

        Totals storage t = totals[user];
        if (t.firstActivity == 0) {
            t.firstActivity = uint64(block.timestamp);
            uniqueUsers += 1;
        }
        t.actions += 1;
        if (kind == KIND_DEPOSIT) {
            t.deposited += uint128(assets);
            globalDeposited += assets;
        } else if (kind == KIND_WITHDRAW || kind == KIND_EARLY_EXIT) {
            t.withdrawn += uint128(assets);
            globalWithdrawn += assets;
        }
        if (fee > 0 && kind != KIND_CLAIM_BTC) {
            t.fees += uint128(fee);
            globalFees += fee;
        }

        emit Recorded(id, user, vault, kind, assets, shares, fee);
    }

    function entryCount() external view returns (uint256) {
        return _entries.length;
    }

    function userEntryCount(address user) external view returns (uint256) {
        return _userEntries[user].length;
    }

    function getEntry(uint256 id) external view returns (Entry memory) {
        return _entries[id];
    }

    /// @notice Newest-first page of a user's entries.
    function getUserEntries(
        address user,
        uint256 offset,
        uint256 limit
    ) external view returns (Entry[] memory page, uint256[] memory ids) {
        uint256[] storage list = _userEntries[user];
        uint256 n = list.length;
        if (offset >= n) return (new Entry[](0), new uint256[](0));
        uint256 count = n - offset < limit ? n - offset : limit;
        page = new Entry[](count);
        ids = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 id = list[n - 1 - offset - i];
            page[i] = _entries[id];
            ids[i] = id;
        }
    }

    /// @notice Newest-first page of the global activity feed.
    function getRecent(
        uint256 offset,
        uint256 limit
    ) external view returns (Entry[] memory page, uint256[] memory ids) {
        uint256 n = _entries.length;
        if (offset >= n) return (new Entry[](0), new uint256[](0));
        uint256 count = n - offset < limit ? n - offset : limit;
        page = new Entry[](count);
        ids = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 id = n - 1 - offset - i;
            page[i] = _entries[id];
            ids[i] = id;
        }
    }
}
