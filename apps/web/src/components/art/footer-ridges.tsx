import { ridgePath } from "@/lib/art";
import type { RidgeSpec } from "@/types/art/shapes";

const W = 1600;
const H = 600;

const LAYERS: readonly { spec: RidgeSpec; fill: string; opacity: number }[] = [
  {
    spec: {
      width: W,
      height: H,
      baseY: 300,
      waves: [
        [60, 700, 0.8],
        [22, 230, 2.2],
      ],
    },
    fill: "var(--fw-art-ridge-far)",
    opacity: 0.7,
  },
  {
    spec: {
      width: W,
      height: H,
      baseY: 380,
      waves: [
        [48, 560, 2.6],
        [16, 180, 0.6],
      ],
    },
    fill: "var(--fw-art-ridge-mid)",
    opacity: 0.75,
  },
  {
    spec: {
      width: W,
      height: H,
      baseY: 460,
      waves: [
        [36, 820, 1.4],
        [12, 260, 0.2],
      ],
    },
    fill: "var(--fw-art-ridge-near)",
    opacity: 0.85,
  },
];

// Grainy layered ridges behind the footer (the Ironclad-style reference), drawn in code.
export function FooterRidges({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id="footer-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.75"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
          <feComposite in2="SourceGraphic" operator="in" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.55" />
          </feComponentTransfer>
          <feBlend in2="SourceGraphic" mode="multiply" />
        </filter>
      </defs>
      <g className="fw-footer-grain">
        {LAYERS.map(({ spec, fill, opacity }) => (
          <path key={spec.baseY} d={ridgePath(spec)} fill={fill} opacity={opacity} />
        ))}
      </g>
    </svg>
  );
}
