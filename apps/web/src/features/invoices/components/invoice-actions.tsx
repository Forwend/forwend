"use client";

import {
  BUTTON_VARIANTS,
  Button,
  COPY_STATUS,
  Dialog,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  TONES,
  useCopy,
  useToast,
} from "@forwend/ui-web";
import { Ban, Check, Copy, CopyPlus, Ellipsis, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { useCancelInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { invoiceCopyHref } from "@/features/invoices/lib/invoices";

const CONFLICT = 409;

export interface InvoiceActionsProps {
  profileId: string;
  invoiceId: string;
  /** The pay link's token (D-86); null for an invoice made before it, which has no pay link. */
  payToken: string | null;
  number: string;
  noun: string;
  /** The pay link still takes money: it can be copied and opened. */
  payable: boolean;
  /** Nothing paid yet, on any option (R-79): it can be canceled. */
  cancelable: boolean;
  // Called once canceled, so the page can move keyboard focus: the dialog and its trigger go away with the status.
  onCanceled: () => void;
}

// The invoice's actions behind one More actions menu: copy and open the pay link while it takes money, duplicate it
// (R-91), and cancel before any money (R-79, D-79), confirmed in a dialog because it can't be undone. Copying keeps the
// menu open, so the item itself says it worked; if the clipboard refuses, the whole link shows there to select. Keep
// closes the native dialog through its form.
export function InvoiceActions({
  profileId,
  invoiceId,
  payToken,
  number,
  noun,
  payable: open,
  cancelable,
  onCanceled,
}: InvoiceActionsProps) {
  const payable = open && payToken !== null;
  // The app renders only in the browser, after sign-in.
  const link = `${window.location.origin}/pay/${payToken}`;
  const [copyStatus, copy] = useCopy(link);
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
      // Too late: the refetch that follows can end the cancel, and the dialog with it; the toast stays.
      if ((failure as { status?: unknown }).status === CONFLICT) {
        toast({ tone: TONES.warning, title: COPY.cancel.tooLate });
      }
    }
  };
  const copyLabel =
    copyStatus === COPY_STATUS.copied
      ? COPY.copied
      : copyStatus === COPY_STATUS.failed
        ? COPY.copyFailed
        : COPY.copy;

  const menu = (openCancel?: () => void) => (
    <>
      <Menu>
        <MenuTrigger asChild>
          <IconButton label={COPY.moreActions} title={COPY.moreActions} size="md">
            <Ellipsis aria-hidden className="size-[var(--fw-icon-md)]" />
          </IconButton>
        </MenuTrigger>
        <MenuContent
          align="end"
          className="w-64"
          onCloseAutoFocus={(event) => {
            if (!chosen.current) return;
            chosen.current = false;
            event.preventDefault();
            openCancel?.();
          }}
        >
          {payable ? (
            <>
              <MenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  void copy();
                }}
              >
                {copyStatus === COPY_STATUS.copied ? (
                  <Check aria-hidden className="size-[var(--fw-icon-sm)] text-success" />
                ) : (
                  <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
                )}
                {copyLabel}
              </MenuItem>
              {copyStatus === COPY_STATUS.failed ? (
                <p className="px-3 pb-2 font-mono text-xs break-all text-muted select-all">
                  {link}
                </p>
              ) : null}
              <MenuItem asChild>
                <a href={link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
                  {COPY.openPayPage}
                  <span className="sr-only"> {COPY.inNewTab}</span>
                </a>
              </MenuItem>
            </>
          ) : null}
          {payable ? <MenuSeparator /> : null}
          <MenuItem asChild>
            <Link href={invoiceCopyHref(invoiceId, false)}>
              <CopyPlus aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.duplicate}
            </Link>
          </MenuItem>
          {cancelable ? <MenuSeparator /> : null}
          {cancelable ? (
            <MenuItem
              className="text-danger data-[highlighted]:bg-danger-soft"
              onSelect={() => {
                chosen.current = true;
              }}
            >
              <Ban aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.cancel.trigger(noun)}
            </MenuItem>
          ) : null}
        </MenuContent>
      </Menu>
      <p role="status" className="sr-only">
        {copyStatus === COPY_STATUS.idle ? "" : copyLabel}
      </p>
    </>
  );

  return cancelable ? (
    <Dialog
      triggerLabel={COPY.cancel.trigger(noun)}
      title={COPY.cancel.title(number)}
      trigger={menu}
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
  ) : (
    menu()
  );
}
