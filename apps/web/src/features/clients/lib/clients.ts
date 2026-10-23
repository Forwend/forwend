import type { Client, ClientBody, ClientTextField } from "@/features/clients/types/clients";
import { countryOptions } from "@/features/profiles/lib/billing-details";
import { foldText } from "@/shared/lib/search";

const FIELDS: ClientTextField[] = ["name", "email", "address", "country", "taxId", "reference"];

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

export function matchesClient(client: Client, search: string): boolean {
  return foldText(`${client.name} ${client.email ?? ""} ${client.taxId ?? ""}`).includes(
    foldText(search.trim()),
  );
}
