import { ImageResponse } from "next/og";

export const alt = "MezoFlow: make your MUSD work smarter on Mezo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social card: the three currents from the logo, drawn large, with the tagline. */
export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(180deg, #e6f4fd 0%, #ffffff 100%)",
          color: "#0b2540",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="9" fill="#0377B8" />
            <path d="M6 16C12 16 13 9 26 9" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" fill="none" />
            <path d="M6 16H26" stroke="#BAE6FD" strokeWidth="2.4" strokeLinecap="round" fill="none" />
            <path d="M6 16C12 16 13 23 26 23" stroke="#7DD3FC" strokeWidth="2.4" strokeLinecap="round" fill="none" />
            <circle cx="6" cy="16" r="2.6" fill="#FFFFFF" />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>MezoFlow</div>
        </div>
        <svg width="1040" height="220" viewBox="0 0 1040 220" style={{ position: "absolute", right: 0, top: 170 }}>
          <path d="M40 150 C 420 150, 460 40, 1000 40" stroke="#0EA5E9" strokeWidth="6" fill="none" opacity="0.75" />
          <path d="M40 150 C 420 150, 460 120, 1000 120" stroke="#0EA5E9" strokeWidth="6" fill="none" opacity="0.45" />
          <path d="M40 150 C 420 150, 460 200, 1000 200" stroke="#1E40AF" strokeWidth="6" fill="none" opacity="0.6" />
          <circle cx="40" cy="150" r="12" fill="#0B2540" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 78, fontWeight: 800, letterSpacing: -3, lineHeight: 1 }}>Make your MUSD work smarter.</div>
          <div style={{ fontSize: 30, color: "#33506b" }}>
            Savings vaults, Mezo&apos;s Stability Pool and a one-tap allocator, live on Mezo Testnet.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
