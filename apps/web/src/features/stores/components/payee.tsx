import Image from "next/image";
import { storeLogoUrl } from "@/features/stores/lib/stores";
import type { StoreBrand } from "@/features/stores/types/stores";

export interface PayeeProps {
  name: string;
  subtitle: string;
  brand?: StoreBrand | null;
  as?: "h1" | "p";
  logoSrc?: string | null;
}

export function Payee({ name, subtitle, brand, as: Name = "h1", logoSrc }: PayeeProps) {
  const src = logoSrc ?? (brand?.logoAt ? storeLogoUrl(brand.storeId, brand.logoAt) : null);
  return (
    <div className="flex min-w-0 items-center gap-3">
      {/* Light in both themes: most logos are drawn for a light page. */}
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
