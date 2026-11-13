// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal surface of the Mezo MUSD Stability Pool used by MezoFlow.
/// Source: github.com/mezo-org/musd — solidity/contracts/StabilityPool.sol
interface IStabilityPool {
    function provideToSP(uint256 amount) external;

    function withdrawFromSP(uint256 amount) external;

    function getCompoundedMUSDDeposit(address depositor) external view returns (uint256);

    function getDepositorCollateralGain(address depositor) external view returns (uint256);

    function getTotalMUSDDeposits() external view returns (uint256);

    function deposits(address depositor) external view returns (uint256);
}

interface IPriceFeed {
    function fetchPrice() external view returns (uint256);
}

interface ISortedTroves {
    function getLast() external view returns (address);

    function getSize() external view returns (uint256);
}

interface ITroveManager {
    function getCurrentICR(address borrower, uint256 price) external view returns (uint256);

    function MCR() external view returns (uint256);

    function getTCR(uint256 price) external view returns (uint256);
}
