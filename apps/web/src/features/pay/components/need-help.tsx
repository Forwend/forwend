"use client";

import { BUTTON_VARIANTS, Dialog } from "@forwend/ui-web";
import { useEffect, useState } from "react";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";

// The rules a careful payer may want, in a dialog from the footer: the pay box never grows for them (R-68). Embedded
// in a merchant's page (R-168), the browser's address bar shows the merchant's site, not this one.
export function NeedHelp({ embedded = false }: { embedded?: boolean }) {
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
          {embedded ? COPY.embeddedHost : COPY.host}{" "}
          <strong className="font-medium text-ink">{host}</strong>.{" "}
          {embedded ? COPY.embeddedHostHint : COPY.hostHint}
        </li>
        <li>{COPY.unverifiedName}</li>
        <li>{COPY.refund}</li>
        <li>{COPY.scam}</li>
      </ul>
    </Dialog>
  );
}
