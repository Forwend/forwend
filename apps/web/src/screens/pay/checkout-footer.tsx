import { LogoMark } from "@forwend/ui-web";
import { ExternalLink } from "lucide-react";
import { NeedHelp } from "@/features/pay/components/need-help";
import { LEFT_PAD } from "@/features/pay/constants/pay";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";
import { APP_ROUTES } from "@/shared/config/routes";

const LINK = "rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus";
const RULE = <span aria-hidden className="h-3 w-px bg-current opacity-40" />;

export interface CheckoutFooterProps {
  embeddedToken?: string; // only inside a merchant's page
}

/** Links open new tabs so the checkout stays open; in an embed, one opens the checkout itself. */
export function CheckoutFooter({ embeddedToken }: CheckoutFooterProps) {
  return (
    <footer
      className={`mt-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted lg:col-start-1 lg:justify-start lg:pt-4 lg:pb-8 lg:text-muted ${LEFT_PAD}`}
    >
      <a
        href={APP_ROUTES.site}
        target="_blank"
        rel="noopener noreferrer"
        className={`${LINK} inline-flex items-center gap-1.5 hover:text-ink`}
      >
        {PAY_COPY.paymentsBy}
        <span className="inline-flex items-center gap-1 font-medium text-ink">
          <LogoMark className="size-3.5" />
          {PAY_COPY.forwend}
        </span>
        <span className="sr-only">{PAY_COPY.newTab}</span>
      </a>
      {RULE}
      <NeedHelp />
      {embeddedToken ? (
        <>
          {RULE}
          <a
            href={`/pay/${embeddedToken}`}
            target="_blank"
            rel="noopener"
            className={`${LINK} inline-flex items-center gap-1 hover:text-ink`}
          >
            {PAY_COPY.openInTab}
            <ExternalLink aria-hidden className="size-3" />
          </a>
        </>
      ) : null}
    </footer>
  );
}
