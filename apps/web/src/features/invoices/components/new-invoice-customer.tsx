"use client";

import { ComboboxField, SegmentedControl, TextAreaField, TextField } from "@forwend/ui-web";
import { useMemo } from "react";
import { CLIENT_KINDS } from "@/features/clients/constants/clients";
import type { ClientSearch } from "@/features/clients/hooks/use-client-search";
import { clientCountryOptions, clientOptions } from "@/features/clients/lib/clients";
import type { Client, ClientBody, ClientKind } from "@/features/clients/types/clients";
import { INVOICE_FIELDS, INVOICE_LIMITS } from "@/features/invoices/constants/invoices";
import { NEW_INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import type { InvoiceField } from "@/features/invoices/types/invoices";
import { FieldGroup } from "@/shared/components/field-group";

export interface NewInvoiceCustomerProps {
  clientSearch?: ClientSearch;
  fill: { key: string; client: ClientBody };
  kind: ClientKind;
  onKind: (kind: ClientKind) => void;
  country: string;
  onCountry: (country: string) => void;
  onPick: (client: Client) => void;
  errors: Partial<Record<InvoiceField, string>>;
  clear: (field: InvoiceField) => void;
}

/** A person is billed by name and email; only a business has a tax ID. */
export function NewInvoiceCustomer({
  clientSearch,
  fill,
  kind,
  onKind,
  country,
  onCountry,
  onPick,
  errors,
  clear,
}: NewInvoiceCustomerProps) {
  const countries = useMemo(() => clientCountryOptions(COPY.noCountry), []);
  return (
    <FieldGroup title={COPY.client}>
      {clientSearch?.any ? (
        <ComboboxField
          label={COPY.savedClient}
          placeholder={COPY.savedClientPlaceholder}
          searchLabel={COPY.searchClients}
          options={clientOptions(clientSearch.clients)}
          valueLabel={fill.client.name}
          loading={clientSearch.pending}
          noResults={clientSearch.failed ? COPY.clientsFailed : undefined}
          onSearchChange={clientSearch.search}
          value={fill.key}
          onValueChange={(clientId) => {
            const picked = clientSearch.clients.find((c) => c.clientId === clientId);
            if (picked) onPick(picked);
          }}
        />
      ) : null}
      <div className="flex flex-col gap-1.5">
        <p aria-hidden className="text-sm font-medium text-ink">
          {COPY.clientKind}
        </p>
        <SegmentedControl
          label={COPY.clientKind}
          value={kind}
          onValueChange={(next) => {
            onKind(next);
            clear(INVOICE_FIELDS.clientCountry);
            clear(INVOICE_FIELDS.clientTaxId);
          }}
          className="self-start"
          options={Object.values(CLIENT_KINDS).map((value) => ({
            value,
            label: COPY.clientKinds[value],
          }))}
        />
      </div>
      <div key={fill.key} className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label={kind === CLIENT_KINDS.business ? COPY.clientLegalName : COPY.clientPersonName}
            hint={kind === CLIENT_KINDS.business ? COPY.clientLegalNameHint : undefined}
            name="clientName"
            defaultValue={fill.client.name}
            autoComplete="off"
            maxLength={INVOICE_LIMITS.clientName}
            error={errors[INVOICE_FIELDS.clientName]}
            onChange={() => clear(INVOICE_FIELDS.clientName)}
          />
          <TextField
            type="email"
            label={COPY.clientEmail}
            name="clientEmail"
            defaultValue={fill.client.email}
            autoComplete="off"
            maxLength={INVOICE_LIMITS.clientEmail}
            error={errors[INVOICE_FIELDS.clientEmail]}
            onChange={() => {
              clear(INVOICE_FIELDS.clientEmail);
              // A name or an email is enough: typing either answers the missing-client error.
              if (errors[INVOICE_FIELDS.clientName] === COPY.missingClient)
                clear(INVOICE_FIELDS.clientName);
            }}
          />
        </div>
        <TextAreaField
          label={COPY.clientAddress}
          name="clientAddress"
          defaultValue={fill.client.address}
          maxLength={INVOICE_LIMITS.clientAddress}
          error={errors[INVOICE_FIELDS.clientAddress]}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <ComboboxField
            label={COPY.clientCountry}
            options={countries}
            placeholder={COPY.noCountry}
            searchLabel={COPY.searchCountries}
            value={country}
            onValueChange={(next) => {
              onCountry(next);
              clear(INVOICE_FIELDS.clientCountry);
            }}
            error={errors[INVOICE_FIELDS.clientCountry]}
          />
          {kind === CLIENT_KINDS.person ? null : (
            <TextField
              label={COPY.clientTaxId}
              name="clientTaxId"
              defaultValue={fill.client.taxId}
              autoComplete="off"
              maxLength={INVOICE_LIMITS.clientTaxId}
              error={errors[INVOICE_FIELDS.clientTaxId]}
            />
          )}
        </div>
      </div>
    </FieldGroup>
  );
}
