"use client";

import { CAPTURE_STATUS, EmailCapture } from "@forwend/ui-web";
import { CTA } from "@/constants/copy";
import type { WaitlistFormProps } from "@/types/landing/props";

// F007 adds validation and the mock success state.
export function WaitlistForm({ id }: WaitlistFormProps) {
  return (
    <div id={`waitlist-${id}`} className="flex w-full justify-center">
      <EmailCapture
        status={CAPTURE_STATUS.idle}
        onSubmit={() => {}}
        submitLabel={CTA.joinWaitlist}
      />
    </div>
  );
}
