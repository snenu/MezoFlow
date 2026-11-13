import type { SVGProps } from "react";

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const IconOverview = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 12h4l3-7 4 14 3-7h4" />
  </svg>
);
export const IconStrategies = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 7c6 0 6-3 16-3M4 12h16M4 17c6 0 6 3 16 3" />
  </svg>
);
export const IconAllocate = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4v8l6 5" />
  </svg>
);
export const IconRisk = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
);
export const IconActivity = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
);
export const IconBell = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16zM10 21h4" />
  </svg>
);
export const IconChat = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 5h16v11H9l-5 4V5z" />
    <path d="M8 10h8M8 13h5" />
  </svg>
);
export const IconDrop = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z" />
  </svg>
);
export const IconMenu = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
export const IconExternal = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width={14} height={14} {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
  </svg>
);
export const IconSwap = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
  </svg>
);
