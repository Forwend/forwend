import { ART } from "@/constants/art";
import { ridgePath } from "@/lib/art";
import type { RidgeSpec } from "@/types/art/shapes";

const W = 1600;
const H = 1000;
const C = ART.dusk;

const LAYERS: readonly { spec: RidgeSpec; fill: string }[] = [
  {
    spec: {
      width: W,
      height: H,
      baseY: 560,
      waves: [
        [50, 560, 1.4],
        [18, 170, 0.5],
        [6, 58, 2.2],
      ],
    },
    fill: C.ridgeFar,
  },
  {
    spec: {
      width: W,
      height: H,
      baseY: 630,
      waves: [
        [40, 470, 0.2],
        [15, 150, 1.8],
        [5, 44, 0.9],
      ],
    },
    fill: C.ridgeMid,
  },
  {
    spec: {
      width: W,
      height: H,
      baseY: 700,
      waves: [
        [30, 700, 2.6],
        [12, 210, 0.4],
      ],
    },
    fill: C.ridgeNear,
  },
];

export function DuskLandscape({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="dusk-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.skyTop} />
          <stop offset="0.38" stopColor={C.skyMid} />
          <stop offset="0.6" stopColor={C.horizon} />
        </linearGradient>
        <radialGradient id="dusk-sun" cx="0.68" cy="0.58" r="0.3">
          <stop offset="0" stopColor={C.sun} stopOpacity="0.9" />
          <stop offset="1" stopColor={C.sun} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="dusk-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.ground} stopOpacity="0" />
          <stop offset="1" stopColor={C.ground} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#dusk-sky)" />
      <rect width={W} height={H} fill="url(#dusk-sun)" />
      <circle cx="1090" cy="590" r="46" fill={C.sun} />
      {LAYERS.map(({ spec, fill }) => (
        <path key={spec.baseY} d={ridgePath(spec)} fill={fill} />
      ))}
      <rect y="640" width={W} height="360" fill="url(#dusk-ground)" />
    </svg>
  );
}
