import { Logo, LogoMark } from "@forwend/ui-web";
import Link from "next/link";
import { NeedHelp } from "@/features/pay/components/need-help";
import { PayInvoice } from "@/features/pay/components/pay-invoice";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";
import { APP_ROUTES } from "@/shared/config/routes";

const LINK = "rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus";

export interface PayScreenProps {
  invoiceId: string;
  option?: string;
}

/** The public checkout: the invoice beside how to pay it on wide screens, one column on phones (R-68). */
export function PayScreen({ invoiceId, option }: PayScreenProps) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-8 px-4 py-6 sm:px-6 lg:py-10">
      <Link href={APP_ROUTES.site} className={`${LINK} self-start`}>
        <Logo />
      </Link>
      <main className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-16">
        <PayInvoice invoiceId={invoiceId} option={option} />
      </main>
      {/* A new tab: the payer keeps the checkout open. */}
      <footer className="mt-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-subtle">
        <a
          href={APP_ROUTES.site}
          target="_blank"
          rel="noopener noreferrer"
          className={`${LINK} inline-flex items-center gap-1.5 hover:text-ink`}
        >
          {PAY_COPY.paymentsBy}
          <LogoMark className="size-3.5" />
          {PAY_COPY.forwend}
          <span className="sr-only">{PAY_COPY.newTab}</span>
        </a>
        <span aria-hidden>·</span>
        <NeedHelp />
      </footer>
    </div>
  );
}
