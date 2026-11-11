"use client";

import { BUTTON_VARIANTS, Button, Dialog, TONES, useToast } from "@forwend/ui-web";
import { useReopenInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";

const COPY = INVOICE_COPY.reopen;
const CONFLICT = 409;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export interface ReopenInvoiceProps {
  profileId: string;
  invoiceId: string;
  number: string;
  noun: string;
  /** The close a reopen gives, as the API says (R-130). */
  until: string;
  // The page moves keyboard focus: the dialog and its trigger go away with the status.
  onReopened: () => void;
  /** The trigger button's place in the page's actions. */
  className?: string;
}

// R-130: an invoice that closed partly paid takes payments again, once.
export function ReopenInvoice({
  profileId,
  invoiceId,
  number,
  noun,
  until,
  onReopened,
  className,
}: ReopenInvoiceProps) {
  const [reopen, { isLoading, error }] = useReopenInvoiceMutation();
  const toast = useToast();
  const status = (error as { status?: unknown } | undefined)?.status;
  const day = TIME.format(new Date(until));
  const confirm = async () => {
    try {
      await reopen({ profileId, invoiceId }).unwrap();
      toast({ tone: TONES.success, title: COPY.done(number, day) });
      onReopened();
    } catch (failure) {
      // Too late: the refetch that follows ends the reopen, and the dialog with it; the toast stays.
      if ((failure as { status?: unknown }).status === CONFLICT) {
        toast({ tone: TONES.warning, title: COPY.tooLate });
      }
    }
  };

  return (
    <Dialog
      triggerLabel={COPY.trigger}
      title={COPY.title(number)}
      trigger={(open) => (
        <Button variant={BUTTON_VARIANTS.primary} onClick={open} className={className}>
          {COPY.trigger}
        </Button>
      )}
    >
      <p>{COPY.body(day, noun)}</p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {status === CONFLICT ? COPY.tooLate : COPY.failed}
        </p>
      ) : null}
      <form method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
          {COPY.keep}
        </Button>
        <Button
          type="button"
          variant={BUTTON_VARIANTS.primary}
          loading={isLoading}
          onClick={confirm}
        >
          {COPY.confirm}
        </Button>
      </form>
    </Dialog>
  );
}
