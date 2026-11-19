import { cx } from "@forwend/ui-web";
import type { ReactNode } from "react";

export interface PageTitleProps {
  className?: string;
  children: ReactNode;
}

/** An app page's heading; from large screens the breadcrumb names the page, so it is read, not shown. */
export function PageTitle({ className, children }: PageTitleProps) {
  return (
    <h1 className={cx("text-2xl font-semibold tracking-tight text-ink lg:sr-only", className)}>
      {children}
    </h1>
  );
}
