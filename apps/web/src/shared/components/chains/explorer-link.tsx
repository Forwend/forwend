import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { txLink } from "@/shared/lib/chains";

export type ExplorerLinkProps = {
  txHash: string;
  named?: boolean;
  /** Shown before the icon, such as the short hash. */
  children?: ReactNode;
  className?: string;
} & (
  | { chainId: number }
  /** A link made elsewhere, as for a chain 1Click names (R-243). */
  | { link: { name: string; href: string } | null }
);

/** The transaction on its chain's explorer, in a new tab; nothing for a chain without one. */
export function ExplorerLink({
  txHash,
  named = false,
  children,
  className = "",
  ...where
}: ExplorerLinkProps) {
  const link = "link" in where ? where.link : txLink(where.chainId, txHash);
  if (!link) return null;
  const label = `View transaction on ${link.name}`;
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      // With visible text the name has to hold it, so the label follows that text instead of replacing it.
      aria-label={children ? undefined : label}
      title={txHash}
      // The pseudo-element widens the hit area past the icon without changing the link's size or spacing.
      className={`relative inline-flex shrink-0 items-center gap-1 rounded-sm p-1 text-sm after:absolute after:-inset-1.5 text-muted outline-none hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus ${className}`}
    >
      {named ? link.name : null}
      {children}
      {children ? <span className="sr-only">{label}</span> : null}
      <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
    </a>
  );
}
