import { encode } from "uqr";
import { cx } from "../../lib/cx";

export interface QrCodeProps {
  value: string;
  /** Accessible description of what the code holds. */
  label: string;
  className?: string;
}

export function QrCode({ value, label, className }: QrCodeProps) {
  const { data, size } = encode(value, { border: 4 });
  return (
    // Always dark modules on a light ground: scanners often fail on inverted codes.
    <svg
      data-theme="light"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cx("aspect-square rounded-md bg-surface", className)}
    >
      <path
        fill="var(--fw-ink)"
        d={data.flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : ""))).join("")}
      />
    </svg>
  );
}
