import { CTA } from "@/features/waitlist/constants/waitlist";
import { CompNav } from "@/screens/kit-directions/comp-nav";
import { COMP_UI, NAV_VARIANTS } from "@/screens/kit-directions/constants/comp";
import { InvoicePanel } from "@/screens/kit-directions/invoice-panel";
import { compVars } from "@/screens/kit-directions/lib/comp";
import { DuskLandscape } from "@/shared/components/art/dusk-landscape";

export function DuskLedgerComp() {
  return (
    <div
      style={compVars(COMP_UI.dusk)}
      className="relative isolate flex min-h-[46rem] flex-col overflow-hidden rounded-[1.75rem] px-4 pt-5 pb-8 text-[var(--ink)] sm:px-8"
    >
      <DuskLandscape className="absolute inset-0 -z-10 h-full w-full" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,transparent_8%,var(--scrim)_42%)]" />
      <CompNav variant={NAV_VARIANTS.bar} />
      <div className="mt-20 grid flex-1 items-end gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="max-w-xl">
          <h3 className="font-[family-name:var(--font-gloock)] text-[clamp(2.5rem,5.5vw,4.5rem)] leading-[1.04] tracking-[-0.01em] text-balance">
            Stablecoin payments, settled where you can see them.
          </h3>
          <p className="mt-5 text-lg text-[var(--muted)] text-pretty">
            One account for invoices, checkout and payouts. Every amount, network and fee shown
            before anything moves.
          </p>
          <button
            type="button"
            className="mt-8 rounded-full bg-[var(--accent)] px-6 py-3 font-medium text-[var(--onInk)]"
          >
            {CTA.joinWaitlist}
          </button>
        </div>
        <div className="rounded-[1.5rem] border border-[var(--line)] bg-[rgb(0_0_0/0.3)] p-3 backdrop-blur-sm">
          <InvoicePanel className="max-w-none" />
        </div>
      </div>
    </div>
  );
}
