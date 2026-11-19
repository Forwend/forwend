"use client";

import { Button, ComboboxField, DatePicker, IconButton, TextField } from "@forwend/ui-web";
import { Plus, X } from "lucide-react";
import { useId, useMemo } from "react";
import { flushSync } from "react-dom";
import { AGREED_CURRENCIES } from "@/features/invoices/constants/invoices";
import { NEW_INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import { currencyOptions } from "@/features/invoices/lib/invoices";
import type { AgreedDraft } from "@/features/invoices/types/invoices";

const COPY = NEW_INVOICE_COPY.agreed;

export interface AgreedValueProps {
  value: AgreedDraft | null; // null until added
  onChange: (value: AgreedDraft | null) => void;
  today: string;
  errors: Partial<Record<keyof AgreedDraft, string>>;
}

/** Typed by the owner (no exchange-rate API); Add and Remove move focus to what replaces them. */
export function AgreedValue({ value, onChange, today, errors }: AgreedValueProps) {
  const id = useId();
  const toggle = (next: AgreedDraft | null) => {
    flushSync(() => onChange(next));
    document.getElementById(id)?.focus();
  };
  return value ? (
    <AgreedValueFields
      id={id}
      value={value}
      onChange={onChange}
      onRemove={() => toggle(null)}
      today={today}
      errors={errors}
    />
  ) : (
    <div className="flex flex-col items-start gap-1">
      <Button
        id={id}
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={() => toggle({ currency: "", amount: "", date: today })}
      >
        <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
        {COPY.add}
      </Button>
      <p className="text-xs text-muted">{COPY.addHint}</p>
    </div>
  );
}

function AgreedValueFields({
  id,
  value,
  onChange,
  onRemove,
  today,
  errors,
}: Omit<AgreedValueProps, "value"> & { id: string; value: AgreedDraft; onRemove: () => void }) {
  const currencies = useMemo(() => currencyOptions(Object.keys(AGREED_CURRENCIES)), []);
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
        <IconButton
          label={COPY.remove}
          onClick={onRemove}
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
