"use client";

import type { CaptureStatus } from "@forwend/ui-web";
import { CAPTURE_STATUS, EmailCapture } from "@forwend/ui-web";
import { useEffect, useRef, useState } from "react";
import { CTA } from "@/constants/copy";
import { WAITLIST_COPY, WAITLIST_MOCK_DELAY_MS } from "@/constants/waitlist";
import { isEmail } from "@/lib/waitlist";
import type { WaitlistFormProps } from "@/types/landing/props";

// mock: no network request and no storage. The confirmation is shown locally only.
// Replace with a real signup store before the site is public (PROJECT D-8).
export function WaitlistForm({ id }: WaitlistFormProps) {
  const [status, setStatus] = useState<CaptureStatus>(CAPTURE_STATUS.idle);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const message =
    status === CAPTURE_STATUS.success
      ? WAITLIST_COPY.success
      : status === CAPTURE_STATUS.error
        ? WAITLIST_COPY.invalid
        : undefined;

  return (
    <div id={`waitlist-${id}`} className="flex w-full justify-center">
      <EmailCapture
        status={status}
        message={message}
        submitLabel={CTA.joinWaitlist}
        onSubmit={(email) => {
          if (!isEmail(email)) {
            setStatus(CAPTURE_STATUS.error);
            return;
          }
          setStatus(CAPTURE_STATUS.submitting);
          timer.current = setTimeout(
            () => setStatus(CAPTURE_STATUS.success),
            WAITLIST_MOCK_DELAY_MS,
          );
        }}
      />
    </div>
  );
}
