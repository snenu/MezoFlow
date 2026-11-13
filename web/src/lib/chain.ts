import { defineChain } from "viem";

export const EXPLORER = "https://explorer.test.mezo.org";
export const RPC_URL = process.env.NEXT_PUBLIC_MEZO_RPC ?? "https://rpc.test.mezo.org";

export const mezoTestnet = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL], webSocket: ["wss://rpc-ws.test.mezo.org"] },
  },
  blockExplorers: {
    default: { name: "Mezo Explorer", url: EXPLORER },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (addr: string) => `${EXPLORER}/address/${addr}`;

/** Mezo's RPC caps eth_getLogs at 10,000 blocks per request. */
export const LOG_RANGE = 9_500n;
