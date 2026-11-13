import Link from "next/link";

/** Three currents leaving one source — the MezoFlow mark. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#0377B8" />
      <path d="M6 16C12 16 13 9 26 9" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M6 16H26" stroke="#BAE6FD" strokeWidth="2.4" strokeLinecap="round" opacity="0.7" />
      <path d="M6 16C12 16 13 23 26 23" stroke="#7DD3FC" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="6" cy="16" r="2.6" fill="#FFFFFF" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 font-bold tracking-tight text-[1.075rem]">
      <Mark />
      <span>MezoFlow</span>
    </Link>
  );
}
