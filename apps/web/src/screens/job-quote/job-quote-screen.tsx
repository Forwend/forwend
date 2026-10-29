import { JobQuote } from "@/features/jobs/components/job-quote";
import { LEFT_PAD } from "@/features/pay/constants/pay";
import { CheckoutFooter } from "@/screens/pay/checkout-footer";

/** The page a job's link opens (R-102), split as the checkout pages: the quote on the left, the client's action on the
 * right, and Forwend only in the footer. */
export function JobQuoteScreen({ token }: { token: string }) {
  return (
    <div className="isolate flex min-h-svh flex-col gap-8 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-lg:fw-safe-x lg:grid lg:grid-cols-2 lg:grid-rows-[1fr_auto] lg:gap-0 lg:p-0">
      <main className="flex min-w-0 flex-1 flex-col gap-8 lg:col-span-2 lg:grid lg:grid-cols-subgrid lg:items-start lg:gap-0">
        <JobQuote token={token} />
      </main>
      <CheckoutFooter
        className={`lg:col-start-1 lg:justify-start lg:pt-4 lg:pb-8 lg:text-muted ${LEFT_PAD}`}
      />
    </div>
  );
}
