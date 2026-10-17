import type { Client, ClientBody, SavedClientBody } from "@/features/clients/types/clients";
import { countryOptions } from "@/features/profiles/lib/billing-details";

const FIELDS: (keyof SavedClientBody)[] = [
  "name",
  "email",
  "address",
  "country",
  "taxId",
  "reference",
];

/** A saved client as form values: a field it doesn't have is empty. */
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
export function invalidClientField(message: string): keyof SavedClientBody | null {
  const name = message.split(": ")[1]?.split(" ")[0];
  return FIELDS.find((field) => field === name) ?? null;
}

/** Every country the API accepts by English name, after the empty choice for none. */
export function clientCountryOptions(noCountry: string): { value: string; label: string }[] {
  return [{ value: "", label: noCountry }, ...countryOptions()];
}

// Lower case without accents, as the search selects compare, so "zur" finds Zürich here too.
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Whether a client matches the list's search: its name, email or tax ID, ignoring case and accents. */
export function matchesClient(client: Client, search: string): boolean {
  return fold(`${client.name} ${client.email ?? ""} ${client.taxId ?? ""}`).includes(
    fold(search.trim()),
  );
}
