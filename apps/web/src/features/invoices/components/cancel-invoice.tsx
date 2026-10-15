"use client";

import { BUTTON_VARIANTS, Button, Dialog, TONES, useToast } from "@forwend/ui-web";
import { useCancelInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";

const CONFLICT = 409;

export interface CancelInvoiceProps {
  profileId: string;
  invoiceId: string;
  number: string;
  noun: string;
  // Called once canceled, so the page can move keyboard focus: the dialog and its trigger go away with the status.
  onCanceled: () => void;
}

// Cancel before any money (R-79, D-79), confirmed in a dialog because it can't be undone. Keep closes the native
// dialog through its form; a canceled invoice no longer offers this, so the dialog leaves with it.
export function CancelInvoice({
  profileId,
  invoiceId,
  number,
  noun,
  onCanceled,
}: CancelInvoiceProps) {
  const [cancel, { isLoading, error }] = useCancelInvoiceMutation();
  const toast = useToast();
  const status = (error as { status?: unknown } | undefined)?.status;
  const confirm = async () => {
    try {
      await cancel({ profileId, invoiceId }).unwrap();
      toast({ tone: TONES.success, title: COPY.cancel.done(number) });
      onCanceled();
    } catch (failure) {
      // Too late: the refetch that follows can take this link, and the dialog with it, away; the toast stays.
      if ((failure as { status?: unknown }).status === CONFLICT) {
        toast({ tone: TONES.warning, title: COPY.cancel.tooLate });
      }
    }
  };
  return (
    <Dialog
      triggerLabel={COPY.cancel.trigger(noun)}
      title={COPY.cancel.title(number)}
      triggerVariant={BUTTON_VARIANTS.link}
      triggerClassName="self-start text-sm lg:self-end"
    >
      <p>{COPY.cancel.body}</p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {status === CONFLICT ? COPY.cancel.tooLate : COPY.cancel.failed}
        </p>
      ) : null}
      <form method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
          {COPY.cancel.keep(noun)}
        </Button>
        <Button
          type="button"
          variant={BUTTON_VARIANTS.danger}
          loading={isLoading}
          onClick={confirm}
        >
          {COPY.cancel.confirm(noun)}
        </Button>
      </form>
    </Dialog>
  );
}
