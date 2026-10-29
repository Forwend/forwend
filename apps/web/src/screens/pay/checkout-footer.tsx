import { LogoMark } from "@forwend/ui-web";
import { NeedHelp } from "@/features/pay/components/need-help";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";
import { APP_ROUTES } from "@/shared/config/routes";

const LINK = "rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus";

/** The public checkout pages' footer: who runs the payment, and help. A new tab keeps the checkout open. */
export function CheckoutFooter({ className = "" }: { className?: string }) {
  return (
    <footer
      className={`mt-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-subtle ${className}`}
    >
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
  );
}
