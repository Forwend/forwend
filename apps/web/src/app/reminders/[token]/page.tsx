import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { STOP_TOKEN_PATTERN } from "@/features/invoices/constants/invoices";
import { STOP_REMINDERS_COPY } from "@/features/invoices/constants/invoices-copy";
import { PublicStoreProvider } from "@/providers/public-store-provider";
import { StopRemindersScreen } from "@/screens/stop-reminders/stop-reminders-screen";

// Outside the (app) group: the client follows it from a reminder email, with no account. The token is a secret link.
export const metadata: Metadata = {
  title: STOP_REMINDERS_COPY.title,
  robots: { index: false, follow: false },
};

export default async function StopRemindersPage({ params }: PageProps<"/reminders/[token]">) {
  const { token } = await params;
  if (!STOP_TOKEN_PATTERN.test(token)) notFound();
  return (
    <PublicStoreProvider>
      <StopRemindersScreen token={token} />
    </PublicStoreProvider>
  );
}
