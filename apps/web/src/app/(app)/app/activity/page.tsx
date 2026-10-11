import { Suspense } from "react";
import { ActivityScreen } from "@/screens/activity/activity-screen";

export default function ActivityPage() {
  // The list reads its filter and search from the URL on the client.
  return (
    <Suspense>
      <ActivityScreen />
    </Suspense>
  );
}
