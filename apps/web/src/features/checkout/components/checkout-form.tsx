"use client";

import { AmountField, Button, Form, SelectField, TextField } from "@forwend/ui-web";
import { type FormEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useCreateCheckoutMutation } from "@/features/checkout/api/checkout-api";
import { CHECKOUT_COPY as COPY } from "@/features/checkout/constants/checkout-copy";
import type { CheckoutSession } from "@/features/checkout/types/checkout";
import { USD_PATTERN } from "@/features/links/constants/links";
import type { Store } from "@/features/stores/types/stores";
import { MONEY_COPY } from "@/shared/constants/money-copy";

export interface CheckoutFormProps {
  profileId: string;
  stores: readonly Store[];
  onStarted: (session: CheckoutSession, amountUsd: string) => void;
}

/** The sale's amount and reference; the key is made once, so a retried tap opens the same checkout. */
export function CheckoutForm({ profileId, stores, onStarted }: CheckoutFormProps) {
  const [create] = useCreateCheckoutMutation();
  const key = useRef(crypto.randomUUID());
  const [store, setStore] = useState(stores[0]?.storeId ?? "");
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const amountUsd = text("amountUsd");
    const bad = !USD_PATTERN.test(amountUsd) || Number(amountUsd) === 0;
    flushSync(() => {
      setError(bad ? COPY.errors.amount : "");
      setFormError("");
    });
    if (bad) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const reference = text("reference");
    const title = text("title");
    setBusy(true);
    try {
      const session = await create({
        profileId,
        idempotencyKey: key.current,
        body: {
          storeId: store,
          amountUsd,
          ...(reference ? { reference } : {}),
          ...(title ? { title } : {}),
        },
      }).unwrap();
      onStarted(session, amountUsd);
    } catch {
      setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  return (
    // Any change makes a different sale, so it gets its own key.
    <Form
      onSubmit={submit}
      onChange={() => (key.current = crypto.randomUUID())}
      noValidate
      gap="sm"
      aria-labelledby="checkout-sale"
      className="min-w-0"
    >
      <div className="flex min-h-10 items-center">
        <h2 id="checkout-sale" className="text-base font-semibold text-ink">
          {COPY.newSale}
        </h2>
      </div>
      <div className="fw-panel">
        <div className="flex flex-col gap-5 p-4 sm:p-5">
          {stores.length > 1 ? (
            <SelectField
              label={COPY.store}
              value={store}
              onValueChange={(value) => {
                setStore(value);
                key.current = crypto.randomUUID();
              }}
              options={stores.map((s) => ({ value: s.storeId, label: s.name }))}
            />
          ) : null}
          <AmountField
            label={COPY.amount}
            name="amountUsd"
            unit={MONEY_COPY.usd}
            placeholder="0.00"
            // The page does one thing: a sale starts with its amount, and New sale lands back here.
            autoFocus
            error={error}
          />
          <TextField label={COPY.reference} name="reference" autoComplete="off" />
          <TextField label={COPY.what} name="title" autoComplete="off" />
        </div>
        <div className="flex flex-col gap-2 border-t border-line p-4 sm:p-5">
          <Button type="submit" size="lg" loading={busy} className="w-full">
            {COPY.start}
          </Button>
          <p role="alert" className="text-sm text-danger empty:hidden">
            {formError}
          </p>
        </div>
      </div>
    </Form>
  );
}
