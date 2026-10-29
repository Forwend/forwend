import { Logo } from "@forwend/ui-web";
import Link from "next/link";
import { JobQuote } from "@/features/jobs/components/job-quote";
import { APP_ROUTES } from "@/shared/config/routes";

/** The page a job's link opens (R-102). */
export function JobQuoteScreen({ token }: { token: string }) {
  return (
    // The logo lines up with the quote's one column.
    <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-8 fw-safe-x pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:py-10">
      <Link
        href={APP_ROUTES.site}
        className="self-start rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Logo />
      </Link>
      <main className="flex flex-1">
        <JobQuote token={token} />
      </main>
    </div>
  );
}
