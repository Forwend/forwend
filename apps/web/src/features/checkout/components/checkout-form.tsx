"use client";

import {
  AmountField,
  Button,
  buttonClasses,
  cx,
  Form,
  NOTICE_TONES,
  Notice,
  SelectMenu,
  Sheet,
  Skeleton,
  TextField,
} from "@forwend/ui-web";
import {
  ArrowLeft,
  Clock,
  Delete,
  Hash,
  Pencil,
  Plus,
  QrCode as QrIcon,
  Store as StoreIcon,
} from "lucide-react";
import Link from "next/link";
import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useCreateCheckoutMutation } from "@/features/checkout/api/checkout-api";
import { SaleCard } from "@/features/checkout/components/sale-card";
import { CHECKOUT_COPY as COPY } from "@/features/checkout/constants/checkout-copy";
import { typeKey } from "@/features/checkout/lib/checkout";
import type { CheckoutSession } from "@/features/checkout/types/checkout";
import { USD_PATTERN } from "@/features/links/constants/links";
import type { Store } from "@/features/stores/types/stores";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"] as const;
const KEYPAD = "grid grid-cols-3 gap-2";
// The keys and the main button are a terminal's: taller than a form's.
const KEY = "h-14! rounded-lg!";
const AMOUNT_LABEL = "text-sm text-muted";

// A tapped key leaves the focus in the amount, so a keyboard can go on typing.
const keepFocus = (event: MouseEvent) => event.preventDefault();

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
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const note = reference.trim() || title.trim();

  // A key makes a different sale, as typing does.
  const press = (next: string) => {
    setAmount(next);
    key.current = crypto.randomUUID();
  };
  // Return in the sheet closes it: it would otherwise start the sale behind it.
  const doneOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    setDetails(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const amountUsd = amount.trim();
    const bad = !USD_PATTERN.test(amountUsd) || Number(amountUsd) === 0;
    flushSync(() => {
      setError(bad ? COPY.errors.amount : "");
      setFormError("");
    });
    if (bad) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setBusy(true);
    try {
      const session = await create({
        profileId,
        idempotencyKey: key.current,
        body: {
          storeId: store,
          amountUsd,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(title.trim() ? { title: title.trim() } : {}),
        },
      }).unwrap();
      onStarted(session, amountUsd);
    } catch {
      setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  // The amount steps down as it grows, so twelve digits and the unit still fit a phone.
  const size =
    amount.length > 11
      ? "[&_input]:text-3xl"
      : amount.length > 8
        ? "[&_input]:text-4xl"
        : "[&_input]:text-5xl";

  return (
    // Any change makes a different sale, so it gets its own key.
    <Form
      onSubmit={submit}
      onChange={() => (key.current = crypto.randomUUID())}
      noValidate
      aria-label={COPY.newSale}
      className="min-w-0"
    >
      <SaleCard
        step="amount"
        bar={
          <PhoneBar>
            {stores.length > 1 ? (
              <SelectMenu
                label={COPY.store}
                value={store}
                onValueChange={(value) => {
                  setStore(value);
                  key.current = crypto.randomUUID();
                }}
                options={stores.map((s) => ({ value: s.storeId, label: s.name, icon: StoreIcon }))}
              />
            ) : null}
          </PhoneBar>
        }
        foot={
          <>
            {formError ? <Notice tone={NOTICE_TONES.danger}>{formError}</Notice> : null}
            <fieldset aria-label={COPY.keypad} className={`${KEYPAD} min-w-0`}>
              {KEYS.map((k) => (
                // Out of the tab order: a keyboard types into the amount; touch and screen readers reach every key.
                <Button
                  key={k}
                  variant="ghost"
                  size="lg"
                  tabIndex={-1}
                  aria-label={k === "." ? COPY.point : undefined}
                  onMouseDown={keepFocus}
                  onClick={() => press(typeKey(amount, k))}
                  className={`${KEY} border border-line bg-surface-2`}
                >
                  <span className="text-2xl tabular-nums">{k}</span>
                </Button>
              ))}
              <Button
                variant="ghost"
                size="lg"
                tabIndex={-1}
                aria-label={COPY.delete}
                onMouseDown={keepFocus}
                onClick={() => press(amount.slice(0, -1))}
                className={KEY}
              >
                <Delete aria-hidden className="size-[var(--fw-icon-lg)] text-muted" />
              </Button>
            </fieldset>
            <Button type="submit" size="lg" loading={busy} className={`${KEY} w-full`}>
              {COPY.start}
              <QrIcon aria-hidden className="size-[var(--fw-icon-md)]" />
            </Button>
          </>
        }
      >
        <p aria-hidden className={AMOUNT_LABEL}>
          {COPY.amount}
        </p>
        <AmountField
          bare
          label={COPY.amount}
          name="amountUsd"
          unit={MONEY_COPY.usd}
          placeholder="0.00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          // The keypad types the amount: a phone's own keyboard would cover Show QR code.
          inputMode="none"
          // The page does one thing: a sale starts with its amount, and New sale lands back here.
          autoFocus
          error={error}
          // The figure at the size the customer reads at a step away, with a quieter unit.
          className={cx("w-full [&_input+span]:text-xl [&_input+span]:font-normal", size)}
        />
        {/* One button for both, so closing the sheet gives the focus back to it. */}
        <Button
          variant={note ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setDetails(true)}
          className="max-w-full"
        >
          {note ? (
            <>
              <Hash aria-hidden className="size-3.5 shrink-0 text-muted" />
              <span className="truncate">{note}</span>
              <Pencil aria-hidden className="size-3.5 shrink-0 text-subtle" />
            </>
          ) : (
            <>
              <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.details}
            </>
          )}
        </Button>
      </SaleCard>
      {/* Inside the form, so its fields are the form's; a closed dialog keeps them. */}
      <Sheet open={details} onOpenChange={setDetails} title={COPY.detailsTitle}>
        <div className="flex flex-col gap-4">
          <TextField
            label={COPY.reference}
            name="reference"
            hint={COPY.referenceHint}
            autoComplete="off"
            enterKeyHint="done"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            onKeyDown={doneOnEnter}
          />
          <TextField
            label={COPY.what}
            name="title"
            autoComplete="off"
            enterKeyHint="done"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={doneOnEnter}
          />
          <Button variant="secondary" className="mt-2 w-full" onClick={() => setDetails(false)}>
            {COPY.done}
          </Button>
        </div>
      </Sheet>
    </Form>
  );
}

/** A phone's bar on the amount: the way back first, Recent last; between them what the form puts there. */
function PhoneBar({ children }: { children?: ReactNode }) {
  return (
    <>
      <Link
        href={APP_ROUTES.home}
        aria-label={COPY.back}
        className={cx(buttonClasses({ variant: "ghost" }), "w-10 px-0! sm:hidden")}
      >
        <ArrowLeft aria-hidden className="size-[var(--fw-icon-md)]" />
      </Link>
      {children}
      {/* Recent checkouts sits under the sale on a phone, beside it from large screens. */}
      <Link
        href="#checkout-recent"
        className={cx(buttonClasses({ variant: "ghost" }), "ml-auto sm:hidden")}
      >
        <Clock aria-hidden className="size-[var(--fw-icon-sm)]" />
        {COPY.recentShort}
      </Link>
    </>
  );
}

/** The form until the stores load: the amount, the keys and the button, in the sale's own frame. */
export function CheckoutFormSkeleton() {
  return (
    <SaleCard
      step="amount"
      bar={<PhoneBar />}
      foot={
        <>
          <div className={KEYPAD}>
            {KEYS.map((k) => (
              <Skeleton key={k} className="h-14 rounded-lg!" />
            ))}
          </div>
          <Skeleton className="h-14 rounded-lg!" />
        </>
      }
    >
      <p aria-hidden className={AMOUNT_LABEL}>
        {COPY.amount}
      </p>
      <Skeleton className="h-16 w-48" />
    </SaleCard>
  );
}
