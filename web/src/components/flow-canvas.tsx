"use client";

import { useEffect, useRef } from "react";

export type Channel = {
  /** Share of flow, 0..1 — drives particle density and channel width. */
  weight: number;
  /** Vertical end position as a fraction of canvas height. */
  endY: number;
  /** "btc" channels also send deep-blue BTC particles back; "muted" is money left idle. */
  tone?: "musd" | "btc" | "muted";
};

type Particle = {
  ch: number;
  t: number;
  speed: number;
  off: number;
  size: number;
  alpha: number;
  btc: boolean;
};

const SKY = [14, 165, 233];
const DEEP = [30, 64, 175];
const MUTED = [125, 160, 190];

function bez(p0: number, p1: number, p2: number, p3: number, t: number) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}
function bezD(p0: number, p1: number, p2: number, p3: number, t: number) {
  const u = 1 - t;
  return 3 * u * u * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

/**
 * MUSD leaves one source (your wallet) and splits into one channel per destination.
 * Channels ease to new positions and widths when the split changes, so changing the plan
 * visibly re-routes the money. BTC particles flow back along BTC-earning channels.
 * The pointer gently pushes particles aside.
 */
export function FlowCanvas({
  channels,
  sourceY = 0.62,
  sourceX = 0.05,
  endX = 0.83,
  className,
}: {
  channels: Channel[];
  sourceY?: number;
  sourceX?: number;
  endX?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef(channels);
  // With reduced motion the canvas only paints on demand, so a new split asks for a redraw.
  const redrawRef = useRef<() => void>(() => {});
  useEffect(() => {
    targetRef.current = channels;
    redrawRef.current();
  }, [channels]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let visible = true;
    let particles: Particle[] = [];
    // Eased, drawn state of every channel.
    let live: { endY: number; weight: number; tone: Channel["tone"] }[] = [];
    const pointer = { x: -9999, y: -9999, active: false };
    const start = performance.now();

    const syncLive = (ease: number) => {
      const target = targetRef.current;
      if (live.length !== target.length) {
        live = target.map((c, i) => live[i] ?? { endY: sourceY, weight: 0, tone: c.tone });
        particles = particles.filter((p) => p.ch < target.length);
      }
      for (let i = 0; i < target.length; i++) {
        live[i].endY += (target[i].endY - live[i].endY) * ease;
        live[i].weight += (target[i].weight - live[i].weight) * ease;
        live[i].tone = target[i].tone;
      }
    };

    const geometry = (ch: number) => {
      const c = live[ch];
      const sx = w * sourceX;
      const sy = h * sourceY;
      const ex = w * endX;
      const ey = h * (c?.endY ?? sourceY);
      const split = w * 0.42;
      return { x0: sx, y0: sy, x1: split, y1: sy, x2: split + (ex - split) * 0.25, y2: ey, x3: ex, y3: ey };
    };

    const point = (p: Particle) => {
      const g = geometry(p.ch);
      const x = bez(g.x0, g.x1, g.x2, g.x3, p.t);
      const y = bez(g.y0, g.y1, g.y2, g.y3, p.t);
      const dx = bezD(g.x0, g.x1, g.x2, g.x3, p.t);
      const dy = bezD(g.y0, g.y1, g.y2, g.y3, p.t);
      const len = Math.hypot(dx, dy) || 1;
      const weight = Math.max(live[p.ch]?.weight ?? 0.3, 0.06);
      const spread = (5 + Math.min(p.t * 2.2, 1) * (10 + weight * 60)) * (h / 560);
      return { x: x + (-dy / len) * p.off * spread, y: y + (dx / len) * p.off * spread, dx: dx / len, dy: dy / len };
    };

    const spawn = (initial: boolean): Particle => {
      const cs = targetRef.current;
      const total = cs.reduce((s, c) => s + Math.max(c.weight, 0.04), 0) || 1;
      let r = Math.random() * total;
      let ch = 0;
      for (let i = 0; i < cs.length; i++) {
        r -= Math.max(cs[i].weight, 0.04);
        if (r <= 0) {
          ch = i;
          break;
        }
      }
      const btc = cs[ch]?.tone === "btc" && Math.random() < 0.28;
      return {
        ch,
        t: btc ? 0.98 - Math.random() * (initial ? 0.4 : 0.02) : initial ? Math.random() : Math.random() * 0.02,
        speed: (btc ? -1 : 1) * (0.0009 + Math.random() * 0.0016),
        off: (Math.random() * 2 - 1) * (0.35 + Math.random() * 0.65),
        size: btc ? 1.4 + Math.random() * 1.4 : 0.8 + Math.random() * 1.5,
        alpha: 0.35 + Math.random() * 0.6,
        btc,
      };
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      syncLive(1);
      const target = Math.round(Math.min(480, Math.max(150, (w * h) / 2000)));
      particles = Array.from({ length: target }, () => spawn(true));
    };

    const toneRgb = (tone: Channel["tone"]) => (tone === "muted" ? MUTED : tone === "btc" ? DEEP : SKY);

    const drawGuides = () => {
      ctx.lineCap = "round";
      for (let i = 0; i < live.length; i++) {
        const g = geometry(i);
        const rgb = live[i].tone === "muted" ? MUTED : SKY;
        for (const [lw, a] of [
          [6 + live[i].weight * 22, 0.07],
          [1.2, 0.3],
        ] as const) {
          ctx.beginPath();
          ctx.moveTo(g.x0, g.y0);
          ctx.bezierCurveTo(g.x1, g.y1, g.x2, g.y2, g.x3, g.y3);
          ctx.strokeStyle = `rgba(${rgb.join(",")},${a})`;
          ctx.lineWidth = lw;
          ctx.stroke();
        }
        const node = toneRgb(live[i].tone);
        ctx.beginPath();
        ctx.arc(g.x3, g.y3, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${node.join(",")},0.95)`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(g.x3, g.y3, 9, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${node.join(",")},0.25)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      const sx = w * sourceX;
      const sy = h * sourceY;
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 38);
      glow.addColorStop(0, "rgba(14,165,233,0.35)");
      glow.addColorStop(1, "rgba(14,165,233,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(sx - 40, sy - 40, 80, 80);
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#0B2540";
      ctx.fill();
    };

    const frame = (now: number) => {
      syncLive(reduce ? 1 : 0.07);
      ctx.clearRect(0, 0, w, h);
      drawGuides();
      const intro = reduce ? 1 : Math.min((now - start) / 1600, 1);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (p.ch >= live.length) {
          particles[i] = spawn(false);
          continue;
        }
        if (!reduce) {
          p.t += p.speed * (0.6 + p.t * 0.7);
          if (p.t > 1 || p.t < (p.btc ? 0.42 : 0)) {
            particles[i] = spawn(false);
            continue;
          }
        }
        if (!p.btc && p.t > intro * 1.05) continue;
        if (p.btc && intro < 1) continue;
        const pos = point(p);
        let { x, y } = pos;
        if (pointer.active) {
          const ddx = x - pointer.x;
          const ddy = y - pointer.y;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < 9000) {
            const f = (1 - d2 / 9000) * 18;
            const d = Math.sqrt(d2) || 1;
            x += (ddx / d) * f;
            y += (ddy / d) * f;
          }
        }
        const fadeEdge = Math.min(1, p.t * 10, (1 - p.t) * 8);
        const col = p.btc ? DEEP : toneRgb(live[p.ch].tone === "btc" ? "musd" : live[p.ch].tone);
        const streak = (p.btc ? 7 : 10) * Math.abs(p.speed) * 900;
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${p.alpha * fadeEdge})`;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        const dir = p.btc ? 1 : -1;
        ctx.moveTo(x + pos.dx * streak * dir, y + pos.dy * streak * dir);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      if (!reduce && visible) raf = requestAnimationFrame(frame);
    };

    redrawRef.current = reduce ? () => frame(performance.now()) : () => {};
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) frame(performance.now());
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting && document.visibilityState === "visible";
      if (visible && !was && !reduce) raf = requestAnimationFrame(frame);
      if (!visible) cancelAnimationFrame(raf);
    });
    io.observe(canvas);

    const onVis = () => {
      const was = visible;
      visible = document.visibilityState === "visible";
      if (visible && !was && !reduce) raf = requestAnimationFrame(frame);
      if (!visible) cancelAnimationFrame(raf);
    };
    document.addEventListener("visibilitychange", onVis);

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.active = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= r.width && pointer.y <= r.height;
    };
    const onLeave = () => (pointer.active = false);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, [sourceX, sourceY, endX]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
