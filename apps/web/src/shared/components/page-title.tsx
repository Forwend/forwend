import { cx } from "@forwend/ui-web";
import type { ReactNode } from "react";

export interface PageTitleProps {
  id?: string;
  className?: string;
  children: ReactNode;
}

/** An app page's heading; from large screens the breadcrumb names the page, so it is read, not shown. */
export function PageTitle({ id, className, children }: PageTitleProps) {
  return (
    <h1
      id={id}
      className={cx("text-2xl font-semibold tracking-tight text-ink lg:sr-only", className)}
    >
      {children}
    </h1>
  );
}
