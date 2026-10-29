import type { CSSProperties } from "react";
import { FooterRidges } from "@/shared/components/art/footer-ridges";

export interface BackdropProps {
  /** The store's accent color (R-135); Forwend's lime without one. */
  color?: string | null;
}

/** The checkout's left half from large screens: the landing footer's ridges along its foot under one soft wash of
 * color. The text sits on the plain top, so any color keeps its contrast. The summary's column ends at the page's
 * center, so the half lines up with it at any width. In the dark theme it takes the pay card's surface. */
export function Backdrop({ color }: BackdropProps) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-y-0 left-0 -z-10 hidden w-1/2 overflow-hidden bg-surface-2 lg:block dark:bg-surface"
      style={{ "--wash": color ?? "var(--fw-brand)" } as CSSProperties}
    >
      {/* Softer than on the landing: the footer's line sits on them and keeps its contrast. */}
      <FooterRidges className="absolute inset-x-0 bottom-0 h-56 w-full opacity-70" />
      <div className="absolute inset-0 bg-[radial-gradient(75%_40%_at_20%_100%,color-mix(in_oklab,var(--wash)_40%,transparent),transparent_75%)] dark:opacity-25" />
    </div>
  );
}
