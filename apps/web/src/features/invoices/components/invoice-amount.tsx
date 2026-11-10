import { cx, Money, Skeleton, shortAddress } from "@forwend/ui-web";
import { INVOICES_COPY } from "@/features/invoices/constants/invoices-copy";
import { tokenKey } from "@/features/invoices/lib/invoices";
import type { InvoiceSummary, InvoiceToken } from "@/features/invoices/types/invoices";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { exactDigits } from "@/shared/lib/money";

export interface InvoiceAmountProps {
  invoice: InvoiceSummary;
  tokens: readonly InvoiceToken[] | null;
  /** Keeps the figures and the token on one line, as a table cell needs. */
  nowrap?: boolean;
  className?: string;
}

/** A token no longer enabled has no known decimals, so it shows base units. */
export function InvoiceAmount({ invoice, tokens, nowrap, className }: InvoiceAmountProps) {
  if (!tokens) return <Skeleton className="inline-block h-4 w-24" />;
  const token = tokens.find((t) => tokenKey(t) === tokenKey(invoice));
  const amount = BigInt(invoice.amount);
  // An invoice the client may pay in any of several stablecoins is priced in USD, also once one is chosen (D-75).
  const choosing = invoice.optionCount > 1;
  return token ? (
    <Money
      baseUnits={amount}
      decimals={token.decimals}
      fractionDigits={exactDigits(amount, token.decimals)}
      token={choosing ? MONEY_COPY.usd : token.symbol}
      nowrap={nowrap}
      className={className}
    />
  ) : (
    <span className={cx(nowrap && "whitespace-nowrap", className)}>
      <span className="font-mono tabular-nums">{invoice.amount}</span>{" "}
      <span className="text-muted">{INVOICES_COPY.baseUnits(shortAddress(invoice.token))}</span>
    </span>
  );
}
