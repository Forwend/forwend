import type { ComboboxOption } from "@forwend/ui-web";
import { CLIENT_KINDS } from "@/features/clients/constants/clients";
import type {
  Client,
  ClientBody,
  ClientKind,
  ClientTextField,
} from "@/features/clients/types/clients";
import { countryOptions } from "@/features/profiles/lib/billing-details";

const FIELDS: ClientTextField[] = ["name", "email", "address", "country", "taxId", "reference"];
const COUNTRY = new Intl.DisplayNames(undefined, { type: "region" });
// A long client list asks for the same few countries on every render.
const COUNTRY_NAMES = new Map<string, string>();

export function countryName(code: string | null): string | null {
  if (!code) return null;
  let name = COUNTRY_NAMES.get(code);
  if (name === undefined) {
    name = COUNTRY.of(code) ?? code;
    COUNTRY_NAMES.set(code, name);
  }
  return name;
}

/** The API keeps no kind, so a saved client with only a name and email reads as a person; the form can switch. */
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

/** The field a refused save names: the API's message reads "invalid profile request: email must be …". */
export function invalidClientField(message: string): ClientTextField | null {
  const name = message.split(": ")[1]?.split(" ")[0];
  return FIELDS.find((field) => field === name) ?? null;
}

export function clientCountryOptions(noCountry: string): { value: string; label: string }[] {
  return [{ value: "", label: noCountry }, ...countryOptions()];
}

/** A client picker's options: the matches, each with its email under the name. */
export function clientOptions(clients: readonly Client[]): ComboboxOption[] {
  return clients.map((c) => ({ value: c.clientId, label: c.name, detail: c.email ?? undefined }));
}
