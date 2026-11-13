// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockMUSD is ERC20 {
    constructor() ERC20("Mezo USD", "MUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

contract MockPriceFeed {
    uint256 public price = 73_000e18;

    function setPrice(uint256 p) external {
        price = p;
    }

    function fetchPrice() external view returns (uint256) {
        return price;
    }
}

contract MockSortedTroves {
    address public last = address(0xBEEF);

    function setLast(address l) external {
        last = l;
    }

    function getLast() external view returns (address) {
        return last;
    }

    function getSize() external pure returns (uint256) {
        return 1;
    }
}

contract MockTroveManager {
    uint256 public icr = 1.5e18;
    uint256 public constant MCR = 1.1e18;

    function setICR(uint256 v) external {
        icr = v;
    }

    function getCurrentICR(address, uint256) external view returns (uint256) {
        return icr;
    }

    function getTCR(uint256) external pure returns (uint256) {
        return 2.5e18;
    }
}

/// @dev Simplified Stability Pool with the same external behaviour that matters to the
/// vault: gains are paid out on every provide/withdraw, withdrawals revert while a trove
/// is under MCR, liquidations shrink deposits and add BTC gains.
contract MockStabilityPool {
    MockMUSD public immutable musd;
    MockTroveManager public immutable troveManager;
    mapping(address => uint256) public deposits;
    mapping(address => uint256) public gains;
    uint256 public total;

    constructor(MockMUSD musd_, MockTroveManager tm_) {
        musd = musd_;
        troveManager = tm_;
    }

    receive() external payable {}

    function provideToSP(uint256 amount) external {
        require(amount > 0, "StabilityPool: Amount must be non-zero");
        musd.transferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
        total += amount;
        _payGain(msg.sender);
    }

    function withdrawFromSP(uint256 amount) external {
        if (amount != 0) {
            require(
                troveManager.icr() >= troveManager.MCR(),
                "StabilityPool: Cannot withdraw while there are troves with ICR < MCR"
            );
        }
        require(deposits[msg.sender] > 0, "StabilityPool: User must have a non-zero deposit");
        uint256 out = amount > deposits[msg.sender] ? deposits[msg.sender] : amount;
        deposits[msg.sender] -= out;
        total -= out;
        if (out > 0) musd.transfer(msg.sender, out);
        _payGain(msg.sender);
    }

    /// @dev Simulate a liquidation hitting `depositor`: burns `musdLoss`, credits BTC sent in.
    function simulateLiquidation(address depositor, uint256 musdLoss) external payable {
        deposits[depositor] -= musdLoss;
        total -= musdLoss;
        musd.burn(address(this), musdLoss);
        gains[depositor] += msg.value;
    }

    function _payGain(address to) internal {
        uint256 g = gains[to];
        if (g == 0) return;
        gains[to] = 0;
        (bool ok, ) = to.call{value: g}("");
        require(ok, "Sending BTC failed");
    }

    function getCompoundedMUSDDeposit(address d) external view returns (uint256) {
        return deposits[d];
    }

    function getDepositorCollateralGain(address d) external view returns (uint256) {
        return gains[d];
    }

    function getTotalMUSDDeposits() external view returns (uint256) {
        return total;
    }
}

/// @dev Attacker-controlled contract that pretends to be an ERC-4626 vault. Used by the
/// audit proof-of-concept tests only.
contract FakeVault {
    uint256 public fakeAssets;

    function setFakeAssets(uint256 v) external {
        fakeAssets = v;
    }

    function redeem(uint256, address, address) external view returns (uint256) {
        return fakeAssets;
    }
}
