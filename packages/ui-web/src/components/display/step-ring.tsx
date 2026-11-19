import type { CSSProperties } from "react";

/** A step in progress: its share done as the ring's fill, or a turning ring while no share is known. */
export function StepRing({ progress }: { progress?: number | null }) {
  const share = typeof progress === "number" ? Math.min(1, Math.max(0, progress)) : null;
  return (
    <span className="relative grid size-5 shrink-0 place-items-center rounded-pill bg-surface">
      {share === null ? (
        // Turning says "working on it", not "almost there"; reduced motion keeps a still quarter.
        <span className="absolute inset-0 rounded-pill border-2 border-line border-t-accent animate-[fw-spin_var(--fw-duration-slower)_linear_infinite] motion-reduce:animate-none" />
      ) : (
        <span
          className="absolute inset-0 rounded-pill [background:conic-gradient(var(--fw-accent)_calc(var(--fw-share)*1turn),var(--fw-line)_0)] [mask:radial-gradient(circle,transparent_calc(50%-2px),#000_calc(50%-2px))]"
          style={{ "--fw-share": share } as CSSProperties}
        />
      )}
      <span className="size-1.5 rounded-pill bg-accent" />
    </span>
  );
}
