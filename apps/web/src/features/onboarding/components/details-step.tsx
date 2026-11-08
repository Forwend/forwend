"use client";

import { ComboboxField, TextAreaField, TextField } from "@forwend/ui-web";
import { useMemo } from "react";
import { InvoiceDocument } from "@/features/invoices/components/invoice-document";
import { NEW_INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import { documentDate } from "@/features/invoices/lib/invoice-document";
import { FIRST_RUN_COPY } from "@/features/onboarding/constants/onboarding-copy";
import type { ProfileDetails } from "@/features/onboarding/types/onboarding";
import { BILLING_LIMITS } from "@/features/profiles/constants/billing-details";
import { PROFILE_KINDS, PROFILE_NAME_MAX } from "@/features/profiles/constants/profile";
import { countryOptions } from "@/features/profiles/lib/billing-details";

const COPY = FIRST_RUN_COPY.details;
const PREVIEW = NEW_INVOICE_COPY.preview;

export type DetailsField = keyof ProfileDetails | "website";

export interface DetailsStepProps {
  kind: typeof PROFILE_KINDS.freelancer | typeof PROFILE_KINDS.merchant;
  value: ProfileDetails;
  onChange: (field: keyof ProfileDetails, value: string) => void;
  /** Only when the user builds with the API: the store's first allowed origin. */
  website?: { value: string; onChange: (value: string) => void };
  errors: Partial<Record<DetailsField, string>>;
}

/** Who gets paid: the profile's name and the billing details its invoices print (billing details need all four). */
export function DetailsStep({ kind, value, onChange, website, errors }: DetailsStepProps) {
  const text = COPY[kind];
  const countries = useMemo(countryOptions, []);
  return (
    <div className="flex flex-col gap-5">
      <TextField
        label={text.name}
        name="name"
        autoComplete={kind === PROFILE_KINDS.merchant ? "organization" : "name"}
        value={value.name}
        onChange={(event) => onChange("name", event.target.value)}
        maxLength={Math.min(PROFILE_NAME_MAX, BILLING_LIMITS.name)}
        error={errors.name}
      />
      <TextField
        label={COPY.email}
        name="email"
        type="email"
        autoComplete="email"
        value={value.email}
        onChange={(event) => onChange("email", event.target.value)}
        maxLength={BILLING_LIMITS.email}
        error={errors.email}
      />
      <ComboboxField
        id={`onboarding-${kind}-country`}
        label={COPY.country}
        placeholder={COPY.countryPlaceholder}
        searchLabel={COPY.searchCountries}
        options={countries}
        value={value.country}
        onValueChange={(country) => onChange("country", country)}
        error={errors.country}
      />
      <TextAreaField
        label={COPY.address}
        name="address"
        autoComplete="street-address"
        rows={2}
        value={value.address}
        onChange={(event) => onChange("address", event.target.value)}
        maxLength={BILLING_LIMITS.address}
        error={errors.address}
      />
      {website ? (
        <TextField
          label={COPY.website}
          name="website"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder={COPY.websitePlaceholder}
          value={website.value}
          onChange={(event) => website.onChange(event.target.value)}
          error={errors.website}
        />
      ) : null}
    </div>
  );
}

/** The invoice these details make, drawn as the PDF draws it; the client and items are an example. */
export function DetailsPreview({
  kind,
  value,
  testnet,
}: Pick<DetailsStepProps, "kind" | "value"> & { testnet: boolean }) {
  const countries = useMemo(countryOptions, []);
  const country = countries.find((option) => option.value === value.country)?.label ?? "";
  const sample = COPY.sample;
  const today = new Date();
  const due = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
  const day = (date: Date) => documentDate(date.toISOString().slice(0, 10));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{COPY.preview}</p>
      <InvoiceDocument
        label={COPY.previewLabel}
        kind="Invoice"
        number={sample.number}
        reference=""
        testnet={testnet}
        status={{
          label: PREVIEW.waiting,
          detail: "",
          figure: PREVIEW.amountDue,
          amount: sample.total,
        }}
        from={{
          name: value.name.trim() || COPY[kind].previewName,
          lines: [value.address, country, value.email],
        }}
        to={sample.client}
        facts={[
          [PREVIEW.issued, day(today)],
          [PREVIEW.due, day(due)],
        ]}
        title={sample.title}
        lines={sample.lines}
        totals={[[PREVIEW.total, sample.total]]}
        note=""
        pay={[PREVIEW.payAny(sample.total), PREVIEW.payPick]}
      />
      <p className="text-xs text-subtle">{COPY.sampleNote}</p>
    </div>
  );
}
