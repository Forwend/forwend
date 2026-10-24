"use client";

import {
  BUTTON_VARIANTS,
  Button,
  DatePicker,
  TextAreaField,
  TextField,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useEditInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { INVOICE_FIELDS, INVOICE_LIMITS } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY, NEW_INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import {
  formatDueDate,
  invalidField,
  isReturnLink,
  offStoreOrigins,
} from "@/features/invoices/lib/invoices";
import type { InvoiceField } from "@/features/invoices/types/invoices";

const COPY = INVOICE_COPY.edit;
const INVALID_VALUE = 422;
const CONFLICT = 409;

export interface EditInvoiceProps {
  profileId: string;
  invoiceId: string;
  number: string;
  memo: string | null;
  clientEmail: string | null;
  returnUrl: string | null;
  reference: string | null;
  note: string | null;
  dueDate: string | null;
  /** Every option open, the checkout open and no money seen (R-128). */
  beforePayment: boolean;
  /** The UTC day the checkout closes: the latest due date. */
  closesOn: string;
  /** Today's UTC day: the earliest due date. */
  today: string;
  /** A personal profile's request has no client to email. */
  request: boolean;
}

/** R-127, R-128: a blank field clears it; the last three change only before any payment. */
export function EditInvoice(props: EditInvoiceProps) {
  const { memo, clientEmail, returnUrl, reference, note, dueDate, beforePayment } = props;
  // A save closes the dialog before the new values arrive: a new key starts the form, and its state, from them.
  const saved = [memo, clientEmail, returnUrl, reference, note, dueDate, beforePayment];
  return <EditForm key={saved.join("|")} {...props} />;
}

function EditForm({
  profileId,
  invoiceId,
  number,
  memo,
  clientEmail,
  returnUrl,
  reference,
  note,
  dueDate,
  beforePayment,
  closesOn,
  today,
  request,
}: EditInvoiceProps) {
  const [save, { isLoading }] = useEditInvoiceMutation();
  const toast = useToast();
  const [errors, setErrors] = useState<Partial<Record<InvoiceField, string>>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [due, setDue] = useState(dueDate);
  const form = useRef<HTMLFormElement>(null);
  // However the dialog closes, it opens next time on what is saved.
  useEffect(() => {
    const dialog = form.current?.closest("dialog");
    const reset = () => {
      form.current?.reset();
      setDue(dueDate);
      setErrors({});
      setFailed(null);
    };
    dialog?.addEventListener("close", reset);
    return () => dialog?.removeEventListener("close", reset);
  }, [dueDate]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim() || null;
    const link = text(INVOICE_FIELDS.returnUrl);
    setFailed(null);
    if (link && !isReturnLink(link)) {
      setErrors({
        [INVOICE_FIELDS.returnUrl]: NEW_INVOICE_COPY.fieldErrors[INVOICE_FIELDS.returnUrl],
      });
      return;
    }
    setErrors({});
    try {
      await save({
        profileId,
        invoiceId,
        body: {
          memo: text(INVOICE_FIELDS.memo),
          clientEmail: request ? clientEmail : text(INVOICE_FIELDS.clientEmail),
          returnUrl: link,
          // Locked fields go back as they are, so they change nothing.
          reference: beforePayment && !request ? text(INVOICE_FIELDS.reference) : reference,
          note: beforePayment ? text(INVOICE_FIELDS.note) : note,
          dueDate: beforePayment && !request ? due : dueDate,
        },
      }).unwrap();
      toast({ tone: TONES.success, title: COPY.saved(number) });
      form.current?.closest("dialog")?.close();
    } catch (failure) {
      const { status, data: body } = failure as {
        status?: unknown;
        data?: { error?: { message?: string } };
      };
      const field = status === INVALID_VALUE ? invalidField(body?.error?.message ?? "") : null;
      const message =
        field === INVOICE_FIELDS.dueDate
          ? COPY.dueHint(formatDueDate(closesOn))
          : offStoreOrigins(body?.error?.message ?? "")
            ? NEW_INVOICE_COPY.returnOriginError
            : field
              ? (NEW_INVOICE_COPY.fieldErrors as Record<string, string>)[field]
              : null;
      if (field && message) setErrors({ [field]: message });
      else setFailed(status === CONFLICT ? COPY.locked : COPY.failed);
    }
  };

  return (
    <form ref={form} onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Group title={COPY.anyTime}>
        <TextAreaField
          label={COPY.memo}
          name={INVOICE_FIELDS.memo}
          hint={COPY.memoHint}
          defaultValue={memo ?? ""}
          maxLength={INVOICE_LIMITS.memo}
          rows={3}
          error={errors[INVOICE_FIELDS.memo]}
        />
        {request ? null : (
          <TextField
            type="email"
            label={COPY.clientEmail}
            name={INVOICE_FIELDS.clientEmail}
            defaultValue={clientEmail ?? ""}
            autoComplete="off"
            maxLength={INVOICE_LIMITS.clientEmail}
            error={errors[INVOICE_FIELDS.clientEmail]}
          />
        )}
        <TextField
          type="url"
          label={COPY.returnUrl}
          name={INVOICE_FIELDS.returnUrl}
          hint={COPY.returnHint}
          defaultValue={returnUrl ?? ""}
          autoComplete="off"
          maxLength={INVOICE_LIMITS.returnUrl}
          error={errors[INVOICE_FIELDS.returnUrl]}
        />
      </Group>
      <Group
        title={COPY.beforePayment}
        hint={beforePayment ? COPY.beforePaymentHint : COPY.locked}
        disabled={!beforePayment}
      >
        {/* A request has no reference or due date, as its form has none. */}
        {request ? null : (
          <TextField
            label={COPY.reference}
            name={INVOICE_FIELDS.reference}
            defaultValue={reference ?? ""}
            autoComplete="off"
            maxLength={INVOICE_LIMITS.reference}
            error={errors[INVOICE_FIELDS.reference]}
          />
        )}
        <TextAreaField
          label={COPY.note}
          name={INVOICE_FIELDS.note}
          defaultValue={note ?? ""}
          maxLength={INVOICE_LIMITS.note}
          rows={3}
          error={errors[INVOICE_FIELDS.note]}
        />
        {request ? null : beforePayment ? (
          <DatePicker
            label={COPY.dueDate}
            value={due}
            onChange={setDue}
            min={today}
            max={closesOn}
            clearLabel={COPY.clearDue}
            hint={COPY.dueHint(formatDueDate(closesOn))}
            error={errors[INVOICE_FIELDS.dueDate]}
          />
        ) : (
          <TextField label={COPY.dueDate} value={dueDate ? formatDueDate(dueDate) : ""} readOnly />
        )}
      </Group>
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {failed}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant={BUTTON_VARIANTS.secondary}
          onClick={(event) => event.currentTarget.closest("dialog")?.close()}
        >
          {COPY.cancel}
        </Button>
        <Button type="submit" loading={isLoading}>
          {COPY.save}
        </Button>
      </div>
    </form>
  );
}

function Group({
  title,
  hint,
  disabled = false,
  children,
}: {
  title: string;
  hint?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const hintId = useId();
  // A legend is laid out apart from the fieldset's flex: as in FieldGroup, it is for screen readers only.
  return (
    <fieldset
      disabled={disabled}
      aria-describedby={hint ? hintId : undefined}
      className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
    >
      <legend className="sr-only">{title}</legend>
      <div className="flex flex-col gap-1">
        <p aria-hidden className="text-sm font-semibold text-ink">
          {title}
        </p>
        {hint ? (
          <p id={hintId} className="text-sm text-muted">
            {hint}
          </p>
        ) : null}
      </div>
      {children}
    </fieldset>
  );
}
