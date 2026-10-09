import { formatTokenAmount } from "@forwend/ui-web";
import { SAMPLE_INVOICE, SAMPLE_STEPS } from "@/shared/examples/sample-invoice";

const shortHash = `${SAMPLE_INVOICE.txHash.slice(0, 6)}…${SAMPLE_INVOICE.txHash.slice(-4)}`;

// Reads its colors from the parent comp's --ink, --muted, --line, --surface and --accent.
export function InvoicePanel({ className = "" }: { className?: string }) {
  return (
    <div
      data-testid="product-panel"
      className={`w-full max-w-[26rem] rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface)] p-5 text-[var(--ink)] shadow-[0_18px_40px_-18px_rgba(10,20,15,0.35)] backdrop-blur-md ${className}`}
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">Invoice {SAMPLE_INVOICE.id}</span>
        <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--muted)]">
          Sample
        </span>
      </div>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {SAMPLE_INVOICE.client} · {SAMPLE_INVOICE.service}
      </p>
      <p className="mt-4 flex items-baseline gap-2">
        <span className="font-mono text-3xl tabular-nums tracking-tight">
          {formatTokenAmount({
            baseUnits: SAMPLE_INVOICE.baseUnits,
            decimals: SAMPLE_INVOICE.decimals,
          })}
        </span>
        <span className="text-sm text-[var(--muted)]">
          {SAMPLE_INVOICE.token} on {SAMPLE_INVOICE.network}
        </span>
      </p>
      <ol className="mt-5 grid grid-cols-4 gap-2" aria-label="Payment progress">
        {SAMPLE_STEPS.map((step, i) => {
          const last = i === SAMPLE_STEPS.length - 1;
          return (
            <li key={step} className="flex flex-col gap-2">
              <span
                className={`h-1 rounded-full ${last ? "bg-[var(--accent)]" : "bg-[var(--ink)] opacity-70"}`}
              />
              <span className={`text-xs ${last ? "font-semibold" : "text-[var(--muted)]"}`}>
                {step}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 font-mono text-xs text-[var(--muted)]">
        Tx {shortHash} · settled to your wallet
      </p>
    </div>
  );
}
