"use client";

import { Button, SelectField, TextAreaField, TextField, TONES, useToast } from "@forwend/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  BILLING_LIMITS,
  type BillingDetails,
  type BillingDetailsBody,
  countryOptions,
} from "@/features/profiles/billing-details";
import { useSaveBillingDetailsMutation } from "@/features/profiles/profiles-api";
import { BILLING_DETAILS_COPY as COPY } from "@/features/profiles/profiles-copy";
import { APP_ROUTES } from "@/shared/config/routes";

type Field = keyof BillingDetailsBody;

const COUNTRY_ID = "billing-country";

// R-43: one PUT replaces every field; the API checks them again.
export function BillingDetailsForm({
  profileId,
  saved,
}: {
  profileId: string;
  saved: BillingDetails | null;
}) {
  const [save] = useSaveBillingDetailsMutation();
  const toast = useToast();
  const router = useRouter();
  const countries = useMemo(countryOptions, []);
  const [country, setCountry] = useState(saved?.country ?? "");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = (name: Field) => String(new FormData(form).get(name) ?? "").trim();
    const body: BillingDetailsBody = {
      name: value("name"),
      address: value("address"),
      country,
      taxId: value("taxId") || null,
      email: value("email"),
    };
    const shown: Partial<Record<Field, string>> = {};
    for (const field of ["name", "address", "email"] as const) {
      if (!body[field]) shown[field] = COPY.errors.required;
    }
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
      shown.email = COPY.errors.email;
    // The select has no error state of its own: a missing country is named in the form's alert.
    flushSync(() => {
      setErrors(shown);
      setFormError(country ? "" : COPY.errors.country);
    });
    if (Object.keys(shown).length > 0 || !country) {
      (
        form.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        document.getElementById(COUNTRY_ID)
      )?.focus();
      return;
    }
    setBusy(true);
    try {
      await save({ profileId, body }).unwrap();
      toast({ tone: TONES.success, title: COPY.saved });
      router.push(APP_ROUTES.home);
    } catch {
      setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <TextField
        label={COPY.name}
        name="name"
        autoComplete="organization"
        defaultValue={saved?.name}
        maxLength={BILLING_LIMITS.name}
        error={errors.name}
      />
      <TextAreaField
        label={COPY.address}
        name="address"
        autoComplete="street-address"
        defaultValue={saved?.address}
        maxLength={BILLING_LIMITS.address}
        error={errors.address}
      />
      <SelectField
        id={COUNTRY_ID}
        label={COPY.country}
        placeholder={COPY.countryPlaceholder}
        options={countries}
        value={country}
        onValueChange={setCountry}
      />
      <TextField
        label={COPY.taxId}
        name="taxId"
        defaultValue={saved?.taxId ?? ""}
        maxLength={BILLING_LIMITS.taxId}
      />
      <TextField
        label={COPY.email}
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={saved?.email}
        maxLength={BILLING_LIMITS.email}
        error={errors.email}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy}>
          {COPY.save}
        </Button>
        <Link
          href={APP_ROUTES.home}
          className="rounded-pill px-3 py-2 text-sm text-muted hover:text-ink"
        >
          {COPY.cancel}
        </Link>
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </form>
  );
}
