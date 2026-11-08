"use client";

import {
  ChoiceCard,
  DatePicker,
  formatTokenAmount,
  SelectField,
  SwitchCard,
  TextField,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { PencilLine, Power, Repeat, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FeeSummary } from "@/features/invoices/components/fee-summary";
import { formatDueDate, parseTokenAmount } from "@/features/invoices/lib/invoices";
import { useSaveLinkMutation } from "@/features/links/api/links-api";
import {
  AMOUNT_KINDS,
  LINK_LIMITS,
  LINK_SETUP_REQUIRED_CODE,
  USD_PATTERN,
} from "@/features/links/constants/links";
import { LINKS_COPY as COPY } from "@/features/links/constants/links-copy";
import { amountLabel, endsAtOf, invalidLinkField, linkAddress } from "@/features/links/lib/links";
import type {
  AmountKind,
  LinkBody,
  LinkField,
  Link as PaymentLink,
} from "@/features/links/types/links";
import { Payee } from "@/features/pay/components/payee";
import { FEES_PAID_BY } from "@/features/profiles/constants/profile";
import type { FeesPaidBy } from "@/features/profiles/types/profile";
import type { Store } from "@/features/stores/types/stores";
import { CopyValue } from "@/shared/components/copy-value";
import { FieldGroup } from "@/shared/components/field-group";
import { FormPreview, StepForm, useFormSteps } from "@/shared/components/step-form";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { exactDigits } from "@/shared/lib/money";

export interface LinkFormProps {
  profileId: string;
  link?: PaymentLink;
  /** A merchant's stores the user reaches; empty for a freelancer. */
  stores: readonly Store[];
  /** D-122: who pays the fees unless the link says otherwise, the profile's choice. */
  feesPaidBy?: FeesPaidBy;
}

const STEPS = { link: "link", amount: "amount", limits: "limits" } as const;
const FIELD_STEPS: Record<LinkField, string> = {
  title: STEPS.link,
  amountUsd: STEPS.amount,
  minUsd: STEPS.amount,
  maxUsd: STEPS.amount,
  maxPayments: STEPS.limits,
};

// A link's price is USD, which the stablecoins hold with 6 decimals (USDC, OUSD); the quote is in their units.
const PRICE_DECIMALS = 6;

// R-140: a new link's id is made once, so a retried save after an error makes one link.
export function LinkForm({
  profileId,
  link,
  stores,
  feesPaidBy = FEES_PAID_BY.owner,
}: LinkFormProps) {
  const [save] = useSaveLinkMutation();
  const toast = useToast();
  const router = useRouter();
  const linkId = useRef(link?.linkId ?? crypto.randomUUID());
  const [kind, setKind] = useState<AmountKind>(
    link && !link.amountUsd ? AMOUNT_KINDS.open : AMOUNT_KINDS.fixed,
  );
  const [store, setStore] = useState(link?.storeId ?? stores[0]?.storeId ?? "");
  const [endsAt, setEndsAt] = useState<string | null>(link?.endsAt ?? null);
  const [active, setActive] = useState(link?.active ?? true);
  const [clientPays, setClientPays] = useState(
    (link?.feesPaidBy ?? feesPaidBy) === FEES_PAID_BY.client,
  );
  // Off, the link takes one payment: a cap of 1.
  const [reusable, setReusable] = useState(link?.maxPayments !== 1);
  const [errors, setErrors] = useState<Partial<Record<LinkField, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const [typed, setTyped] = useState(() => ({
    title: link?.title ?? "",
    amountUsd: link?.amountUsd ?? "",
    minUsd: link?.minUsd ?? "",
    maxUsd: link?.maxUsd ?? "",
    maxPayments: link?.maxPayments && link.maxPayments !== 1 ? String(link.maxPayments) : "",
  }));
  const readTyped = (event: FormEvent<HTMLFormElement>) => {
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    setTyped({
      title: text("title"),
      amountUsd: text("amountUsd"),
      minUsd: text("minUsd"),
      maxUsd: text("maxUsd"),
      maxPayments: text("maxPayments"),
    });
  };
  const flow = useFormSteps([
    { id: STEPS.link, label: COPY.linkGroup },
    { id: STEPS.amount, label: COPY.amountGroup },
    { id: STEPS.limits, label: COPY.limitsGroup },
  ]);

  const read = (form: HTMLFormElement): LinkBody => {
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const usd = (name: string) => text(name) || null;
    const cap = text("maxPayments");
    return {
      title: text("title"),
      ...(store ? { storeId: store } : {}),
      amountUsd: kind === AMOUNT_KINDS.fixed ? usd("amountUsd") : null,
      minUsd: kind === AMOUNT_KINDS.open ? usd("minUsd") : null,
      maxUsd: kind === AMOUNT_KINDS.open ? usd("maxUsd") : null,
      endsAt,
      maxPayments: !reusable ? 1 : cap ? Number(cap) : null,
      active,
      feesPaidBy: clientPays ? FEES_PAID_BY.client : FEES_PAID_BY.owner,
    };
  };
  // Every problem the form has now, whichever step holds it.
  const problems = (form: HTMLFormElement) => {
    const body = read(form);
    const cap = String(new FormData(form).get("maxPayments") ?? "").trim();
    const shown: Partial<Record<LinkField, string>> = {};
    if (!body.title) shown.title = COPY.errors.required;
    if (kind === AMOUNT_KINDS.fixed && !body.amountUsd) shown.amountUsd = COPY.errors.amount;
    for (const field of ["amountUsd", "minUsd", "maxUsd"] as const) {
      const value = body[field];
      // R-56: every payment through the link asks for at least 1.00 USD.
      if (value !== null && (!USD_PATTERN.test(value) || Number(value) < 1))
        shown[field] = COPY.errors.amount;
    }
    if (body.minUsd && body.maxUsd && !shown.minUsd && Number(body.minUsd) > Number(body.maxUsd))
      shown.maxUsd = COPY.errors.range;
    // Off, the limit field stays mounted (it slides shut), and its value doesn't count.
    if (
      reusable &&
      cap &&
      (!/^\d+$/.test(cap) || Number(cap) < 1 || Number(cap) > LINK_LIMITS.maxPayments)
    )
      shown.maxPayments = COPY.errors.maxPayments;
    return shown;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = read(form);
    const shown = problems(form);
    flushSync(() => {
      setErrors(shown);
      setFormError("");
    });
    if (Object.keys(shown).length > 0) return flow.focusError(form);
    setBusy(true);
    try {
      await save({ profileId, linkId: linkId.current, body }).unwrap();
      toast({ tone: TONES.success, title: COPY.saved(body.title) });
      // A new link opens on its page, where its address is ready to copy.
      router.push(link ? APP_ROUTES.links : `${APP_ROUTES.links}/${linkId.current}`);
    } catch (error) {
      // A 422 names the field it refused, as the form's own checks would.
      const message =
        (error as { data?: { error?: { message?: string } } }).data?.error?.message ?? "";
      const field = invalidLinkField(message);
      if (field) {
        flushSync(() => setErrors({ [field]: COPY.errors.invalid[field] }));
        flow.focusError(form);
      } else if (
        (error as { data?: { error?: { code?: string } } }).data?.error?.code ===
        LINK_SETUP_REQUIRED_CODE
      ) {
        setFormError(COPY.errors.notReady);
      } else setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  const picked = stores.find((s) => s.storeId === store);
  const amount =
    kind === AMOUNT_KINDS.fixed
      ? typed.amountUsd && USD_PATTERN.test(typed.amountUsd)
        ? amountLabel({ amountUsd: typed.amountUsd, minUsd: null, maxUsd: null })
        : COPY.preview.noAmount
      : amountLabel({
          amountUsd: null,
          minUsd: USD_PATTERN.test(typed.minUsd) ? typed.minUsd : null,
          maxUsd: USD_PATTERN.test(typed.maxUsd) ? typed.maxUsd : null,
        });
  const limits = [
    endsAt ? COPY.preview.until(formatDueDate(endsAt.slice(0, 10))) : null,
    !reusable
      ? COPY.preview.once
      : /^\d+$/.test(typed.maxPayments)
        ? COPY.preview.cap(Number(typed.maxPayments))
        : null,
  ].filter(Boolean);
  return (
    <StepForm
      label={COPY.stepsLabel}
      flow={flow}
      editing={Boolean(link)}
      cancelHref={APP_ROUTES.links}
      copy={COPY}
      busy={busy}
      onContinue={(form) => {
        const here = Object.fromEntries(
          Object.entries(problems(form)).filter(
            ([field]) => FIELD_STEPS[field as LinkField] === flow.at,
          ),
        );
        flushSync(() => setErrors(here));
        if (Object.keys(here).length === 0) return true;
        flow.focusError(form);
        return false;
      }}
      onSubmit={submit}
      onInput={readTyped}
      error={formError}
      preview={
        <FormPreview title={COPY.preview.title} note={COPY.preview.note}>
          <div className="flex flex-col gap-4 rounded-md bg-surface p-5 shadow-sm ring-1 ring-line">
            <Payee
              as="p"
              name={picked?.name ?? (typed.title || COPY.preview.noTitle)}
              subtitle={COPY.preview.subtitle}
              brand={
                picked
                  ? { storeId: picked.storeId, color: picked.brandColor, logoAt: picked.logoAt }
                  : null
              }
            />
            <div className="flex flex-col gap-1 border-t border-line pt-4">
              {picked ? (
                <p
                  className={`font-medium break-words ${typed.title ? "text-ink" : "text-subtle"}`}
                >
                  {typed.title || COPY.preview.noTitle}
                </p>
              ) : null}
              <p className="text-2xl font-medium tracking-tight text-ink tabular-nums">{amount}</p>
            </div>
            {limits.length || !active ? (
              <p className="border-t border-line pt-4 text-sm text-muted">
                {active ? limits.join(" · ") : COPY.preview.off}
              </p>
            ) : null}
          </div>
        </FormPreview>
      }
    >
      <div data-step={STEPS.link} className={flow.shows(STEPS.link)}>
        <FieldGroup title={COPY.linkGroup}>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label={COPY.linkTitle}
              name="title"
              autoComplete="off"
              defaultValue={link?.title}
              maxLength={LINK_LIMITS.title}
              hint={COPY.titleHint}
              error={errors.title}
            />
            {stores.length > 0 ? (
              <SelectField
                label={COPY.store}
                value={store}
                disabled={!!link}
                onValueChange={setStore}
                options={stores.map((s) => ({ value: s.storeId, label: s.name }))}
              />
            ) : null}
          </div>
          {link ? (
            <CopyValue
              label={COPY.address}
              // The app renders only in the browser, after sign-in.
              value={linkAddress(window.location.origin, link.slug)}
              hint={COPY.addressHint}
              copyLabel={COPY.copyLabel}
            />
          ) : null}
        </FieldGroup>
      </div>
      <div data-step={STEPS.amount} className={flow.shows(STEPS.amount)}>
        <FieldGroup title={COPY.amountGroup}>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">{COPY.amountKind}</legend>
            <ChoiceCard
              type="radio"
              name="amountKind"
              value={AMOUNT_KINDS.fixed}
              checked={kind === AMOUNT_KINDS.fixed}
              onChange={() => setKind(AMOUNT_KINDS.fixed)}
              icon={Tag}
              title={COPY.fixedKind}
              hint={COPY.fixedHint}
            />
            <ChoiceCard
              type="radio"
              name="amountKind"
              value={AMOUNT_KINDS.open}
              checked={kind === AMOUNT_KINDS.open}
              onChange={() => setKind(AMOUNT_KINDS.open)}
              icon={PencilLine}
              title={COPY.openKind}
              hint={COPY.openHint}
            />
          </fieldset>
          {kind === AMOUNT_KINDS.fixed ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label={COPY.amount}
                name="amountUsd"
                inputMode="decimal"
                autoComplete="off"
                defaultValue={link?.amountUsd ?? ""}
                hint={COPY.usdHint}
                error={errors.amountUsd}
              />
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label={COPY.min}
                id="link-min"
                name="minUsd"
                aria-describedby={errors.minUsd ? "link-min-error link-usd-hint" : "link-usd-hint"}
                inputMode="decimal"
                autoComplete="off"
                defaultValue={link?.minUsd ?? ""}
                error={errors.minUsd}
              />
              <TextField
                label={COPY.max}
                id="link-max"
                name="maxUsd"
                aria-describedby={errors.maxUsd ? "link-max-error link-usd-hint" : "link-usd-hint"}
                inputMode="decimal"
                autoComplete="off"
                defaultValue={link?.maxUsd ?? ""}
                error={errors.maxUsd}
              />
              <p id="link-usd-hint" className="text-sm text-muted sm:col-span-2">
                {COPY.usdHint}
              </p>
            </div>
          )}
          {/* R-227: an open link's payer chooses the price, so it shows the fee alone; the lowest price prices it. */}
          <FeeSummary
            profileId={profileId}
            storeId={store || undefined}
            any
            chainId={0}
            token=""
            units={(() => {
              const units = parseTokenAmount(
                kind === AMOUNT_KINDS.fixed ? typed.amountUsd : typed.minUsd || "1",
                PRICE_DECIMALS,
              );
              return typeof units === "string" ? 0n : units;
            })()}
            decimals={PRICE_DECIMALS}
            clientPays={clientPays}
            onClientPays={setClientPays}
            money={(units) =>
              `${formatTokenAmount({ baseUnits: units, decimals: PRICE_DECIMALS, fractionDigits: Math.max(2, exactDigits(units, PRICE_DECIMALS)) })} ${MONEY_COPY.usd}`
            }
            feeOnly={kind === AMOUNT_KINDS.open}
          />
        </FieldGroup>
      </div>
      <div data-step={STEPS.limits} className={flow.shows(STEPS.limits)}>
        <FieldGroup title={COPY.limitsGroup}>
          <SwitchCard
            icon={<Repeat />}
            title={COPY.reusable}
            description={reusable ? COPY.reusableOn : COPY.reusableOff}
            checked={reusable}
            onCheckedChange={setReusable}
          >
            {/* Empty is no limit. */}
            <TextField
              label={COPY.maxPayments}
              name="maxPayments"
              inputMode="numeric"
              autoComplete="off"
              placeholder={COPY.unlimited}
              defaultValue={typed.maxPayments}
              hint={COPY.maxPaymentsHint}
              error={errors.maxPayments}
              inline
            />
          </SwitchCard>
          <DatePicker
            label={COPY.endsOn}
            value={endsAt?.slice(0, 10) ?? null}
            onChange={(day) => setEndsAt(day ? endsAtOf(day) : null)}
            hint={COPY.endsOnHint}
            clearLabel={COPY.clearDate}
            className="sm:max-w-80"
          />
          <SwitchCard
            icon={<Power />}
            title={COPY.active}
            description={COPY.activeHint}
            checked={active}
            onCheckedChange={setActive}
          />
        </FieldGroup>
      </div>
    </StepForm>
  );
}
