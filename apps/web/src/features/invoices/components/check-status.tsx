"use client";

import { Button } from "@forwend/ui-web";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import {
  type CheckStatusInput,
  type CheckStatusState,
  useCheckStatus,
} from "@/features/invoices/hooks/use-check-status";

export interface CheckStatusProps extends Omit<CheckStatusInput, "payToken"> {
  payToken: string;
  /** The wrapper's layout; "contents" hands the button and the message to the caller's grid. */
  className?: string;
  messageClassName?: string;
}

/** R-55: the Check status button and what it found. */
export function CheckStatus({
  className = "flex flex-wrap items-center gap-x-3 gap-y-2",
  messageClassName = "",
  ...input
}: CheckStatusProps) {
  const status = useCheckStatus(input);
  return (
    <div className={className}>
      <Button
        size="sm"
        variant="secondary"
        loading={status.busy}
        disabled={status.resting}
        onClick={status.check}
      >
        {COPY.checkStatus}
      </Button>
      <CheckStatusNote status={status} className={messageClassName} />
    </div>
  );
}

/** What a check found, and when the next one is allowed. Always rendered, so the live region exists before the
 * first answer. */
export function CheckStatusNote({
  status,
  className = "",
}: {
  status: CheckStatusState;
  className?: string;
}) {
  return (
    <p className={`text-sm text-muted ${status.found || status.next ? className : "sr-only"}`}>
      <span role="status">{status.found}</span>
      {/* The countdown sits outside the live region, so screen readers are not told each second. */}
      {status.next ? (
        <span>
          {status.found ? " · " : null}
          {status.next}
        </span>
      ) : null}
    </p>
  );
}
