// A real EIP-1193 wallet for Playwright. The page gets a thin provider (announced via
// EIP-6963 as "MezoFlow E2E Wallet") whose requests are forwarded to Node through
// page.exposeFunction. Node signs with a testnet key and talks to the Mezo RPC, so the
// key never enters the browser and the https site never has to reach localhost.
import { createPublicClient, createWalletClient, defineChain, http, numberToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export function makeChain(rpc) {
  return defineChain({
    id: 31611,
    name: "Mezo Testnet",
    nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
}

export async function attachWallet(page, { key, rpc, log = () => {} }) {
  const chain = makeChain(rpc);
  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ chain, account, transport: http(rpc) });
  const sent = [];

  await page.exposeFunction("__e2eWallet", async (method, params) => {
    try {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address];
        case "eth_chainId":
          return numberToHex(31611);
        case "net_version":
          return "31611";
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
        case "wallet_watchAsset":
          return null;
        case "wallet_requestPermissions":
        case "wallet_getPermissions":
          return [{ parentCapability: "eth_accounts" }];
        case "personal_sign":
          return await account.signMessage({ message: { raw: params[0] } });
        case "eth_signTypedData_v4": {
          const data = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
          const { EIP712Domain, ...types } = data.types;
          void EIP712Domain;
          const sig = await account.signTypedData({ domain: data.domain, types, primaryType: data.primaryType, message: data.message });
          log(`signed ${data.primaryType} for ${data.domain?.name}`);
          return sig;
        }
        case "eth_sendTransaction": {
          const tx = params[0];
          const hash = await wallet.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : undefined,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
          });
          sent.push(hash);
          log(`sent ${hash}`);
          return hash;
        }
        default:
          return await pub.request({ method, params });
      }
    } catch (e) {
      return { __error: { code: e?.code ?? -32603, message: e?.shortMessage || e?.message || String(e), data: e?.data } };
    }
  });

  await page.addInitScript(
    ({ address }) => {
      const listeners = {};
      const provider = {
        isMetaMask: false,
        isMezoFlowE2E: true,
        selectedAddress: address,
        chainId: "0x7b7b",
        async request({ method, params }) {
          const r = await window.__e2eWallet(method, params ?? []);
          if (r && r.__error) {
            const err = new Error(r.__error.message);
            err.code = r.__error.code;
            err.data = r.__error.data;
            throw err;
          }
          return r;
        },
        on(ev, fn) {
          (listeners[ev] ||= []).push(fn);
          return provider;
        },
        removeListener(ev, fn) {
          listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
          return provider;
        },
      };
      window.ethereum = provider;
      const info = {
        uuid: "6b6f0c1e-mezoflow-e2e",
        name: "MezoFlow E2E Wallet",
        icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%231840F0'/%3E%3C/svg%3E",
        rdns: "org.mezoflow.e2e",
      };
      const announce = () =>
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { address: account.address },
  );

  return { account, pub, sent };
}
