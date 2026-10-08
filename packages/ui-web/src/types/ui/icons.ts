import type { SVGProps } from "react";
import type { BRAND_ICONS } from "../../icons/brand-data";

export type BrandIconName = keyof typeof BRAND_ICONS;

export interface BrandIconProps {
  name: BrandIconName;
  className?: string;
  /** Accessible name; omit when a visible label sits next to the icon. */
  label?: string;
}

/** Same props shape as Lucide icons, so custom and Lucide icons are interchangeable. */
export type CustomIconProps = SVGProps<SVGSVGElement> & { strokeWidth?: number };

export interface LogoMarkProps {
  className?: string;
  /** Accessible name when the mark stands alone; omit next to a visible wordmark. */
  label?: string;
}

export interface LogoProps {
  className?: string;
}
