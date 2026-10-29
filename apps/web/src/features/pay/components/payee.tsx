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
  /** A logo not saved yet, as a form previews it. */
  logoSrc?: string | null;
}

/** Who asks, at the top of a checkout: the store's logo or the name's initial, then the name. */
export function Payee({ name, subtitle, brand, as: Name = "h1", logoSrc }: PayeeProps) {
  const src = logoSrc ?? (brand?.logoAt ? storeLogoUrl(brand.storeId, brand.logoAt) : null);
  return (
    <div className="flex min-w-0 items-center gap-3">
      {/* R-135: a merchant store's logo. The box stays light in both themes: most logos are drawn for a light page. */}
      {src ? (
        <span
          aria-hidden
          data-theme="light"
          className="grid h-10 max-w-40 shrink-0 place-items-center rounded-md bg-surface px-1.5 sm:h-11"
        >
          <Image
            src={src}
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
          className="grid size-10 shrink-0 place-items-center rounded-md bg-ink text-base font-semibold text-bg sm:size-11 sm:text-lg"
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
