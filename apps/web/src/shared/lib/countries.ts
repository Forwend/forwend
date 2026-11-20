import { COUNTRY_CODES } from "@/shared/constants/countries";

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

export function countryOptions(): { value: string; label: string }[] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return COUNTRY_CODES.map((code) => ({ value: code, label: names.of(code) ?? code })).sort(
    (a, b) => a.label.localeCompare(b.label),
  );
}
