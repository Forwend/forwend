"use client";

import { Button, formatTokenAmount, IconButton, TextField } from "@forwend/ui-web";
import { Plus, X } from "lucide-react";
import { useRef } from "react";
import { flushSync } from "react-dom";
import { LINE_LIMITS } from "@/features/invoices/constants/invoices";
import { NEW_INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import { lineUnits } from "@/features/invoices/lib/invoices";
import type { LineDraft, LineField } from "@/features/invoices/types/invoices";
import { exactDigits } from "@/shared/lib/money";

const COPY = NEW_INVOICE_COPY.items;

export type LineFieldErrors = Partial<Record<LineField, string>>;

export interface LineItemsProps {
  /** On the list's box, so the form can move focus into it. */
  id: string;
  items: readonly LineDraft[];
  onChange: (items: LineDraft[]) => void;
  decimals: number;
  /** The amount's unit: the token's symbol, or USD when the client chooses. */
  unit: string;
  /** By item id, set when Create finds a line it can't send. */
  errors: Readonly<Record<string, LineFieldErrors>>;
  /** The API's word on the lines as a whole. */
  error?: string;
}

// R-88: the invoice's items, each a description, a quantity and a unit price, with its amount and the total, which
// becomes the invoice's amount. Phones stack each item; from small screens up the items line up under one header row,
// so each field's label is for screen readers only there.
export function LineItems({ id, items, onChange, decimals, unit, errors, error }: LineItemsProps) {
  const list = useRef<HTMLUListElement>(null);
  // Add item and the remove buttons take away the button that had focus: it moves to the new row, or to the row that
  // took the removed one's place (else the one before).
  const focusRow = (row: number) =>
    list.current?.querySelectorAll("li")[row]?.querySelector("input")?.focus();
  const set = (itemId: string, field: LineField, value: string) =>
    onChange(items.map((item) => (item.id === itemId ? { ...item, [field]: value } : item)));
  const amounts = items.map((item) => lineUnits(item, decimals));
  const total = amounts.reduce((sum, a) => (typeof a === "string" ? sum : sum + a.units), 0n);
  const money = (units: bigint) =>
    `${formatTokenAmount({ baseUnits: units, decimals, fractionDigits: exactDigits(units, decimals) })} ${unit}`;
  const grid =
    "grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_7rem_7.5rem_2.5rem]";
  return (
    <div id={id} className="flex flex-col gap-3">
      <div aria-hidden className={`${grid} max-sm:hidden text-sm font-medium text-ink`}>
        <span>{COPY.description}</span>
        <span>{COPY.quantity}</span>
        <span>{COPY.price(unit)}</span>
        <span className="text-right">{COPY.amount}</span>
      </div>
      <ul ref={list} className="flex flex-col gap-4 sm:gap-3">
        {items.map((item, i) => {
          const shown = errors[item.id] ?? {};
          const amount = amounts[i];
          return (
            <li key={item.id} className={grid}>
              <TextField
                label={COPY.item(i + 1)}
                value={item.description}
                onChange={(event) => set(item.id, "description", event.target.value)}
                maxLength={LINE_LIMITS.description}
                autoComplete="off"
                error={shown.description}
                className="col-span-full sm:col-span-1 sm:[&>label]:sr-only"
              />
              <TextField
                label={COPY.quantity}
                aria-label={COPY.quantityOf(i + 1)}
                value={item.quantity}
                onChange={(event) => set(item.id, "quantity", event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                error={shown.quantity}
                className="sm:[&>label]:sr-only"
              />
              <TextField
                label={COPY.price(unit)}
                aria-label={COPY.priceOf(unit, i + 1)}
                value={item.price}
                onChange={(event) => set(item.id, "price", event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                error={shown.price}
                className="sm:[&>label]:sr-only"
              />
              <p className="flex h-11 items-center justify-end text-sm font-medium tabular-nums text-ink max-sm:col-start-2 max-sm:row-start-3 max-sm:justify-start">
                {amount === undefined || typeof amount === "string" ? "" : money(amount.units)}
              </p>
              <IconButton
                label={COPY.remove(i + 1)}
                onClick={() => {
                  flushSync(() => onChange(items.filter((other) => other.id !== item.id)));
                  focusRow(Math.min(i, items.length - 2));
                }}
                className="self-start max-sm:col-start-3 max-sm:row-start-2 max-sm:mt-7 sm:mt-0.5"
              >
                <X aria-hidden className="size-[var(--fw-icon-sm)]" />
              </IconButton>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={items.length >= LINE_LIMITS.count}
          onClick={() => {
            flushSync(() =>
              onChange([
                ...items,
                { id: crypto.randomUUID(), description: "", quantity: "1", price: "" },
              ]),
            );
            focusRow(items.length);
          }}
        >
          <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.add}
        </Button>
        <p className="flex items-baseline gap-3 text-ink">
          <span className="text-sm text-muted">{COPY.total}</span>
          <span className="text-lg font-semibold tabular-nums">{money(total)}</span>
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
