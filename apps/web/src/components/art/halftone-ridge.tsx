import { ART } from "@/constants/art";
import { halftoneDots } from "@/lib/art";
import type { HalftoneRidgeProps } from "@/types/art/shapes";

const W = 1600;
const H = 1000;
const C = ART.halftone;

// The ridge rises left to right, so the dot field reads as a line moving forward.
const edge = (x: number) => 820 - x * 0.3 - 46 * Math.sin(x / 150) - 22 * Math.sin(x / 47 + 1.3);

const DOTS = halftoneDots({ width: W, height: H, cell: 16, edge, ramp: 6 });

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
      <g fill={soft ? "var(--fw-art-dot)" : C.dot}>
        {DOTS.map((d) => (
          <circle key={`${d.cx}-${d.cy}`} cx={d.cx} cy={d.cy} r={d.r} />
        ))}
      </g>
    </svg>
  );
}
