import { cx } from "../lib/cx";
import { BRAND_ICONS } from "./brand-data";

export type BrandIconName = keyof typeof BRAND_ICONS;

export interface BrandIconProps {
  name: BrandIconName;
  className?: string;
  /** Accessible name; omit when a visible label sits next to the icon. */
  label?: string;
}

export function BrandIcon({ name, className, label }: BrandIconProps) {
  const icon = BRAND_ICONS[name];
  return (
    <svg
      viewBox={icon.viewBox}
      fill={icon.fill}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cx("shrink-0", className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: fixed MIT brand markup from brand-data.ts, never user input
      dangerouslySetInnerHTML={{ __html: icon.markup }}
    />
  );
}
