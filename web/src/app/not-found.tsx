import Link from "next/link";
import { Logo } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[720px] flex-col justify-center px-6 py-16">
      <Logo />
      <h1 className="display mt-12 text-[clamp(2.4rem,1.6rem+3vw,3.6rem)]">This page drifted off.</h1>
      <p className="lede mt-4">
        There&apos;s nothing at this address. Your MUSD is exactly where you left it; every balance lives on Mezo Testnet,
        not on this page.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/app" className="btn btn-primary btn-lg">
          Go to your overview
        </Link>
        <Link href="/" className="btn btn-ghost btn-lg">
          Back to the homepage
        </Link>
      </div>
    </main>
  );
}
