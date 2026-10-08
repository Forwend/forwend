import { HalftoneRidge } from "@/components/art/halftone-ridge";
import { COMP_UI } from "@/constants/art";
import { NAV_VARIANTS } from "@/constants/comp";
import { CTA } from "@/constants/copy";
import { compVars } from "@/lib/comp-vars";
import { CompNav } from "./comp-nav";
import { InvoicePanel } from "./invoice-panel";

export function HalftoneHorizonComp() {
  return (
    <div
      style={compVars(COMP_UI.halftone)}
      className="relative isolate flex min-h-[46rem] flex-col overflow-hidden rounded-[1.75rem] border border-[var(--line)] px-4 pt-5 pb-8 text-[var(--ink)] sm:px-8"
    >
      <HalftoneRidge className="absolute inset-0 -z-10 h-full w-full" />
      <CompNav variant={NAV_VARIANTS.bar} />
      <div className="mt-16 max-w-2xl">
        <h3 className="font-[family-name:var(--font-bricolage)] text-[clamp(2.5rem,6vw,4.9rem)] leading-[0.98] font-bold tracking-[-0.035em] text-balance">
          Invoices in USDC. Status you can check.
        </h3>
        <p className="mt-5 max-w-lg text-lg text-[var(--muted)] text-pretty">
          Every payment gets its own address, so a transfer from any wallet or exchange lands on the
          right invoice.
        </p>
        <button
          type="button"
          className="mt-8 rounded-full bg-[var(--accent)] px-6 py-3 font-medium text-[var(--onInk)]"
        >
          {CTA.joinWaitlist}
        </button>
      </div>
      <InvoicePanel className="mt-auto ml-auto" />
    </div>
  );
}
