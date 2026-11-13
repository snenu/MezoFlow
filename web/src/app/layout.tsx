import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://mezoflow.vercel.app"),
  title: {
    default: "MezoFlow — make your MUSD work smarter",
    template: "%s · MezoFlow",
  },
  description:
    "Save, allocate and track MUSD on Mezo. Flexible and term savings vaults, Mezo's Stability Pool, an auto allocator and a fully on-chain activity ledger.",
  applicationName: "MezoFlow",
  openGraph: {
    title: "MezoFlow",
    description: "Make your MUSD work smarter on Mezo. Every balance, fee and transaction is read from the chain.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${schibsted.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
