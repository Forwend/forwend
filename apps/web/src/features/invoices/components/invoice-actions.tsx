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
import { Ban, Check, Copy, CopyPlus, Ellipsis, ExternalLink, FilePen, Pencil } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { useCancelInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { EditInvoice, type EditInvoiceProps } from "@/features/invoices/components/edit-invoice";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { invoiceCopyHref, invoiceReviseHref } from "@/features/invoices/lib/invoices";

const CONFLICT = 409;

export interface InvoiceActionsProps {
  profileId: string;
  invoiceId: string;
  /** The pay link's token (D-86); null for an invoice made before it, which has no pay link. */
  payToken: string | null;
  number: string;
  noun: string;
  payable: boolean;
  /** Nothing paid yet, on any option (R-79). */
  cancelable: boolean;
  // The page moves keyboard focus: the dialog and its trigger go away with the status.
  onCanceled: () => void;
  /** What Edit shows (R-127); null until the owner's read is in, so Edit never starts from another invoice's values. */
  editable: Omit<EditInvoiceProps, "profileId" | "invoiceId" | "number"> | null;
}

// Edit (R-127); revise (R-129) and cancel (R-79, D-79) before any money; duplicate (R-91). Copy keeps the menu open:
// the item says it worked.
export function InvoiceActions({
  profileId,
  invoiceId,
  payToken,
  number,
  noun,
  payable: open,
  cancelable,
  onCanceled,
  editable,
}: InvoiceActionsProps) {
  const payable = open && payToken !== null;
  // The app renders only in the browser, after sign-in.
  const link = `${window.location.origin}/pay/${payToken}`;
  const [copyStatus, copy] = useCopy(link);
  const [cancel, { isLoading, error }] = useCancelInvoiceMutation();
  const toast = useToast();
  const status = (error as { status?: unknown } | undefined)?.status;
  // A dialog opens once the menu has closed, so the menu does not hand focus back to its trigger over the dialog.
  const chosen = useRef<(() => void) | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

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

  const menu = (openEdit?: () => void, openCancel?: () => void) => (
    <>
      <Menu>
        <MenuTrigger asChild ref={trigger}>
          <IconButton label={COPY.moreActions} title={COPY.moreActions} size="md">
            <Ellipsis aria-hidden className="size-[var(--fw-icon-md)]" />
          </IconButton>
        </MenuTrigger>
        <MenuContent
          align="end"
          className="w-64"
          onCloseAutoFocus={(event) => {
            const open = chosen.current;
            if (!open) return;
            chosen.current = null;
            event.preventDefault();
            // A closed dialog gives focus back to what had it when it opened.
            trigger.current?.focus();
            open();
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
          {openEdit ? (
            <MenuItem
              onSelect={() => {
                chosen.current = openEdit;
              }}
            >
              <Pencil aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.edit.trigger}
            </MenuItem>
          ) : null}
          {/* R-129: in the same window as cancel, which it does. */}
          {cancelable ? (
            <MenuItem asChild>
              <Link href={invoiceReviseHref(invoiceId)}>
                <FilePen aria-hidden className="size-[var(--fw-icon-sm)]" />
                {COPY.revise}
              </Link>
            </MenuItem>
          ) : null}
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
                chosen.current = openCancel ?? null;
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

  const cancelDialog = (openEdit?: () => void) => (
    <Dialog
      triggerLabel={COPY.cancel.trigger(noun)}
      title={COPY.cancel.title(number)}
      trigger={(openCancel) => menu(openEdit, openCancel)}
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

  return editable ? (
    <Dialog
      triggerLabel={COPY.edit.trigger}
      title={COPY.edit.title(number)}
      trigger={(openEdit) => (cancelable ? cancelDialog(openEdit) : menu(openEdit))}
    >
      <EditInvoice profileId={profileId} invoiceId={invoiceId} number={number} {...editable} />
    </Dialog>
  ) : cancelable ? (
    cancelDialog()
  ) : (
    menu()
  );
}
