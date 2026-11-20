import type { ComboboxOption } from "@forwend/ui-web";
import { CLIENT_KINDS } from "@/features/clients/constants/clients";
import type { Client, ClientBody, ClientKind } from "@/features/clients/types/clients";
import { countryOptions } from "@/shared/lib/countries";

/** The API keeps no kind: a saved client with only a name and email reads as a person. */
export function clientKind(client: Client | undefined): ClientKind {
  return client && !client.address && !client.country && !client.taxId
    ? CLIENT_KINDS.person
    : CLIENT_KINDS.business;
}

export function clientBody(client: Client): ClientBody {
  return {
    name: client.name,
    email: client.email ?? "",
    address: client.address ?? "",
    country: client.country ?? "",
    taxId: client.taxId ?? "",
  };
}

export function clientCountryOptions(noCountry: string): { value: string; label: string }[] {
  return [{ value: "", label: noCountry }, ...countryOptions()];
}

export function clientOptions(clients: readonly Client[]): ComboboxOption[] {
  return clients.map((c) => ({ value: c.clientId, label: c.name, detail: c.email ?? undefined }));
}
