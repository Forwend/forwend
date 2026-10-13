"use client";

import { BUTTON_VARIANTS, Dialog } from "@forwend/ui-web";
import { useEffect, useState } from "react";
import { PAY_COPY as COPY } from "@/features/pay/pay-copy";

// The rules a careful payer may want, in a dialog from the footer: the pay box never grows for them (R-68).
export function NeedHelp() {
  // Read after mount: the page is drawn on the server first.
  const [host, setHost] = useState("");
  useEffect(() => setHost(window.location.host), []);
  return (
    <Dialog
      triggerLabel={COPY.help}
      title={COPY.help}
      closeLabel={COPY.close}
      triggerVariant={BUTTON_VARIANTS.ghost}
      triggerClassName="h-auto! rounded-sm! px-0! text-xs! font-normal! text-subtle! hover:bg-transparent! hover:text-ink!"
    >
      <ul className="flex flex-col gap-3 text-sm">
        <li>
          {COPY.host} <strong className="font-medium text-ink">{host}</strong>. {COPY.hostHint}
        </li>
        <li>{COPY.unverifiedName}</li>
        <li>{COPY.refund}</li>
        <li>{COPY.scam}</li>
      </ul>
    </Dialog>
  );
}
