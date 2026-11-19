import { EmptyState } from "@forwend/ui-web";
import { Ban, Clock, LoaderCircle } from "lucide-react";
import { CheckStatus } from "@/features/invoices/components/check-status";
import type { Invoice } from "@/features/invoices/types/invoices";
import { GetItBack } from "@/features/pay/components/held-note";
import { PAY_STATES } from "@/features/pay/constants/pay";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { useFound } from "@/features/pay/hooks/use-found";
import { amountText, stateLine } from "@/features/pay/lib/pay";
import type { PayStatus, PayToken } from "@/features/pay/types/pay";

const ICON = "size-[var(--fw-icon-md)] shrink-0";

export interface PayStatusLineProps {
  invoice: Invoice;
  linkToken: string;
  pay: PayStatus;
  token: PayToken;
  network: string;
  bordered: boolean;
  choosable: boolean;
}

export function PayStatusLine({
  invoice,
  linkToken,
  pay,
  token,
  network,
  bordered,
  choosable,
}: PayStatusLineProps) {
  const missing = useFound(linkToken, pay);
  const money = (units: bigint) => amountText(units, token);
  // Never "Waiting for payment" beside what a check found.
  const found = missing > 0n;
  const pending = pay.state === PAY_STATES.waiting && !found;
  const shut =
    !choosable && (pay.state === PAY_STATES.canceled || pay.state === PAY_STATES.closed)
      ? pay.state
      : null;
  return (
    <div
      className={`${shut ? "" : "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 p-4 sm:p-5"} ${bordered ? "border-t border-line" : ""}`}
    >
      {/* One live region in every state, so a payer watching hears the payment close. */}
      <div
        role="status"
        className={shut ? undefined : "flex items-start gap-2.5 text-sm font-medium text-ink"}
      >
        {shut ? (
          <EmptyState
            compact
            icon={shut === PAY_STATES.canceled ? Ban : Clock}
            title={COPY.closedTitles[shut]}
            description={stateLine(invoice, pay, token)}
          />
        ) : found ? (
          <LoaderCircle
            aria-hidden
            className={`${ICON} text-muted motion-safe:animate-[fw-spin_var(--fw-duration-slower)_linear_infinite]`}
          />
        ) : pending ? (
          <span aria-hidden className="relative mt-1.5 flex size-2 shrink-0">
            <span className="absolute inset-0 rounded-pill bg-accent opacity-60 motion-safe:animate-ping" />
            <span className="relative size-2 rounded-pill bg-accent" />
          </span>
        ) : pay.closed ? (
          <Clock aria-hidden className={`${ICON} text-muted`} />
        ) : null}
        {shut ? null : <span>{found ? COPY.found : stateLine(invoice, pay, token)}</span>}
      </div>
      {/* Always rendered, so the live region exists before a check finds money. */}
      <p
        role="status"
        className={found ? "col-start-1 row-start-2 -mt-1.5 pl-6.5 text-xs text-muted" : "sr-only"}
      >
        {found ? COPY.foundNote(money(missing)) : null}
      </p>
      {pay.state === PAY_STATES.closedPartial ? (
        <div className="col-start-2 row-start-1">
          <GetItBack />
        </div>
      ) : null}
      {pending ? (
        <p className="col-start-1 row-start-2 -mt-1.5 pl-4.5 text-xs text-muted">
          {COPY.updatesItself}
        </p>
      ) : null}
      {pending ? (
        <CheckStatus
          payToken={linkToken}
          network={network}
          money={money}
          nextCheckAt={invoice.nextCheckAt}
          className="contents"
          messageClassName="col-span-2"
        />
      ) : null}
    </div>
  );
}
