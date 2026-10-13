import { ART } from "@/shared/constants/art-colors";
import { pinePath, ridgePath, ridgeY, seeded } from "@/shared/lib/art-paths";
import type { RidgeSpec } from "@/shared/types/art";

const W = 1600;

const H = 1000;

const C = ART.dawn;

const FAR: RidgeSpec = {
  width: W,
  height: H,
  baseY: 540,
  waves: [
    [46, 520, 0.7],
    [20, 190, 2.1],
    [7, 64, 0.3],
  ],
};

const MID: RidgeSpec = {
  width: W,
  height: H,
  baseY: 610,
  waves: [
    [34, 430, 2.4],
    [14, 150, 0.9],
    [5, 48, 1.7],
  ],
};

const HILLS: RidgeSpec = {
  width: W,
  height: H,
  baseY: 668,
  waves: [
    [22, 610, 1.2],
    [9, 210, 0.2],
  ],
};

const MEADOW: RidgeSpec = {
  width: W,
  height: H,
  baseY: 712,
  waves: [
    [16, 800, 2.8],
    [6, 260, 1.1],
  ],
  step: 20,
};

const RIVER =
  "M792 676 C770 700 724 712 742 742 C762 778 640 812 610 870 C590 910 548 960 520 1000 L1110 1000 C1040 940 980 900 930 846 C888 800 846 772 872 738 C890 712 846 694 812 676 Z";

function pines(
  seed: number,
  from: number,
  to: number,
  count: number,
  ground: number,
  scale: number,
) {
  const rand = seeded(seed);
  return Array.from({ length: count }, () => {
    const x = from + rand() * (to - from);
    const h = (150 + rand() * 210) * scale;
    return pinePath(Math.round(x), ground + rand() * 70 * scale, Math.round(h));
  }).join(" ");
}

export interface DawnLandscapeProps {
  className?: string;
}

export function DawnLandscape({ className }: DawnLandscapeProps) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="dawn-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.skyTop} />
          <stop offset="0.45" stopColor={C.skyMid} />
          <stop offset="0.62" stopColor={C.horizon} />
        </linearGradient>
        <radialGradient id="dawn-glow" cx="0.5" cy="0.6" r="0.35">
          <stop offset="0" stopColor={C.glow} stopOpacity="0.95" />
          <stop offset="1" stopColor={C.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="dawn-river" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.riverLight} />
          <stop offset="1" stopColor={C.riverDeep} />
        </linearGradient>
        <linearGradient id="dawn-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.haze} stopOpacity="0" />
          <stop offset="0.5" stopColor={C.haze} stopOpacity="0.55" />
          <stop offset="1" stopColor={C.haze} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="dawn-meadow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.meadowLight} />
          <stop offset="1" stopColor={C.meadow} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#dawn-sky)" />
      <rect width={W} height={H} fill="url(#dawn-glow)" />
      <path d={ridgePath(FAR)} fill={C.far} opacity="0.75" />
      <rect y="470" width={W} height="220" fill="url(#dawn-haze)" />
      <path d={ridgePath(MID)} fill={C.mid} opacity="0.85" />
      <path d={ridgePath(HILLS)} fill={C.hillFar} />
      <path d={pines(7, 0, 520, 20, ridgeY(280, HILLS) - 10, 0.42)} fill={C.pineFar} />
      <path d={pines(11, 1080, W, 20, ridgeY(1320, HILLS) - 10, 0.42)} fill={C.pineFar} />
      <path d={ridgePath(MEADOW)} fill="url(#dawn-meadow)" />
      <path d={RIVER} fill="url(#dawn-river)" />
      <path d={pines(23, -60, 380, 9, 820, 0.78)} fill={C.pine} />
      <path d={pines(31, 1560, W + 100, 4, 820, 0.78)} fill={C.pine} />
    </svg>
  );
}
