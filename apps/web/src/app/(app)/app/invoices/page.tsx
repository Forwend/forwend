import { Suspense } from "react";
import { InvoicesScreen } from "@/screens/invoices/invoices-screen";

export default function InvoicesPage() {
  // The list reads its filter and search from the URL on the client.
  return (
    <Suspense>
      <InvoicesScreen />
    </Suspense>
  );
}
