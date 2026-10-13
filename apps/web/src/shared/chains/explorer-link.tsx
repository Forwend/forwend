import { ExternalLink } from "lucide-react";
import { txLink } from "@/shared/chains/chains";

/**
 * The transaction on its chain's block explorer, in a new tab; nothing for a chain without one. An icon alone, or with
 * the explorer's name beside it when `named`.
 */
export function ExplorerLink({
  chainId,
  txHash,
  named = false,
  className = "",
}: {
  chainId: number;
  txHash: string;
  named?: boolean;
  className?: string;
}) {
  const link = txLink(chainId, txHash);
  if (!link) return null;
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View transaction on ${link.name}`}
      title={txHash}
      // The pseudo-element widens the hit area past the icon without changing the link's size or spacing.
      className={`relative inline-flex shrink-0 items-center gap-1 rounded-sm p-1 text-sm after:absolute after:-inset-1.5 text-muted outline-none hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus ${className}`}
    >
      {named ? link.name : null}
      <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
    </a>
  );
}
