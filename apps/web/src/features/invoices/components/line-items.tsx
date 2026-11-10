"use client";

import { Button, formatTokenAmount, TextField } from "@forwend/ui-web";
import { Plus, Trash2, X } from "lucide-react";
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
  unit: string;
  errors: Readonly<Record<string, LineFieldErrors>>;
  error?: string;
}

// R-88: the items' total becomes the invoice's amount; the totals under the rows show it.
export function LineItems({ id, items, onChange, decimals, unit, errors, error }: LineItemsProps) {
  const list = useRef<HTMLUListElement>(null);
  // Add and remove take away the focused button: focus moves to the new row, or the one in its place.
  const focusRow = (row: number) =>
    list.current?.querySelectorAll("li")[row]?.querySelector("input")?.focus();
  const set = (itemId: string, field: LineField, value: string) =>
    onChange(items.map((item) => (item.id === itemId ? { ...item, [field]: value } : item)));
  const amounts = items.map((item) => lineUnits(item, decimals));
  const figure = (units: bigint) =>
    formatTokenAmount({ baseUnits: units, decimals, fractionDigits: exactDigits(units, decimals) });
  // From small screens the rows read as the invoice's own table. A phone has no room for five columns: there each
  // item is a block with its fields under their labels, and its amount and Remove on a line of their own.
  const grid =
    "grid grid-cols-[4.75rem_minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_4rem_6.5rem_minmax(4.5rem,auto)_2.5rem] sm:items-start sm:gap-2";
  return (
    <div id={id} className="flex flex-col">
      <div
        aria-hidden
        className={`${grid} px-2 pt-2.5 pb-0.5 pl-4 text-xs font-medium text-muted max-sm:hidden`}
      >
        <span>{COPY.description}</span>
        <span>{COPY.quantity}</span>
        <span>{COPY.price(unit)}</span>
        <span className="text-right">{COPY.amountIn(unit)}</span>
      </div>
      <ul ref={list} className="flex flex-col">
        {items.map((item, i) => {
          const shown = errors[item.id] ?? {};
          const amount = amounts[i];
          return (
            <li
              key={item.id}
              className={`${grid} border-b border-line p-3.5 sm:border-0 sm:py-2 sm:pr-2 sm:pl-4`}
            >
              <TextField
                label={COPY.item(i + 1)}
                value={item.description}
                onChange={(event) => set(item.id, "description", event.target.value)}
                maxLength={LINE_LIMITS.description}
                autoComplete="off"
                placeholder={COPY.descriptionPlaceholder}
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
              <div className="col-span-full flex items-center justify-between gap-3 sm:contents">
                <p className="flex items-baseline gap-2 text-sm sm:h-11 sm:items-center sm:justify-end">
                  <span className="text-muted sm:hidden">{COPY.amount}</span>
                  {/* The column's header names the unit from small screens up. */}
                  <span className="font-medium text-ink tabular-nums">
                    {amount === undefined || typeof amount === "string" ? (
                      ""
                    ) : (
                      <>
                        {figure(amount.units)}
                        <span className="sm:hidden"> {unit}</span>
                      </>
                    )}
                  </span>
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={COPY.remove(i + 1)}
                  onClick={() => {
                    flushSync(() => onChange(items.filter((other) => other.id !== item.id)));
                    focusRow(Math.min(i, items.length - 2));
                  }}
                  className="max-sm:text-danger sm:mt-1 sm:w-9 sm:px-0"
                >
                  <Trash2 aria-hidden className="size-[var(--fw-icon-sm)] sm:hidden" />
                  <X aria-hidden className="size-[var(--fw-icon-sm)] max-sm:hidden" />
                  <span className="sm:hidden">{COPY.removeShort}</span>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="px-3 pt-2 pb-3 sm:pt-1">
        <Button
          variant="ghost"
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
      </div>
      {error ? (
        // No field of its own: the form's way to the first error lands here.
        <p
          role="alert"
          data-invalid
          tabIndex={-1}
          className="px-4 pb-3 text-sm text-danger outline-none"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
