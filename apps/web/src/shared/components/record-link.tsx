import { cx } from "@forwend/ui-web";
import Link from "next/link";
import type { ReactNode } from "react";

export interface RecordLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
}

/** A link from one record to a related one (a payment's invoice, store or link): one look everywhere. */
export function RecordLink({ href, children, className }: RecordLinkProps) {
  return (
    <Link
      href={href}
      className={cx(
        "relative z-10 text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink",
        className,
      )}
    >
      {children}
    </Link>
  );
}
