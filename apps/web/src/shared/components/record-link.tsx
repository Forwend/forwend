import Link from "next/link";
import type { ReactNode } from "react";

export interface RecordLinkProps {
  href: string;
  children: ReactNode;
}

/** A link from one record to a related one (a payment's invoice, store or link): one look everywhere. */
export function RecordLink({ href, children }: RecordLinkProps) {
  return (
    <Link
      href={href}
      className="relative z-10 text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
    >
      {children}
    </Link>
  );
}
