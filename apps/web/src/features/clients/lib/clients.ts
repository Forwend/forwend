import { NO_COUNTRY } from "@/features/clients/constants/clients";
import type { Client, ClientBody } from "@/features/clients/types/clients";
import { countryOptions } from "@/features/profiles/lib/billing-details";

const FIELDS: (keyof ClientBody)[] = ["name", "email", "address", "country", "taxId"];

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
export function invalidClientField(message: string): keyof ClientBody | null {
  const name = message.split(": ")[1]?.split(" ")[0];
  return FIELDS.find((field) => field === name) ?? null;
}

/** Every country the API accepts by English name, after a choice for none. */
export function clientCountryOptions(noCountry: string): { value: string; label: string }[] {
  return [{ value: NO_COUNTRY, label: noCountry }, ...countryOptions()];
}
