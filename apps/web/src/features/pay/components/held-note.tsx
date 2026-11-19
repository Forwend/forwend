import { BUTTON_VARIANTS, Button } from "@forwend/ui-web";
import type { Invoice } from "@/features/invoices/types/invoices";
import { NeedHelp } from "@/features/pay/components/need-help";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { amountText, overpaid } from "@/features/pay/lib/pay";
import type { PayToken } from "@/features/pay/types/pay";

/** A div: the dialog inside can't sit in a paragraph. */
export function HeldNote({ children }: { children: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-warning">
      <p>{children}</p>
      <GetItBack />
    </div>
  );
}

export function GetItBack() {
  return (
    <NeedHelp
      trigger={(open) => (
        <Button variant={BUTTON_VARIANTS.link} className="text-sm" onClick={open}>
          {COPY.howToGetBack}
        </Button>
      )}
    />
  );
}

export function Overpaid({ invoice, token }: { invoice: Invoice; token: PayToken }) {
  const extra = overpaid(invoice);
  if (extra <= 0n) return null;
  return <HeldNote>{COPY.overpaid(amountText(extra, token))}</HeldNote>;
}
