"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { ToastProvider } from "./toast";
import { WalletModalProvider } from "./wallet";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 8_000, refetchOnWindowFocus: true, retry: 2 },
        },
      }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <WalletModalProvider>{children}</WalletModalProvider>
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
