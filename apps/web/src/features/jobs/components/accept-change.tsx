"use client";

import { useAcceptChangeMutation } from "@/features/jobs/api/jobs-api";
import { ConsentForm } from "@/features/jobs/components/consent-form";
import { QUOTE_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import type { JobPayment } from "@/features/jobs/types/jobs";

const NOT_FOUND = 404;

export interface AcceptChangeProps {
  token: string;
  change: JobPayment;
  /** Called once accepted: the form goes, so the page moves focus to the change. */
  onAccepted: (position: number) => void;
  /** Called when the change was withdrawn or replaced: the page reads the job again, which takes this form away. */
  onGone: () => void;
}

// R-106: the client's accept of a scope change on the quote page. It sends the change's proposedAt exactly as read, so
// the consent names this change and no other (R-105).
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
          if ((failure as { status?: unknown }).status !== NOT_FOUND) throw failure;
          onGone();
          return;
        }
        onAccepted(change.position);
      }}
    />
  );
}
