"use client";

import { Button, Checkbox, DatePicker, TextField } from "@forwend/ui-web";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { INVOICE_FIELDS, INVOICE_LIMITS } from "@/features/invoices/constants/invoices";
import { NEW_INVOICE_COPY, NEW_REQUEST_COPY } from "@/features/invoices/constants/invoices-copy";
import type { InvoiceField } from "@/features/invoices/types/invoices";
import { returnLinkOrigins } from "@/features/stores/lib/stores";
import type { Store } from "@/features/stores/types/stores";

export interface NewInvoiceMoreOptionsProps {
  open: boolean;
  onToggle: () => void;
  request: boolean;
  store: Store | undefined;
  returnUrl: string | undefined;
  supplyDate: string | null;
  onSupplyDate: (iso: string | null) => void;
  reminders: boolean;
  onReminders: (on: boolean) => void;
  repeat: boolean;
  onRepeat: (on: boolean) => void;
  repeatEnd: string | null;
  onRepeatEnd: (iso: string | null) => void;
  repeatEndMin: string;
  errors: Partial<Record<InvoiceField, string>>;
  clear: (field: InvoiceField) => void;
}

/** Folded, not removed: the form reads every field on Create. */
export function NewInvoiceMoreOptions({
  open,
  onToggle,
  request,
  store,
  returnUrl,
  supplyDate,
  onSupplyDate,
  reminders,
  onReminders,
  repeat,
  onRepeat,
  repeatEnd,
  onRepeatEnd,
  repeatEndMin,
  errors,
  clear,
}: NewInvoiceMoreOptionsProps) {
  const COPY = request ? NEW_REQUEST_COPY : NEW_INVOICE_COPY;
  const id = useId();
  const remindersId = useId();
  const repeatId = useId();
  const origins = store ? returnLinkOrigins(store.allowedOrigins) : [];
  return (
    <div className="flex flex-col gap-5">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="-ml-2 self-start"
      >
        <ChevronDown
          aria-hidden
          className={`size-[var(--fw-icon-sm)] transition-transform duration-[var(--fw-duration-fast)] ${open ? "rotate-180" : ""}`}
        />
        {COPY.moreOptions}
      </Button>
      <div
        id={id}
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-[var(--fw-duration-base)] ease-[var(--fw-ease-out)] ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="flex min-h-0 flex-col gap-5 overflow-hidden">
          <TextField
            type="url"
            label={COPY.returnLabel}
            name="returnUrl"
            defaultValue={returnUrl}
            inputMode="url"
            autoComplete="url"
            placeholder="https://"
            maxLength={INVOICE_LIMITS.returnUrl}
            hint={
              !store
                ? COPY.returnHint
                : origins.length > 0
                  ? NEW_INVOICE_COPY.returnOrigins(origins.join(", "))
                  : NEW_INVOICE_COPY.returnNoOrigins
            }
            error={errors[INVOICE_FIELDS.returnUrl]}
            onChange={() => clear(INVOICE_FIELDS.returnUrl)}
          />
          {request ? null : (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <DatePicker
                  label={COPY.supplyLabel}
                  name="supplyDate"
                  value={supplyDate}
                  onChange={onSupplyDate}
                  clearLabel={COPY.supplyClear}
                  hint={COPY.supplyHint}
                  error={errors[INVOICE_FIELDS.supplyDate]}
                />
              </div>
              <div className="flex flex-col">
                <Checkbox
                  label={COPY.remindersLabel}
                  checked={reminders}
                  onChange={(event) => {
                    onReminders(event.target.checked);
                    clear(INVOICE_FIELDS.reminders);
                  }}
                  aria-invalid={errors[INVOICE_FIELDS.reminders] ? true : undefined}
                  aria-describedby={remindersId}
                />
                <p id={remindersId} className="text-sm text-muted">
                  {errors[INVOICE_FIELDS.reminders] ? (
                    <span className="text-danger">{errors[INVOICE_FIELDS.reminders]}</span>
                  ) : (
                    COPY.remindersHint
                  )}
                </p>
              </div>
              <div className="flex flex-col">
                <Checkbox
                  label={COPY.repeatLabel}
                  checked={repeat}
                  onChange={(event) => {
                    onRepeat(event.target.checked);
                    clear(INVOICE_FIELDS.repeat);
                    clear(INVOICE_FIELDS.repeatEndDate);
                  }}
                  aria-invalid={errors[INVOICE_FIELDS.repeat] ? true : undefined}
                  aria-describedby={repeatId}
                />
                <p id={repeatId} className="text-sm text-muted">
                  {errors[INVOICE_FIELDS.repeat] ? (
                    <span className="text-danger">{errors[INVOICE_FIELDS.repeat]}</span>
                  ) : (
                    COPY.repeatHint
                  )}
                </p>
              </div>
            </>
          )}
          {repeat ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <DatePicker
                label={COPY.repeatEndLabel}
                name="repeatEndDate"
                value={repeatEnd}
                onChange={(iso) => {
                  onRepeatEnd(iso);
                  clear(INVOICE_FIELDS.repeatEndDate);
                }}
                min={repeatEndMin}
                clearLabel={COPY.repeatEndClear}
                hint={COPY.repeatEndHint}
                error={errors[INVOICE_FIELDS.repeatEndDate]}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
