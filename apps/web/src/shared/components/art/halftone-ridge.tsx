import { ART } from "@/shared/constants/art-colors";
import { halftoneDots } from "@/shared/lib/art-paths";
import type { HalftoneRidgeProps } from "@/shared/types/art";

const W = 1600;

const H = 1000;

const C = ART.halftone;

// The ridge rises left to right, so the dot field reads as a line moving forward.
const edge = (x: number) => 820 - x * 0.3 - 46 * Math.sin(x / 150) - 22 * Math.sin(x / 47 + 1.3);

// One path of two-arc circles instead of thousands of <circle> nodes: the same dots, far less DOM.
const DOTS = halftoneDots({ width: W, height: H, cell: 16, edge, ramp: 6 })
  .map(
    ({ cx, cy, r }) =>
      `M${(cx - r).toFixed(2)} ${cy}a${r} ${r} 0 1 0 ${(2 * r).toFixed(2)} 0a${r} ${r} 0 1 0 ${(-2 * r).toFixed(2)} 0`,
  )
  .join("");

export function HalftoneRidge({ className, soft = false }: HalftoneRidgeProps) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {soft ? null : <rect width={W} height={H} fill={C.ground} />}
      <path d={DOTS} fill={soft ? "var(--fw-art-dot)" : C.dot} />
    </svg>
  );
}
