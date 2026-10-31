import { linkUrl, payUrl } from "@forwend/js";
import type { AnchorHTMLAttributes } from "react";

export type PayButtonProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  baseUrl?: string;
} & ({ payToken: string; linkSlug?: never } | { linkSlug: string; payToken?: never });

/** A plain link to the hosted checkout or a payment link: it works with no script, and you style it. */
export function PayButton({ payToken, linkSlug, baseUrl, children, ...anchor }: PayButtonProps) {
  return (
    <a
      {...anchor}
      href={payToken !== undefined ? payUrl(payToken, baseUrl) : linkUrl(linkSlug ?? "", baseUrl)}
    >
      {children ?? "Pay with stablecoins"}
    </a>
  );
}
