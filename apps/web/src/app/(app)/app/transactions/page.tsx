import { Suspense } from "react";
import { TransactionsScreen } from "@/screens/transactions/transactions-screen";

export default function TransactionsPage() {
  // The table reads its filter and search from the URL on the client.
  return (
    <Suspense>
      <TransactionsScreen />
    </Suspense>
  );
}
