/* eslint-disable no-console */
// Verifies every deployed MezoFlow contract on Mezo's Blockscout explorer.
//   npx hardhat run scripts/verify.js --network mezotestnet
const hre = require("hardhat");
const { readJson, writeJson, EXPLORER } = require("./lib");

async function main() {
  const dep = readJson("mezotestnet.json");
  if (!dep) throw new Error("deployments/mezotestnet.json not found");
  const results = {};
  for (const [name, address] of Object.entries(dep.contracts)) {
    try {
      await hre.run("verify:verify", { address, constructorArguments: dep.constructorArgs[name] || [] });
      results[name] = "verified";
    } catch (e) {
      const msg = String(e.message || e);
      results[name] = /already verified/i.test(msg) ? "verified" : `failed: ${msg.split("\n")[0]}`;
    }
    console.log(`${name.padEnd(22)} ${results[name]}  ${EXPLORER}/address/${address}?tab=contract`);
  }
  dep.verification = { checkedAt: new Date().toISOString(), results };
  writeJson("mezotestnet.json", dep);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
