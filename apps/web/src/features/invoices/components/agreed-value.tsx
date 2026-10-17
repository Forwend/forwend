"use client";

import { ComboboxField, DatePicker, IconButton, TextField } from "@forwend/ui-web";
import { X } from "lucide-react";
import { useId, useMemo } from "react";
import { AGREED_CURRENCIES } from "@/features/invoices/constants/invoices";
import { NEW_INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import type { AgreedDraft } from "@/features/invoices/types/invoices";

const COPY = NEW_INVOICE_COPY.agreed;

export interface AgreedValueFieldsProps {
  /** On the currency field, so the form can move focus to it. */
  id: string;
  value: AgreedDraft;
  onChange: (value: AgreedDraft | null) => void;
  today: string;
  errors: Partial<Record<keyof AgreedDraft, string>>;
}

// R-93: the price agreed with the client in fiat, typed by the owner (no exchange-rate API), beside the stablecoin
// amount the invoice asks for. A day after today can't have been agreed yet.
export function AgreedValueFields({ id, value, onChange, today, errors }: AgreedValueFieldsProps) {
  const currencies = useMemo(() => {
    const names = new Intl.DisplayNames(undefined, { type: "currency" });
    return Object.keys(AGREED_CURRENCIES).map((code) => ({
      value: code,
      label: `${code} · ${names.of(code) ?? code}`,
    }));
  }, []);
  // One fieldset, so a screen reader names the three fields together and reads the hint with them.
  const hintId = useId();
  return (
    <fieldset aria-describedby={hintId} className="flex min-w-0 flex-col gap-2">
      <legend className="sr-only">{COPY.group}</legend>
      <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-start gap-x-3 gap-y-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_2.5rem]">
        <ComboboxField
          id={id}
          label={COPY.currency}
          options={currencies}
          value={value.currency}
          onValueChange={(currency) => onChange({ ...value, currency })}
          placeholder={COPY.noCurrency}
          searchLabel={COPY.searchCurrencies}
          error={errors.currency}
        />
        <TextField
          label={COPY.amount}
          value={value.amount}
          onChange={(event) => onChange({ ...value, amount: event.target.value })}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          error={errors.amount}
          className="max-sm:col-span-full"
        />
        <DatePicker
          label={COPY.date}
          value={value.date}
          onChange={(date) => onChange({ ...value, date })}
          max={today}
          error={errors.date}
          className="max-sm:col-span-full"
        />
        {/* Beside the currency on phones, where the fields stack. */}
        <IconButton
          label={COPY.remove}
          onClick={() => onChange(null)}
          className="mt-7 self-start max-sm:col-start-2 max-sm:row-start-1"
        >
          <X aria-hidden className="size-[var(--fw-icon-sm)]" />
        </IconButton>
      </div>
      <p id={hintId} className="text-sm text-muted">
        {COPY.hint}
      </p>
    </fieldset>
  );
}
