import { Logo, LogoMark } from "@forwend/ui-web";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { PAY_COPY } from "@/features/pay/pay-copy";
import { PayInvoice } from "@/features/pay/pay-invoice";
import { APP_ROUTES } from "@/shared/config/routes";

const LINK = "rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus";

/** The public checkout: one calm column on every screen size, no sign-in. */
export function PayScreen({ invoiceId, option }: { invoiceId: string; option?: string }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <Link href={APP_ROUTES.site} className={`${LINK} mb-3 self-start`}>
        <Logo />
      </Link>
      <PayInvoice invoiceId={invoiceId} option={option} />
      {/* A new tab: the payer keeps the checkout open. */}
      <p className="mt-auto pt-6 text-center text-xs text-subtle">
        <a
          href={APP_ROUTES.site}
          target="_blank"
          rel="noopener noreferrer"
          className={`${LINK} inline-flex items-center gap-1.5 hover:text-ink`}
        >
          {PAY_COPY.paymentsBy}
          <LogoMark className="size-3.5" />
          {PAY_COPY.forwend}
          <ExternalLink aria-hidden className="size-3" />
          <span className="sr-only">{PAY_COPY.newTab}</span>
        </a>
      </p>
    </main>
  );
}
