import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JOB_TOKEN_PATTERN } from "@/features/jobs/constants/jobs";
import { QUOTE_COPY } from "@/features/jobs/constants/jobs-copy";
import { PublicStoreProvider } from "@/providers/public-store-provider";
import { JobQuoteScreen } from "@/screens/job-quote/job-quote-screen";

// Outside the (app) group: the client opens it from the freelancer's message, with no account. The token is a secret
// link, so search engines stay out.
export const metadata: Metadata = {
  title: QUOTE_COPY.title,
  robots: { index: false, follow: false },
};

export default async function JobQuotePage({ params }: PageProps<"/w/[token]">) {
  const { token } = await params;
  if (!JOB_TOKEN_PATTERN.test(token)) notFound();
  return (
    <PublicStoreProvider>
      <JobQuoteScreen token={token} />
    </PublicStoreProvider>
  );
}
