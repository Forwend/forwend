import { Suspense } from "react";
import { TransactionsScreen } from "@/screens/transactions/transactions-screen";

export default function TransactionsPage() {
  // The screen reads ?search= on the client.
  return (
    <Suspense>
      <TransactionsScreen />
    </Suspense>
  );
}
