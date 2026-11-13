import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { mezoTestnet, RPC_URL } from "./chain";

export const wagmiConfig = createConfig({
  chains: [mezoTestnet],
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  transports: {
    [mezoTestnet.id]: http(RPC_URL, { batch: { wait: 16 }, retryCount: 3, timeout: 6_000 }),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
