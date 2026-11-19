const W = 1600;

const H = 1000;

const CELL = 16;

// Rows below the edge before dots reach full size.
const RAMP = 6;

const C = { ground: "#F1F4FA", dot: "#1F44D6" } as const;

const edge = (x: number) => 820 - x * 0.3 - 46 * Math.sin(x / 150) - 22 * Math.sin(x / 47 + 1.3);

// One path of two-arc circles instead of thousands of <circle> nodes: the same dots, far less DOM.
function dotsPath(): string {
  let d = "";
  for (let y = CELL / 2; y < H; y += CELL) {
    for (let x = CELL / 2; x < W; x += CELL) {
      const depth = (y - edge(x)) / (RAMP * CELL);
      if (depth <= 0) continue;
      const size = CELL * 0.46 * Math.min(1, Math.sqrt(depth));
      if (size <= 0.6) continue;
      const r = Number(size.toFixed(2));
      d += `M${(x - r).toFixed(2)} ${y}a${r} ${r} 0 1 0 ${(2 * r).toFixed(2)} 0a${r} ${r} 0 1 0 ${(-2 * r).toFixed(2)} 0`;
    }
  }
  return d;
}

const DOTS = dotsPath();

export function HalftoneRidge({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <rect width={W} height={H} fill={C.ground} />
      <path d={DOTS} fill={C.dot} />
    </svg>
  );
}
