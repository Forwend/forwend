import { Badge, Money, QrCode } from "@forwend/ui-web";
import { ChevronRight } from "lucide-react";
import Image from "next/image";
import { HERO } from "@/screens/landing/sections/hero/constants/hero-content";
import { HERO_IMAGE } from "@/shared/assets/images";
import { SAMPLE_INVOICE } from "@/shared/examples/sample-invoice";

const SAMPLE_ADDRESS = "0x7c1e4a0b9d3f60e8a51c7b2d4f8e03a6c95d21b4";

/** The product on the art: the owner's invoice confirming, and the payer's checkout. Sample data, labeled. */
export function HeroProduct() {
  return (
    <figure
      aria-label={HERO.canvasLabel}
      className="relative isolate mt-12 overflow-hidden rounded-xl bg-sunken sm:mt-14"
    >
      <Image
        src={HERO_IMAGE.src}
        alt=""
        fill
        priority
        sizes="(min-width: 80rem) 80rem, 100vw"
        className="-z-10 object-cover object-[50%_30%] saturate-[.65] dark:brightness-[.45] dark:grayscale-[.7]"
      />
      <div className="flex min-h-[34rem] items-end justify-center gap-8 px-4 pt-10 sm:px-10 lg:min-h-[36rem] lg:justify-between lg:px-14 lg:pt-16">
        <OwnerInvoice />
        <PayerPhone />
      </div>
    </figure>
  );
}

function OwnerInvoice() {
  return (
    <div className="-mb-px hidden w-full max-w-3xl grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-7 rounded-t-lg border border-line bg-surface p-7 pb-9 shadow-lg lg:grid">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm text-subtle">
          {HERO.crumb[0]}
          <ChevronRight aria-hidden className="size-3.5" />
          {HERO.crumb[1]}
        </p>
        <div className="mt-3 flex items-baseline gap-3">
          <p className="text-xl font-semibold tracking-tight text-ink">{SAMPLE_INVOICE.service}</p>
          <p className="truncate text-muted">{SAMPLE_INVOICE.client}</p>
          <span className="ml-auto">
            <Badge>{HERO.sample}</Badge>
          </span>
        </div>
        <p className="mt-5 text-4xl font-medium tracking-tight text-ink tabular-nums">
          <Money
            baseUnits={SAMPLE_INVOICE.baseUnits}
            decimals={SAMPLE_INVOICE.decimals}
            token={SAMPLE_INVOICE.token}
          />
          <span className="ml-2 text-base font-normal tracking-normal text-muted">
            on {SAMPLE_INVOICE.network}
          </span>
        </p>
        <div className="mt-6 rounded-md border border-line p-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              data-motion="essential"
              className="mt-1 size-4 shrink-0 animate-[fw-spin_var(--fw-duration-slower)_linear_infinite] rounded-pill border-2 border-[color-mix(in_oklab,var(--fw-accent)_25%,transparent)] border-t-accent"
            />
            <div>
              <p className="font-medium text-ink">{HERO.status}</p>
              <p className="text-sm text-muted">{HERO.eta}</p>
            </div>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-pill bg-surface-2">
            <span className="block h-full w-[42%] origin-left rounded-pill bg-ink motion-safe:animate-[fw-grow_var(--fw-duration-slower)_var(--fw-ease-out)_both]" />
          </div>
          <p className="mt-2 flex justify-between text-xs text-subtle">
            <span>{HERO.seen}</span>
            <span>{HERO.final}</span>
          </p>
          <p className="mt-3 border-t border-line pt-3 text-sm text-muted">{HERO.calm}</p>
        </div>
      </div>
      <dl className="border-l border-line pl-7 text-sm">
        {HERO.details.map(([term, value]) => (
          <div key={term} className="flex justify-between gap-3 border-b border-line py-2.5">
            <dt className="text-muted">{term}</dt>
            <dd className="text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function PayerPhone() {
  return (
    <div className="-mb-24 w-68 shrink-0 rounded-[2.25rem] bg-ink p-2.5 shadow-lg dark:bg-sunken dark:ring-1 dark:ring-line sm:-mb-20">
      <div className="h-[34rem] rounded-[1.75rem] bg-surface px-5 pt-6 text-sm">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-md bg-brand font-semibold text-on-brand">
            {HERO.payer[0]}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{HERO.payer}</span>
            <span className="block text-xs text-muted">{HERO.payerLine}</span>
          </span>
        </div>
        <p className="mt-5 text-2xl font-medium tracking-tight text-ink tabular-nums">
          <Money
            baseUnits={SAMPLE_INVOICE.baseUnits}
            decimals={SAMPLE_INVOICE.decimals}
            token={SAMPLE_INVOICE.token}
          />
        </p>
        <p className="text-xs text-muted">{HERO.payWith}</p>
        <div className="mt-4 rounded-md border border-line p-3">
          <QrCode value={SAMPLE_ADDRESS} label={HERO.payWith} className="mx-auto size-36" />
        </div>
        <p className="mt-3 truncate font-mono text-xs text-muted">
          <span className="font-medium text-ink">{SAMPLE_ADDRESS.slice(0, 6)}</span>
          {SAMPLE_ADDRESS.slice(6, -4)}
          <span className="font-medium text-ink">{SAMPLE_ADDRESS.slice(-4)}</span>
        </p>
      </div>
    </div>
  );
}
