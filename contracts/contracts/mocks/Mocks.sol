// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev MUSD stand-in with the same EIP-2612 domain as testnet MUSD ("Mezo USD", "1").
contract MockMUSD is ERC20Permit {
    constructor() ERC20("Mezo USD", "MUSD") ERC20Permit("Mezo USD") {}

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

/// @dev Stand-in for Mezo's BTC / MEZO ERC-20 precompiles (both support EIP-2612).
contract MockToken is ERC20Permit {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) ERC20Permit(name_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @dev Minimal Mezo Pools router: fixed rates, pulls the input token and mints output.
contract MockRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    address public immutable factory;
    mapping(address => mapping(address => uint256)) public rate; // 1e18 = 1:1

    constructor(address factory_) {
        factory = factory_;
    }

    function setRate(address from, address to, uint256 r) external {
        rate[from][to] = r;
    }

    function getAmountsOut(uint256 amountIn, Route[] calldata routes) public view returns (uint256[] memory amounts) {
        amounts = new uint256[](routes.length + 1);
        amounts[0] = amountIn;
        for (uint256 i = 0; i < routes.length; i++) {
            require(routes[i].factory == factory, "Router: bad factory");
            amounts[i + 1] = (amounts[i] * rate[routes[i].from][routes[i].to]) / 1e18;
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "Router: EXPIRED");
        amounts = getAmountsOut(amountIn, routes);
        uint256 out = amounts[amounts.length - 1];
        require(out >= amountOutMin, "Router: INSUFFICIENT_OUTPUT_AMOUNT");
        IERC20(routes[0].from).transferFrom(msg.sender, address(this), amountIn);
        IMintable(routes[routes.length - 1].to).mint(to, out);
    }
}
