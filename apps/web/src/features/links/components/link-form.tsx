"use client";

import {
  Button,
  buttonClasses,
  Checkbox,
  ChoiceCard,
  DatePicker,
  Form,
  SelectField,
  TextField,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { PencilLine, Tag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSaveLinkMutation } from "@/features/links/api/links-api";
import {
  AMOUNT_KINDS,
  LINK_LIMITS,
  LINK_SETUP_REQUIRED_CODE,
  USD_PATTERN,
} from "@/features/links/constants/links";
import { LINKS_COPY as COPY } from "@/features/links/constants/links-copy";
import { endsAtOf, invalidLinkField, linkAddress } from "@/features/links/lib/links";
import type {
  AmountKind,
  LinkBody,
  LinkField,
  Link as PaymentLink,
} from "@/features/links/types/links";
import type { Store } from "@/features/stores/types/stores";
import { CopyValue } from "@/shared/components/copy-value";
import { FieldGroup } from "@/shared/components/field-group";
import { APP_ROUTES } from "@/shared/config/routes";

export interface LinkFormProps {
  profileId: string;
  link?: PaymentLink;
  /** A merchant's stores the user reaches; empty for a freelancer. */
  stores: readonly Store[];
}

// R-140: a new link's id is made once, so a retried save after an error makes one link.
export function LinkForm({ profileId, link, stores }: LinkFormProps) {
  const [save] = useSaveLinkMutation();
  const toast = useToast();
  const router = useRouter();
  const linkId = useRef(link?.linkId ?? crypto.randomUUID());
  const [kind, setKind] = useState<AmountKind>(
    link && !link.amountUsd ? AMOUNT_KINDS.open : AMOUNT_KINDS.fixed,
  );
  const [store, setStore] = useState(link?.storeId ?? stores[0]?.storeId ?? "");
  const [endsOn, setEndsOn] = useState<string | null>(link?.endsAt?.slice(0, 10) ?? null);
  const [active, setActive] = useState(link?.active ?? true);
  const [errors, setErrors] = useState<Partial<Record<LinkField, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const usd = (name: string) => text(name) || null;
    const cap = text("maxPayments");
    const body: LinkBody = {
      title: text("title"),
      ...(store ? { storeId: store } : {}),
      amountUsd: kind === AMOUNT_KINDS.fixed ? usd("amountUsd") : null,
      minUsd: kind === AMOUNT_KINDS.open ? usd("minUsd") : null,
      maxUsd: kind === AMOUNT_KINDS.open ? usd("maxUsd") : null,
      endsAt: endsOn ? endsAtOf(endsOn) : null,
      maxPayments: cap ? Number(cap) : null,
      active,
    };
    const shown: Partial<Record<LinkField, string>> = {};
    if (!body.title) shown.title = COPY.errors.required;
    if (kind === AMOUNT_KINDS.fixed && !body.amountUsd) shown.amountUsd = COPY.errors.amount;
    for (const field of ["amountUsd", "minUsd", "maxUsd"] as const) {
      const value = body[field];
      if (value !== null && (!USD_PATTERN.test(value) || Number(value) === 0))
        shown[field] = COPY.errors.amount;
    }
    if (body.minUsd && body.maxUsd && !shown.minUsd && Number(body.minUsd) > Number(body.maxUsd))
      shown.maxUsd = COPY.errors.range;
    if (cap && (!/^\d+$/.test(cap) || Number(cap) < 1 || Number(cap) > LINK_LIMITS.maxPayments))
      shown.maxPayments = COPY.errors.maxPayments;
    flushSync(() => {
      setErrors(shown);
      setFormError("");
    });
    if (Object.keys(shown).length > 0) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
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
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      } else if (
        (error as { data?: { error?: { code?: string } } }).data?.error?.code ===
        LINK_SETUP_REQUIRED_CODE
      ) {
        setFormError(COPY.errors.notReady);
      } else setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={submit} noValidate>
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
      </FieldGroup>
      <FieldGroup title={COPY.limitsGroup}>
        <div className="grid gap-5 sm:grid-cols-2">
          <DatePicker
            label={COPY.endsOn}
            value={endsOn}
            onChange={setEndsOn}
            hint={COPY.endsOnHint}
            clearLabel={COPY.clearDate}
          />
          <TextField
            label={COPY.maxPayments}
            name="maxPayments"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={link?.maxPayments ?? ""}
            hint={COPY.maxPaymentsHint}
            error={errors.maxPayments}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Checkbox
            label={COPY.active}
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <p className="text-sm text-muted">{COPY.activeHint}</p>
        </div>
      </FieldGroup>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Button type="submit" loading={busy}>
          {COPY.save}
        </Button>
        <Link href={APP_ROUTES.links} className={buttonClasses({ variant: "ghost" })}>
          {COPY.cancel}
        </Link>
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </Form>
  );
}
