"use client";

import { useAcceptChangeMutation } from "@/features/jobs/api/jobs-api";
import { ConsentForm } from "@/features/jobs/components/consent-form";
import { QUOTE_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import type { JobPayment } from "@/features/jobs/types/jobs";
import { notFound } from "@/shared/api/api-error";

export interface AcceptChangeProps {
  token: string;
  change: JobPayment;
  onAccepted: (position: number) => void;
  onGone: () => void;
}

export function AcceptChange({ token, change, onAccepted, onGone }: AcceptChangeProps) {
  const [accept, { isLoading }] = useAcceptChangeMutation();
  return (
    <ConsentForm
      aria-label={COPY.change.title(change.title)}
      text={COPY.change.text}
      action={COPY.change.action}
      loading={isLoading}
      compact
      className="mt-2 rounded-md border border-line p-3"
      onConsent={async (name, email) => {
        if (!change.proposedAt) return;
        try {
          await accept({
            token,
            position: change.position,
            proposedAt: change.proposedAt,
            name,
            email,
          }).unwrap();
        } catch (failure) {
          if (!notFound(failure)) throw failure;
          onGone();
          return;
        }
        onAccepted(change.position);
      }}
    />
  );
}
