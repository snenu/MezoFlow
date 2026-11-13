import { ImageResponse } from "next/og";

export const alt = "MezoFlow: put your MUSD to work on Mezo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social card: black headline on white, the blue rate board on the right. */
export default async function Image() {
  const rows = [
    { name: "Flexible Savings", pct: 50 },
    { name: "Stability Pool", pct: 30 },
    { name: "Your wallet", pct: 20 },
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#ffffff", color: "#000000", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 64px", width: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg width="52" height="52" viewBox="0 0 32 32">
              <rect width="32" height="32" rx="6" fill="#1840F0" />
              <rect x="7" y="8.5" width="18" height="3.4" rx="1" fill="#FFFFFF" />
              <rect x="7" y="14.3" width="12" height="3.4" rx="1" fill="#FFFFFF" />
              <rect x="7" y="20.1" width="6" height="3.4" rx="1" fill="#FFFFFF" />
            </svg>
            <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: -1 }}>MezoFlow</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -3, lineHeight: 1 }}>Put your MUSD to work.</div>
            <div style={{ fontSize: 28, color: "#595959", lineHeight: 1.35 }}>
              Savings vaults, Mezo&apos;s Stability Pool and BTC-to-MUSD swaps, one transaction each.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 34, flex: 1, background: "#1840F0", color: "#ffffff", padding: "0 64px" }}>
          {rows.map((r) => (
            <div key={r.name} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28 }}>
                <span>{r.name}</span>
                <span style={{ fontWeight: 700 }}>{r.pct}%</span>
              </div>
              <div style={{ display: "flex", height: 14, background: "#4a69f3", borderRadius: 4 }}>
                <div style={{ width: `${r.pct}%`, background: "#ffffff", borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
