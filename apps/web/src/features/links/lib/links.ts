import { LINK_STATES } from "@/features/links/constants/links";
import { LINKS_COPY as COPY } from "@/features/links/constants/links-copy";
import type { Link, LinkField, LinkState } from "@/features/links/types/links";

const FIELDS: LinkField[] = ["title", "amountUsd", "minUsd", "maxUsd", "maxPayments"];

/** Off first, then past its last day, then at its cap (R-140). */
export function linkState(link: Link, now: number): LinkState {
  if (!link.active) return LINK_STATES.off;
  if (link.endsAt && Date.parse(link.endsAt) < now) return LINK_STATES.ended;
  if (link.maxPayments !== null && link.paid >= link.maxPayments) return LINK_STATES.full;
  return LINK_STATES.on;
}

/** The link's amount as the list shows it: fixed, or the payer's range (D-94). */
export function amountLabel(link: Pick<Link, "amountUsd" | "minUsd" | "maxUsd">): string {
  if (link.amountUsd) return COPY.fixed(link.amountUsd);
  if (link.minUsd && link.maxUsd) return COPY.range(link.minUsd, link.maxUsd);
  if (link.minUsd) return COPY.from(link.minUsd);
  if (link.maxUsd) return COPY.upTo(link.maxUsd);
  return COPY.anyAmount;
}

/** The field a refused save names: the API's message reads "invalid payment link request: title must …". */
export function invalidLinkField(message: string): LinkField | null {
  const name = message.split(": ")[1]?.split(" ")[0];
  return FIELDS.find((field) => field === name) ?? null;
}

/** The address a payer opens. */
export function linkAddress(origin: string, slug: string): string {
  return `${origin}/l/${slug}`;
}

/** The last day a link works, as the API keeps it: its end, the day's last second in UTC. */
export function endsAtOf(day: string): string {
  return `${day}T23:59:59Z`;
}
