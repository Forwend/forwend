"use client";

import {
  Button,
  Form,
  SelectField,
  TextAreaField,
  TextField,
  TONES,
  useToast,
} from "@forwend/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useSaveBillingDetailsMutation } from "@/features/profiles/api/profiles-api";
import { BILLING_LIMITS } from "@/features/profiles/constants/billing-details";
import { BILLING_DETAILS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import { countryOptions } from "@/features/profiles/lib/billing-details";
import type { BillingDetails, BillingDetailsBody } from "@/features/profiles/types/billing-details";
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
    if (!country) shown.country = COPY.errors.country;
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
      await save({ profileId, body }).unwrap();
      toast({ tone: TONES.success, title: COPY.saved });
      router.push(APP_ROUTES.home);
    } catch {
      setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={submit} gap="md">
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
        onValueChange={(value) => {
          setCountry(value);
          setErrors((current) => ({ ...current, country: undefined }));
        }}
        error={errors.country}
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
          className="inline-flex h-11 items-center rounded-pill px-3 text-sm text-muted hover:text-ink"
        >
          {COPY.cancel}
        </Link>
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </Form>
  );
}
