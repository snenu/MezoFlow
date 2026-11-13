import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/providers";
import "./globals.css";

// One family; the width axis does the work (expanded for figures and headlines).
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://mezoflow.vercel.app"),
  title: {
    default: "MezoFlow: put your MUSD to work",
    template: "%s · MezoFlow",
  },
  description:
    "Save, allocate and track MUSD on Mezo. Savings vaults, Mezo's Stability Pool, one-transaction deposits with permits, BTC-to-MUSD swaps through Mezo Pools and a fully on-chain activity ledger.",
  applicationName: "MezoFlow",
  openGraph: {
    title: "MezoFlow",
    description: "Put your MUSD to work on Mezo. Every balance, rate and transaction is read from the chain.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
