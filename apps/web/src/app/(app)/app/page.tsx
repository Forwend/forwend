import { Suspense } from "react";
import { DashboardScreen } from "@/screens/dashboard/dashboard-screen";

export default function OverviewPage() {
  // The payments table reads its filter and search from the URL on the client.
  return (
    <Suspense>
      <DashboardScreen />
    </Suspense>
  );
}
