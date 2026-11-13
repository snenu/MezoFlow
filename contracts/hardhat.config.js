require("@nomicfoundation/hardhat-toolbox");
const fs = require("fs");

// The deployer key is read from outside the repo and never copied into it.
function loadKey() {
  if (process.env.PRIVATE_KEY) return process.env.PRIVATE_KEY;
  const p = "C:/Users/nikku/Desktop/.env.txt";
  if (!fs.existsSync(p)) return undefined;
  const m = fs.readFileSync(p, "utf8").match(/PRIVATE_KEY\s*=\s*"?(0x)?([0-9a-fA-F]{64})"?/);
  return m ? "0x" + m[2] : undefined;
}
const key = loadKey();

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "london",
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      hardfork: "london",
      chains: { 31611: { hardforkHistory: { london: 0 } } },
    },
    mezotestnet: {
      url: "https://rpc.test.mezo.org",
      chainId: 31611,
      accounts: key ? [key] : [],
    },
    mezofork: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      accounts: key ? [key] : [],
    },
  },
  mocha: { timeout: 300000 },
};
