import { shortAddress, TIMELINE_STATES, type TimelineEntry } from "@forwend/ui-web";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { INVOICE_STEPS, INVOICE_TIMELINE } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import { confirmingProgress, invoiceProgress } from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import { ENTER } from "@/features/pay/constants/pay";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { useFinalTime } from "@/features/pay/hooks/use-final-time";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { txLink } from "@/shared/lib/chains";

/** R-68: the answer to "do I need to do anything?", before the steps. */
export function NothingMore() {
  return (
    <div className="flex items-start gap-3 rounded-md bg-surface-2 px-3.5 py-3">
      <ShieldCheck aria-hidden className="mt-px size-[var(--fw-icon-md)] shrink-0 text-accent" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-semibold text-ink">{COPY.nothingMore}</p>
        <p className="text-sm text-muted">{COPY.nothingMoreNote}</p>
      </div>
    </div>
  );
}

/** A step's transaction: its short hash, a link where its chain has an explorer. */
export function TxLink({
  hash,
  ...where
}: { hash: string } & ({ chainId: number } | { link: { name: string; href: string } | null })) {
  const link = "link" in where ? where.link : txLink(where.chainId, hash);
  const short = <span className="font-mono text-xs">{shortAddress(hash)}</span>;
  return link ? (
    <ExplorerLink txHash={hash} link={link} className="-my-1">
      {short}
    </ExplorerLink>
  ) : (
    <span title={hash} className="shrink-0 text-muted">
      {short}
    </span>
  );
}

/** The money a step is about: its token's logo, the amount, then where and when. */
export function Figure({
  mark,
  amount,
  rest,
}: {
  mark: ReactNode;
  amount: string;
  rest: ReactNode;
}) {
  return (
    <span className="flex items-center gap-2.5 pt-0.5">
      {mark}
      <span className="min-w-0">
        <span className="font-medium break-all text-ink tabular-nums">{amount}</span> {rest}
      </span>
    </span>
  );
}

/** The line under the step in progress. */
export function StepLine({ children }: { children: ReactNode }) {
  return <p className={`text-xs text-muted tabular-nums ${ENTER}`}>{children}</p>;
}

/** The section's one live region: it stays mounted while the line moves from step to step, so each change is
 * announced. */
export function LiveLine({ children }: { children: string }) {
  return (
    <p role="status" className="sr-only">
      {children}
    </p>
  );
}

export interface LastStepsProps {
  invoice: Invoice;
  /** The network the invoice is paid on. */
  network: string;
  payee: string | undefined;
  readAt: number | null;
  /** The money is on that network; false while another chain's money is still on its way there. */
  arrived: boolean;
  /** Its blocks are being counted. */
  counting: boolean;
  /** Part of the amount is still due: the last step waits on the payer. */
  partial?: boolean;
  /** What the step in progress says while no blocks are counted. */
  line: string;
}

/** How every payment ends: its network confirms the transfer, then the payee is paid. `line` is what the step in
 * progress says, null while neither is. Confirming says the blocks passed, the time left and when it is final
 * (R-73); the step's ring shows the same share. */
export function useLastSteps({
  invoice,
  network,
  payee,
  readAt,
  arrived,
  counting,
  partial = false,
  line,
}: LastStepsProps): { steps: TimelineEntry[]; line: string | null } {
  const { done, upcoming, current } = TIMELINE_STATES;
  const { done: reached, blocksLeft, blocksTotal, secondsLeft } = invoiceProgress(invoice);
  const final = useFinalTime(counting, secondsLeft, readAt);
  // A deposit seen before its first read may need more blocks than the count kept for it.
  const total = Math.max(blocksTotal, blocksLeft);
  const said = !arrived
    ? null
    : counting
      ? COPY.confirmingLine(total - blocksLeft, total, secondsLeft, final)
      : line;
  // Final and booked by the ledger: only Paid is left.
  const booked = arrived && reached > INVOICE_TIMELINE.indexOf(INVOICE_STEPS.confirming);
  const shown = said ? <StepLine>{said}</StepLine> : undefined;
  return {
    line: said,
    steps: [
      {
        id: INVOICE_STEPS.confirming,
        title: booked
          ? COPY.steps.confirmed(network)
          : arrived
            ? COPY.steps.confirming(network)
            : COPY.steps.confirms(network),
        state: booked ? done : arrived ? current : upcoming,
        working: true,
        progress: counting ? confirmingProgress(blocksLeft, blocksTotal) : null,
        description: booked ? undefined : shown,
      },
      {
        id: INVOICE_STEPS.paid,
        title: booked && partial ? INVOICE_COPY.partlyPaid : COPY.steps.paid(payee),
        state: booked ? current : upcoming,
        working: !partial,
        description: booked ? shown : undefined,
      },
    ],
  };
}
