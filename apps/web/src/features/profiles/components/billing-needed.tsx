import { buttonClasses, EmptyState } from "@forwend/ui-web";
import { IdCard } from "lucide-react";
import Link from "next/link";
import { BILLING_DETAILS_COPY } from "@/features/profiles/constants/profiles-copy";
import { billingDetailsHref } from "@/features/profiles/lib/profile";
import type { BillingThen } from "@/features/profiles/types/profile";

export interface BillingNeededProps {
  why: string;
  then: BillingThen;
}

/** A page that needs the profile's billing details before it can show its form. */
export function BillingNeeded({ why, then }: BillingNeededProps) {
  return (
    <EmptyState
      page
      icon={IdCard}
      title={BILLING_DETAILS_COPY.needed.title}
      description={why}
      action={
        <Link href={billingDetailsHref(then)} className={buttonClasses({ size: "sm" })}>
          {BILLING_DETAILS_COPY.needed.action}
        </Link>
      }
    />
  );
}
