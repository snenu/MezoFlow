"use client";

import { useEffect, useRef } from "react";

/**
 * A one-second stream of particles from the bottom of the parent into a point near the
 * top — played when a deposit or claim confirms. `trigger` is a counter; bump it to play.
 */
export function FlowBurst({ trigger, color = "#0EA5E9", reverse = false }: { trigger: number; color?: string; reverse?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!trigger) return;
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;
    const target = { x: w / 2, y: reverse ? h * 0.9 : h * 0.12 };
    const parts = Array.from({ length: 70 }, () => ({
      x: Math.random() * w,
      y: reverse ? h * 0.1 : h * (0.8 + Math.random() * 0.25),
      delay: Math.random() * 350,
      speed: 0.6 + Math.random() * 0.8,
      size: 1 + Math.random() * 1.6,
    }));
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const el = now - start;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      let alive = false;
      for (const p of parts) {
        const t = Math.min(Math.max((el - p.delay) / (900 / p.speed), 0), 1);
        if (t <= 0 || t >= 1) {
          if (t < 1) alive = true;
          continue;
        }
        alive = true;
        const e = 1 - Math.pow(1 - t, 3);
        const cx = p.x + (target.x - p.x) * e;
        const cy = p.y + (target.y - p.y) * e;
        const px = p.x + (target.x - p.x) * Math.max(e - 0.08, 0);
        const py = p.y + (target.y - p.y) * Math.max(e - 0.08, 0);
        const a = Math.sin(t * Math.PI) * 0.9;
        ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      if (alive) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [trigger, color, reverse]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
