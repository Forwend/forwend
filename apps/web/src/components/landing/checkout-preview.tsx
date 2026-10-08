import {
  Address,
  Badge,
  Money,
  NetworkWarning,
  PaymentTimeline,
  QrCode,
  STEP_STATES,
  TokenChip,
} from "@forwend/ui-web";
import { Check } from "lucide-react";
import Image from "next/image";
import { CHECKOUT, LANDING_SECTIONS } from "@/constants/landing";
import { CHECKOUT_IMAGE } from "@/constants/landing-images";
import { SAMPLE_DEPOSIT_ADDRESS } from "@/constants/landing-samples";
import { SAMPLE_INVOICE, SAMPLE_STEPS } from "@/constants/sample-invoice";

// Dusk Ledger raise: product showcase in a dark framed section.
export function CheckoutPreview() {
  return (
    <section
      data-theme="dark"
      data-section={LANDING_SECTIONS.checkout}
      aria-labelledby="checkout-title"
      className="relative isolate mx-2 overflow-hidden rounded-xl bg-bg text-ink sm:mx-3"
    >
      <div className="absolute inset-x-0 top-0 -z-10 h-[28rem]">
        <Image
          src={CHECKOUT_IMAGE.src}
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-[70%_center] opacity-80"
        />
      </div>
      <div className="absolute inset-x-0 top-0 -z-10 h-[28rem] bg-[linear-gradient(to_bottom,transparent,var(--fw-bg))]" />
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-14 px-4 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1fr_1fr] lg:items-center">
        <div>
          <h2
            id="checkout-title"
            className="font-display text-[clamp(2.25rem,4.6vw,3.75rem)] leading-[1.06] tracking-[-0.015em]"
          >
            {CHECKOUT.title}
          </h2>
          <p className="mt-5 max-w-lg text-lg text-muted">{CHECKOUT.body}</p>
          <ul className="mt-8 flex flex-col gap-3">
            {CHECKOUT.points.map((p) => (
              <li key={p} className="flex items-center gap-3 text-ink">
                <Check aria-hidden className="size-[var(--fw-icon-md)] text-accent" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5 shadow-lg sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">Pay {SAMPLE_INVOICE.client}</p>
            <Badge>Sample</Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <Money
              baseUnits={SAMPLE_INVOICE.baseUnits}
              decimals={SAMPLE_INVOICE.decimals}
              token={SAMPLE_INVOICE.token}
              className="text-[clamp(1.75rem,7.5vw,2.25rem)]"
            />
            <TokenChip token={SAMPLE_INVOICE.token} network={SAMPLE_INVOICE.network} />
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
            <QrCode
              value={SAMPLE_DEPOSIT_ADDRESS}
              label="Sample QR code for the invoice deposit address"
              className="w-36"
            />
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">Send to this invoice's address</p>
              <Address address={SAMPLE_DEPOSIT_ADDRESS} />
            </div>
          </div>
          <div className="mt-6">
            <NetworkWarning token={SAMPLE_INVOICE.token} network={SAMPLE_INVOICE.network} />
          </div>
          <div className="mt-6 border-t border-line pt-5">
            <PaymentTimeline
              label="Sample checkout progress"
              steps={SAMPLE_STEPS.map((label, i) => ({
                label,
                state:
                  i === 0
                    ? STEP_STATES.complete
                    : i === 1
                      ? STEP_STATES.current
                      : STEP_STATES.upcoming,
                detail: i === 1 ? "8 of 12" : undefined,
              }))}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
