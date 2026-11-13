/* eslint-disable no-console */
// Shared helpers for deploy / verify / seed scripts on Mezo Testnet.
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const DEPLOY_DIR = path.join(ROOT, "deployments");
const EXPLORER = "https://explorer.test.mezo.org";

// Official Mezo testnet addresses (mezo.org/docs + @mezo-org/musd-contracts matsnet).
const MEZO = {
  MUSD: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  BTC: "0x7b7C000000000000000000000000000000000000", // ERC-20 precompile, EIP-2612 ("BTC", "1")
  MEZO: "0x7B7c000000000000000000000000000000000001", // ERC-20 precompile, EIP-2612 ("MEZO", "1")
  StabilityPool: "0x1CCA7E410eE41739792eA0A24e00349Dd247680e",
  PriceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  SortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
  TroveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  BorrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  PoolsRouter: "0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9",
  PoolFactory: "0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A",
  MusdBtcPool: "0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9",
};

// The precompiles do not implement EIP-5267 eip712Domain(); these domains were derived by
// matching their on-chain DOMAIN_SEPARATOR().
const PERMIT_DOMAINS = {
  [MEZO.MUSD.toLowerCase()]: { name: "Mezo USD", version: "1" },
  [MEZO.BTC.toLowerCase()]: { name: "BTC", version: "1" },
  [MEZO.MEZO.toLowerCase()]: { name: "MEZO", version: "1" },
};

const E = (n) => ethers.parseEther(String(n));
const fmt = (v, d = 4) => Number(ethers.formatEther(v)).toFixed(d);

function readJson(file, fallback) {
  const p = path.join(DEPLOY_DIR, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;
}

function writeJson(file, data) {
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  fs.writeFileSync(path.join(DEPLOY_DIR, file), JSON.stringify(data, null, 2) + "\n");
}

/// Transaction logger: every write gets an explicit gas limit (Mezo's eth_estimateGas
/// under-estimates nested calls) and its hash is kept for deployments/*.json.
function makeLogger(logFile) {
  const log = readJson(logFile, { network: "mezotestnet", chainId: 31611, txs: [] });
  const save = () => writeJson(logFile, log);

  async function gasFor(estimate, floor) {
    let est = 0n;
    try {
      est = await estimate();
    } catch (e) {
      throw new Error(`gas estimate failed: ${e.shortMessage || e.message}`);
    }
    let g = (est * 3n) / 2n;
    if (g < BigInt(floor)) g = BigInt(floor);
    if (g > 9_500_000n) g = 9_500_000n; // Mezo block gas limit is 10M
    return g;
  }

  /// send("label", contract, "method", [args], { floor, value, from })
  async function send(label, contract, method, args = [], opts = {}) {
    const c = opts.from ? contract.connect(opts.from) : contract;
    const overrides = opts.value ? { value: opts.value } : {};
    const gasLimit = await gasFor(() => c[method].estimateGas(...args, overrides), opts.floor || 250_000);
    const tx = await c[method](...args, { ...overrides, gasLimit });
    const rc = await tx.wait();
    if (rc.status !== 1) throw new Error(`${label} reverted: ${rc.hash}`);
    const entry = { label, hash: rc.hash, block: rc.blockNumber, from: rc.from, to: rc.to, gasUsed: rc.gasUsed.toString() };
    log.txs.push(entry);
    save();
    console.log(`  ✓ ${label.padEnd(52)} ${EXPLORER}/tx/${rc.hash}`);
    return rc;
  }

  async function sendValue(label, signer, to, value) {
    const tx = await signer.sendTransaction({ to, value, gasLimit: 60_000 });
    const rc = await tx.wait();
    log.txs.push({ label, hash: rc.hash, block: rc.blockNumber, from: rc.from, to, value: value.toString() });
    save();
    console.log(`  ✓ ${label.padEnd(52)} ${EXPLORER}/tx/${rc.hash}`);
    return rc;
  }

  async function deploy(name, args, signer) {
    const f = await ethers.getContractFactory(name, signer);
    const dtx = await f.getDeployTransaction(...args);
    const est = await ethers.provider.estimateGas({ ...dtx, from: await signer.getAddress() });
    let gasLimit = (est * 3n) / 2n;
    if (gasLimit > 9_500_000n) gasLimit = 9_500_000n;
    const c = await f.deploy(...args, { gasLimit });
    const rc = await c.deploymentTransaction().wait();
    const address = await c.getAddress();
    log.txs.push({ label: `deploy ${name}`, hash: rc.hash, block: rc.blockNumber, from: rc.from, contract: address, gasUsed: rc.gasUsed.toString() });
    save();
    console.log(`  ✓ deploy ${name.padEnd(45)} ${address}`);
    return { contract: c, address, hash: rc.hash, block: rc.blockNumber };
  }

  return { log, save, send, sendValue, deploy };
}

/// EIP-2612 permit for MUSD, the BTC/MEZO precompiles or a MezoFlow vault share token.
async function signPermit(signer, tokenAddress, spender, value, deadline) {
  const token = new ethers.Contract(
    tokenAddress,
    ["function nonces(address) view returns (uint256)", "function name() view returns (string)"],
    ethers.provider
  );
  const { chainId } = await ethers.provider.getNetwork();
  const owner = await signer.getAddress();
  const known = PERMIT_DOMAINS[tokenAddress.toLowerCase()];
  const domain = known
    ? { ...known, chainId, verifyingContract: tokenAddress }
    : { name: await token.name(), version: "1", chainId, verifyingContract: tokenAddress };
  deadline = deadline ?? BigInt(Math.floor(Date.now() / 1000) + 1800);
  const nonce = await token.nonces(owner);
  const sig = await signer.signTypedData(
    domain,
    {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    { owner, spender, value, nonce, deadline }
  );
  const { v, r, s } = ethers.Signature.from(sig);
  return { deadline, v, r, s };
}

const btcRoute = (from = MEZO.BTC) => [{ from, to: MEZO.MUSD, stable: false, factory: MEZO.PoolFactory }];

module.exports = { MEZO, PERMIT_DOMAINS, E, fmt, readJson, writeJson, makeLogger, signPermit, btcRoute, EXPLORER, DEPLOY_DIR, ROOT };
