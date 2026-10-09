import { CTA } from "@/features/waitlist/waitlist";
import { COMP_UI, compVars, NAV_VARIANTS } from "@/screens/kit-directions/comp";
import { CompNav } from "@/screens/kit-directions/comp-nav";
import { InvoicePanel } from "@/screens/kit-directions/invoice-panel";
import { DawnLandscape } from "@/shared/art/dawn-landscape";

export function DawnPathComp() {
  return (
    <div
      style={compVars(COMP_UI.dawn)}
      className="relative isolate flex min-h-[46rem] flex-col overflow-hidden rounded-[1.75rem] px-4 pt-5 pb-8 text-[var(--ink)] sm:px-8"
    >
      <DawnLandscape className="absolute inset-0 -z-10 h-full w-full" />
      <CompNav variant={NAV_VARIANTS.pill} />
      <div className="mx-auto mt-16 flex max-w-3xl flex-col items-center text-center sm:mt-20">
        <h3 className="font-[family-name:var(--font-caslon)] text-[clamp(2.6rem,6vw,4.75rem)] leading-[1.02] tracking-[-0.02em] text-balance">
          Get paid in stablecoins. See every step.
        </h3>
        <p className="mt-5 max-w-xl text-lg text-[var(--muted)] text-pretty">
          Invoices, checkout and an API for USDC and USDT. Each payment moves from detected to
          settled in your own wallet, in plain sight.
        </p>
        <button
          type="button"
          className="mt-8 rounded-full bg-[var(--ink)] px-6 py-3 font-medium text-[var(--onInk)] shadow-[0_10px_24px_-12px_rgba(15,34,25,0.6)]"
        >
          {CTA.joinWaitlist}
        </button>
      </div>
      <InvoicePanel className="mx-auto mt-auto translate-y-2" />
    </div>
  );
}
