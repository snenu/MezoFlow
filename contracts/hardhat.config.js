require("@nomicfoundation/hardhat-toolbox");
const path = require("path");

// The deployer key lives in contracts/.env (gitignored) and is only read from there.
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const key = process.env.PRIVATE_KEY;
const accounts = key && /^0x[0-9a-fA-F]{64}$/.test(key) ? [key] : [];

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      // Mezo's documented EVM target. OpenZeppelin is pinned to 5.1.0 because 5.2+
      // emits the Cancun `mcopy` opcode, which Mezo does not support.
      evmVersion: "london",
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      // LOCAL_MEZO=1 makes `npx hardhat node` look like Mezo Testnet for local web dev.
      chainId: process.env.LOCAL_MEZO ? 31611 : 31337,
      hardfork: "london",
      chains: { 31611: { hardforkHistory: { london: 0 } } },
    },
    mezotestnet: {
      url: process.env.MEZO_RPC_URL || "https://rpc.test.mezo.org",
      chainId: 31611,
      accounts,
    },
  },
  // Source verification on Mezo's Blockscout explorer (Etherscan-compatible API).
  etherscan: {
    apiKey: { mezotestnet: "blockscout" },
    customChains: [
      {
        network: "mezotestnet",
        chainId: 31611,
        urls: {
          apiURL: "https://api.explorer.test.mezo.org/api",
          browserURL: "https://explorer.test.mezo.org",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  mocha: { timeout: 300000 },
};
