import { cx, Logo } from "@forwend/ui-web";
import Link from "next/link";
import type { ComponentProps } from "react";
import { APP_ROUTES } from "@/shared/config/routes";
import styles from "./site-bar.module.css";

/** `plain` drops the glass and keeps the geometry, so a page with only the logo puts it where the landing does. */
export function SiteBar({
  plain,
  className,
  ...props
}: ComponentProps<"header"> & { plain?: boolean }) {
  return <header className={cx(styles.bar, plain && styles.plain, className)} {...props} />;
}

export function SiteBarRow({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx(styles.row, className)} {...props} />;
}

export function SiteBrand({ label }: { label: string }) {
  return (
    <Link prefetch={false} href={APP_ROUTES.site} aria-label={label} className={styles.brand}>
      <Logo />
    </Link>
  );
}
