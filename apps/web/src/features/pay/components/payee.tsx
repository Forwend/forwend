import Image from "next/image";
import { storeLogoUrl } from "@/features/stores/lib/stores";
import type { StoreBrand } from "@/features/stores/types/stores";

export interface PayeeProps {
  /** Who asks for the money; the page's heading. */
  name: string;
  /** What the payer pays: the invoice and its number, or the payment link. */
  subtitle: string;
  /** A merchant store's branding (R-135). */
  brand?: StoreBrand | null;
  /** The name's element: a preview inside another page names no page. */
  as?: "h1" | "p";
}

/** Who asks, at the top of a checkout: the store's logo or the name's initial, then the name. */
export function Payee({ name, subtitle, brand, as: Name = "h1" }: PayeeProps) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {/* R-135: a merchant store's logo, edged in its color. The color is never behind text, so contrast holds.
          The box stays light in both themes: most logos are drawn for a light page. */}
      {brand?.logoAt ? (
        <span
          aria-hidden
          data-theme="light"
          className="grid h-10 max-w-40 shrink-0 place-items-center rounded-md border border-line bg-surface px-1.5 sm:h-11"
          style={brand.color ? { borderColor: brand.color } : undefined}
        >
          <Image
            src={storeLogoUrl(brand.storeId, brand.logoAt)}
            alt=""
            width={152}
            height={36}
            unoptimized
            className="h-7 w-auto max-w-36 object-contain sm:h-8"
          />
        </span>
      ) : (
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-md border border-line bg-surface text-base font-semibold text-ink sm:size-11 sm:text-lg"
          style={brand?.color ? { borderColor: brand.color } : undefined}
        >
          {name.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Name className="text-lg font-semibold break-words text-ink sm:text-xl">{name}</Name>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>
    </div>
  );
}
