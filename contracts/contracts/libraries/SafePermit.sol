// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/// @notice An EIP-2612 signature, passed alongside an action so it needs no separate approve.
struct PermitSig {
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
}

/// @title SafePermit
/// @notice Applies an EIP-2612 permit without letting a front-runner grief the action.
/// Permit signatures are public once in the mempool: anyone can submit one first, which
/// makes the original `permit` call revert. If that happens and the allowance is already
/// in place, the action goes ahead anyway.
library SafePermit {
    error PermitFailed();

    function usePermit(IERC20 token, address owner, address spender, uint256 value, PermitSig memory sig) internal {
        try IERC20Permit(address(token)).permit(owner, spender, value, sig.deadline, sig.v, sig.r, sig.s) {} catch {
            if (token.allowance(owner, spender) < value) revert PermitFailed();
        }
    }
}
