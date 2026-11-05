import { BILLING_DETAILS_COPY } from "@/features/profiles/constants/profiles-copy";
import type { BillingDetailsBody } from "@/features/profiles/types/billing-details";

// The assigned ISO 3166-1 alpha-2 codes the API accepts (internal/profile/billing.go).
const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT " +
  "BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ " +
  "FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS " +
  "IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN " +
  "MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW " +
  "PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN " +
  "TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const FIELDS: (keyof BillingDetailsBody)[] = ["name", "address", "country", "taxId", "email"];

/** The field a refused save names: the API's message reads "invalid profile request: email must be …". */
export function invalidBillingField(message: string): keyof BillingDetailsBody | null {
  const name = message.split(": ")[1]?.split(" ")[0];
  return FIELDS.find((field) => field === name) ?? null;
}

export function countryOptions(): { value: string; label: string }[] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return COUNTRY_CODES.map((code) => ({ value: code, label: names.of(code) ?? code })).sort(
    (a, b) => a.label.localeCompare(b.label),
  );
}

/** The fields a body leaves empty or malformed, with the message each shows; the API checks the rest (R-50, the
 * billing details page and the first run share it). */
export function billingErrors(
  body: BillingDetailsBody,
): Partial<Record<keyof BillingDetailsBody, string>> {
  const shown: Partial<Record<keyof BillingDetailsBody, string>> = {};
  for (const field of ["name", "address", "email"] as const) {
    if (!body[field]) shown[field] = BILLING_DETAILS_COPY.errors.required;
  }
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
    shown.email = BILLING_DETAILS_COPY.errors.email;
  if (!body.country) shown.country = BILLING_DETAILS_COPY.errors.country;
  return shown;
}
