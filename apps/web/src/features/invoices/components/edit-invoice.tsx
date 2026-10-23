"use client";

import {
  BUTTON_VARIANTS,
  Button,
  TextAreaField,
  TextField,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useEditInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { INVOICE_FIELDS, INVOICE_LIMITS } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY, NEW_INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import { invalidField, isReturnLink } from "@/features/invoices/lib/invoices";
import type { InvoiceField } from "@/features/invoices/types/invoices";

const COPY = INVOICE_COPY.edit;
const INVALID_VALUE = 422;

export interface EditInvoiceProps {
  profileId: string;
  invoiceId: string;
  number: string;
  memo: string | null;
  clientEmail: string | null;
  returnUrl: string | null;
  /** A personal profile's request has no client to email. */
  request: boolean;
}

/** R-127: what the owner may change at any time; a blank field clears it. */
export function EditInvoice({
  profileId,
  invoiceId,
  number,
  memo,
  clientEmail,
  returnUrl,
  request,
}: EditInvoiceProps) {
  const [save, { isLoading }] = useEditInvoiceMutation();
  const toast = useToast();
  const [errors, setErrors] = useState<Partial<Record<InvoiceField, string>>>({});
  const [failed, setFailed] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  // However the dialog closes, it opens next time on what is saved.
  useEffect(() => {
    const dialog = form.current?.closest("dialog");
    const reset = () => {
      form.current?.reset();
      setErrors({});
      setFailed(false);
    };
    dialog?.addEventListener("close", reset);
    return () => dialog?.removeEventListener("close", reset);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim() || null;
    const link = text(INVOICE_FIELDS.returnUrl);
    setFailed(false);
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
      const message = field
        ? (NEW_INVOICE_COPY.fieldErrors as Record<string, string>)[field]
        : null;
      if (field && message) setErrors({ [field]: message });
      else setFailed(true);
    }
  };

  return (
    // A new key when the saved values change: the fields start from what is saved now.
    <form
      key={`${memo}|${clientEmail}|${returnUrl}`}
      ref={form}
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4"
    >
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
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {COPY.failed}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap justify-end gap-2">
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
