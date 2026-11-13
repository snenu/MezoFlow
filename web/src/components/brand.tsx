import Link from "next/link";

/** The MezoFlow mark: one balance split three ways, like the rate board. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="6" fill="#1840F0" />
      <rect x="7" y="8.5" width="18" height="3.4" rx="1" fill="#FFFFFF" />
      <rect x="7" y="14.3" width="12" height="3.4" rx="1" fill="#FFFFFF" />
      <rect x="7" y="20.1" width="6" height="3.4" rx="1" fill="#FFFFFF" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="semi-wide inline-flex items-center gap-2.5 text-[1.075rem] font-bold tracking-tight">
      <Mark />
      <span>MezoFlow</span>
    </Link>
  );
}
