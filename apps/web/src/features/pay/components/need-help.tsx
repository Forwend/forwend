"use client";

import { BUTTON_VARIANTS, buttonClasses, Dialog } from "@forwend/ui-web";
import { Mail } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { SITE } from "@/shared/config/site";

const EMBED_PATH = /^\/embed\//;

// The rules a careful payer may want, in a dialog from the footer: the pay box never grows for them (R-68). A held
// payment's "How to get it back" opens it too, through `trigger`. Embedded in a merchant's page (R-168), the browser's
// address bar shows the merchant's site, not this one.
export function NeedHelp({ trigger }: { trigger?: (open: () => void) => ReactNode }) {
  // Read after mount: the page is drawn on the server first.
  const [page, setPage] = useState({ host: "", payLink: "", embedded: false });
  useEffect(() => {
    const { host, origin, pathname } = window.location;
    setPage({
      host,
      payLink: origin + pathname.replace(EMBED_PATH, "/pay/"),
      embedded: EMBED_PATH.test(pathname),
    });
  }, []);
  const mail = `mailto:${SITE.supportEmail}?subject=${encodeURIComponent(COPY.supportMail.subject)}&body=${encodeURIComponent(COPY.supportMail.body(page.payLink))}`;
  return (
    <Dialog
      triggerLabel={COPY.help}
      title={COPY.help}
      closeLabel={COPY.close}
      triggerVariant={BUTTON_VARIANTS.ghost}
      triggerClassName="h-auto! rounded-sm! px-0! text-xs! font-normal! text-subtle! hover:bg-transparent! hover:text-ink!"
      trigger={trigger}
    >
      <div className="flex flex-col divide-y divide-line text-sm leading-6">
        <Section title={COPY.helpSections.check}>
          <p>
            {page.embedded ? COPY.embeddedHost : COPY.host}{" "}
            <strong className="font-medium text-ink">{page.host}</strong>.{" "}
            {page.embedded ? COPY.embeddedHostHint : COPY.hostHint}
          </p>
          <p>{COPY.scam}</p>
          <p>{COPY.unverifiedName}</p>
        </Section>
        <Section title={COPY.helpSections.held}>
          {COPY.heldHelp.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </Section>
        <Section title={COPY.helpSections.wrong}>
          <p>{COPY.wrongHelp}</p>
        </Section>
        <div className="flex flex-col items-center gap-2 pt-5">
          <a href={mail} className={`${buttonClasses({ variant: "secondary" })} w-full gap-2`}>
            <Mail aria-hidden className="size-[var(--fw-icon-md)]" />
            {COPY.emailSupport}
          </a>
          <p className="text-xs text-subtle">{COPY.supportAddress(SITE.supportEmail)}</p>
        </div>
      </div>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 py-4 first:pt-0">
      <h3 className="font-medium text-ink">{title}</h3>
      {children}
    </section>
  );
}
