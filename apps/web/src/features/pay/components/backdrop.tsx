import type { CSSProperties } from "react";
import { FooterRidges } from "@/features/pay/components/footer-ridges";

export interface BackdropProps {
  color?: string | null; // the store's accent; lime without one
}

export function Backdrop({ color }: BackdropProps) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-y-0 left-0 -z-10 hidden w-1/2 overflow-hidden bg-surface-2 lg:block dark:bg-surface"
      style={{ "--wash": color ?? "var(--fw-brand)" } as CSSProperties}
    >
      {/* An embed is only as tall as its content: there the ridges would cover the summary. */}
      <FooterRidges className="absolute inset-x-0 bottom-0 h-56 w-full opacity-70 in-[[data-embed]]:hidden" />
      <div className="absolute inset-0 bg-[radial-gradient(75%_40%_at_20%_100%,color-mix(in_oklab,var(--wash)_40%,transparent),transparent_75%)] dark:opacity-25" />
    </div>
  );
}
