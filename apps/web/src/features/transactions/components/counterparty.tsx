import { shortAddress } from "@forwend/ui-web";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import type { Transaction } from "@/features/transactions/types/transactions";
import { addressLink } from "@/shared/lib/chains";

/** The other side's address, short, linking its explorer page where the chain has one. */
export function Counterparty({ t }: { t: Transaction }) {
  const link = addressLink(t.chainId, t.counterparty);
  const short = shortAddress(t.counterparty);
  return link ? (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      title={t.counterparty}
      aria-label={TRANSACTIONS_COPY.counterpartyLink(short, link.name)}
      className="rounded-sm font-mono font-normal text-muted underline-offset-2 outline-none hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus"
    >
      {short}
    </a>
  ) : (
    <span className="font-mono font-normal text-muted" title={t.counterparty}>
      {short}
    </span>
  );
}
