"use client";

import {
  BUTTON_VARIANTS,
  Button,
  Dialog,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { Ban, Ellipsis } from "lucide-react";
import { useRef } from "react";
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

// Cancel before any money (R-79, D-79): behind More actions, because it ends the invoice, then confirmed in a dialog
// because it can't be undone. Keep closes the native dialog through its form; a canceled invoice no longer offers this,
// so the dialog leaves with it.
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
  // The dialog opens once the menu has closed, so the menu does not hand focus back to its trigger over the dialog.
  const chosen = useRef(false);
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
      trigger={(open) => (
        <Menu>
          <MenuTrigger asChild>
            <Button
              variant={BUTTON_VARIANTS.secondary}
              size="sm"
              aria-label={COPY.moreActions}
              title={COPY.moreActions}
              className="shrink-0 px-2.5"
            >
              <Ellipsis aria-hidden className="size-[var(--fw-icon-sm)]" />
            </Button>
          </MenuTrigger>
          <MenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              if (!chosen.current) return;
              chosen.current = false;
              event.preventDefault();
              open();
            }}
          >
            <MenuItem
              className="text-danger data-[highlighted]:bg-danger-soft"
              onSelect={() => {
                chosen.current = true;
              }}
            >
              <Ban aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.cancel.trigger(noun)}
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
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
