import { JobQuote } from "@/features/jobs/components/job-quote";
import { CheckoutPage } from "@/screens/pay/checkout-page";

/** The page a job's link opens for the client. */
export function JobQuoteScreen({ token }: { token: string }) {
  return (
    <CheckoutPage>
      <JobQuote token={token} />
    </CheckoutPage>
  );
}
