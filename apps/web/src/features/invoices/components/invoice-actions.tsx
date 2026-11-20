"use client";

import {
  BUTTON_VARIANTS,
  Button,
  Dialog,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  RowButton,
  rowButtonClasses,
  Sheet,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { Ban, CopyPlus, Ellipsis, FilePen, Pencil, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCancelInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { EditInvoice, type EditInvoiceProps } from "@/features/invoices/components/edit-invoice";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import type { CheckStatusState } from "@/features/invoices/hooks/use-check-status";
import { invoiceCopyHref, invoiceReviseHref } from "@/features/invoices/lib/invoices";
import { errorStatus, HTTP_STATUS } from "@/shared/api/api-error";
import { useDesktop } from "@/shared/hooks/use-desktop";

const ICON = "size-[var(--fw-icon-md)] shrink-0 text-muted";
const ROW = rowButtonClasses();

export interface InvoiceActionsProps {
  profileId: string;
  invoiceId: string;
  number: string;
  noun: string;
  recheck: CheckStatusState | null;
  cancelable: boolean;
  onCanceled: () => void;
  editable: Omit<EditInvoiceProps, "profileId" | "invoiceId" | "number"> | null; // null until the owner's read is in
}

// Desktop: Edit as its own button, the rest in a menu. Phones: all of them in a sheet.
export function InvoiceActions({
  profileId,
  invoiceId,
  number,
  noun,
  recheck,
  cancelable,
  onCanceled,
  editable,
}: InvoiceActionsProps) {
  const desktop = useDesktop();
  const [sheet, setSheet] = useState(false);
  const [cancel, { isLoading, error }] = useCancelInvoiceMutation();
  const toast = useToast();
  const status = errorStatus(error);
  // A dialog opens once the menu or sheet has closed, so neither hands focus back over it.
  const chosen = useRef<(() => void) | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const open = chosen.current;
    if (sheet || !open) return;
    chosen.current = null;
    // A closed dialog gives focus back to what had it when it opened.
    trigger.current?.focus();
    open();
  }, [sheet]);

  const confirm = async () => {
    try {
      await cancel({ profileId, invoiceId }).unwrap();
      toast({ tone: TONES.success, title: COPY.cancel.done(number) });
      onCanceled();
    } catch (failure) {
      // Too late: the refetch that follows can end the cancel, and the dialog with it; the toast stays.
      if (errorStatus(failure) === HTTP_STATUS.conflict) {
        toast({ tone: TONES.warning, title: COPY.cancel.tooLate });
      }
    }
  };
  const pick = (open?: () => void) => {
    chosen.current = open ?? null;
    setSheet(false);
  };

  const more = (openEdit?: () => void, openCancel?: () => void) =>
    desktop ? (
      <div className="flex items-center gap-2">
        {openEdit ? (
          <Button variant={BUTTON_VARIANTS.secondary} onClick={openEdit}>
            <Pencil aria-hidden className="size-[var(--fw-icon-sm)]" />
            {COPY.edit.trigger}
          </Button>
        ) : null}
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
              trigger.current?.focus();
              open();
            }}
          >
            {recheck ? (
              <>
                <MenuItem disabled={recheck.resting || recheck.busy} onSelect={recheck.check}>
                  <RefreshCw aria-hidden className="size-[var(--fw-icon-sm)]" />
                  {COPY.checkStatus}
                </MenuItem>
                <MenuSeparator />
              </>
            ) : null}
            {/* Revising cancels this one, so it shows only while cancel does. */}
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
            {cancelable ? (
              <>
                <MenuSeparator />
                <MenuItem
                  danger
                  onSelect={() => {
                    chosen.current = openCancel ?? null;
                  }}
                >
                  <Ban aria-hidden className="size-[var(--fw-icon-sm)]" />
                  {COPY.cancel.trigger(noun)}
                </MenuItem>
              </>
            ) : null}
          </MenuContent>
        </Menu>
      </div>
    ) : (
      <>
        <IconButton
          ref={trigger}
          label={COPY.moreActions}
          size="md"
          aria-haspopup="dialog"
          aria-expanded={sheet}
          onClick={() => setSheet(true)}
        >
          <Ellipsis aria-hidden className="size-[var(--fw-icon-md)]" />
        </IconButton>
        <Sheet open={sheet} onOpenChange={setSheet} title={number || COPY.moreActions}>
          <ul className="flex flex-col">
            {openEdit ? (
              <li>
                <RowButton onClick={() => pick(openEdit)}>
                  <Pencil aria-hidden className={ICON} />
                  {COPY.edit.trigger}
                </RowButton>
              </li>
            ) : null}
            {recheck ? (
              <li>
                <RowButton
                  disabled={recheck.resting || recheck.busy}
                  onClick={() => {
                    recheck.check();
                    setSheet(false);
                  }}
                  className="disabled:text-subtle"
                >
                  <RefreshCw aria-hidden className={ICON} />
                  {COPY.checkStatus}
                </RowButton>
              </li>
            ) : null}
            {cancelable ? (
              <li>
                <Link href={invoiceReviseHref(invoiceId)} className={ROW}>
                  <FilePen aria-hidden className={ICON} />
                  {COPY.revise}
                </Link>
              </li>
            ) : null}
            <li>
              <Link href={invoiceCopyHref(invoiceId, false)} className={ROW}>
                <CopyPlus aria-hidden className={ICON} />
                {COPY.duplicate}
              </Link>
            </li>
            {cancelable ? (
              <li className="mt-1 border-t border-line pt-1">
                {/* Important: RowButton's own ink and hover colors would otherwise win. */}
                <RowButton
                  onClick={() => pick(openCancel)}
                  className="text-danger! hover:bg-danger-soft!"
                >
                  <Ban aria-hidden className="size-[var(--fw-icon-md)] shrink-0" />
                  {COPY.cancel.trigger(noun)}
                </RowButton>
              </li>
            ) : null}
          </ul>
        </Sheet>
      </>
    );

  const cancelDialog = (openEdit?: () => void) => (
    <Dialog
      triggerLabel={COPY.cancel.trigger(noun)}
      title={COPY.cancel.title(number)}
      trigger={(openCancel) => more(openEdit, openCancel)}
    >
      <p>{COPY.cancel.body}</p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {status === HTTP_STATUS.conflict ? COPY.cancel.tooLate : COPY.cancel.failed}
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
      trigger={(openEdit) => (cancelable ? cancelDialog(openEdit) : more(openEdit))}
    >
      <EditInvoice profileId={profileId} invoiceId={invoiceId} number={number} {...editable} />
    </Dialog>
  ) : cancelable ? (
    cancelDialog()
  ) : (
    more()
  );
}
