import { Logo } from "@forwend/ui-web";
import { PAY_COPY } from "@/features/pay/pay-copy";
import { PayInvoice } from "@/features/pay/pay-invoice";

/** The public checkout: one calm column on every screen size, no sign-in. */
export function PayScreen({ invoiceId }: { invoiceId: string }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <Logo className="mb-3" />
      <PayInvoice invoiceId={invoiceId} />
      <p className="mt-auto pt-6 text-center text-xs text-subtle">{PAY_COPY.footer}</p>
    </main>
  );
}
