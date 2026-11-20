import { shortAddress, TIMELINE_STATES, type TimelineEntry } from "@forwend/ui-web";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { INVOICE_STEPS, INVOICE_TIMELINE } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import { confirmingProgress, invoiceProgress } from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { useFinalTime } from "@/features/pay/hooks/use-final-time";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { ENTER } from "@/shared/constants/motion";
import { txLink } from "@/shared/lib/chains";

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

export function StepLine({ children }: { children: ReactNode }) {
  return <p className={`text-xs text-muted tabular-nums ${ENTER}`}>{children}</p>;
}

/** One live region that stays mounted, so each change of step is announced. */
export function LiveLine({ children }: { children: string }) {
  return (
    <p role="status" className="sr-only">
      {children}
    </p>
  );
}

export interface LastStepsProps {
  invoice: Invoice;
  network: string;
  payee: string | undefined;
  readAt: number | null;
  arrived: boolean;
  counting: boolean;
  partial?: boolean;
  line: string;
}

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
