import type { SVGProps } from "react";

/** Same props shape as Lucide icons, so custom and Lucide icons are interchangeable. */
export type CustomIconProps = SVGProps<SVGSVGElement> & { strokeWidth?: number };

// Forwend's own icons: 24px grid, round caps and joins, 1.75 stroke, like the Lucide set they sit beside.
function Base({ children, strokeWidth = 1.75, ...props }: CustomIconProps) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative unless the caller names it with aria-label
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={!props["aria-label"]}
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** A shopfront with an awning and a coin slot: taking payments at a store. */
export function MerchantIcon(props: CustomIconProps) {
  return (
    <Base {...props}>
      <path d="M3.5 9.5 5 4.5h14l1.5 5" />
      <path d="M3.5 9.5a2.83 2.83 0 0 0 5.67 0 2.83 2.83 0 0 0 5.66 0 2.83 2.83 0 0 0 5.67 0" />
      <path d="M5 12.5v7h14v-7" />
      <path d="M10 19.5v-4h4v4" />
    </Base>
  );
}

/** A laptop showing an invoice with a tick: independent work that gets billed and paid. */
export function FreelancerIcon(props: CustomIconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="4" width="16" height="11.5" rx="1.5" />
      <path d="M7.5 8h5M7.5 11h3" />
      <path d="m13.5 11 1.5 1.5 2.5-3" />
      <path d="M2.5 19.5h19" />
    </Base>
  );
}

/** A route from one stop to the next, ending in an arrow: a payment moving forward. */
export function PaymentPathIcon(props: CustomIconProps) {
  return (
    <Base {...props}>
      <circle cx="5" cy="18" r="2.5" />
      <circle cx="12" cy="7.5" r="2.5" />
      <path d="M6.5 16 10.5 9.6M13.8 9.4 20 16" />
      <path d="M20 11.5V16h-4.5" />
    </Base>
  );
}
