import type { Metadata } from "next";
import { FIRST_RUN_COPY } from "@/features/onboarding/constants/onboarding-copy";

export const metadata: Metadata = { title: FIRST_RUN_COPY.pageTitle };

// The app shell shows the first run on this address (R-50); the page itself has nothing to add.
export default function OnboardingPage() {
  return null;
}
