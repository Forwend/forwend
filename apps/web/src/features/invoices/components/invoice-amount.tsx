import { Money, Skeleton, shortAddress } from "@forwend/ui-web";
import {
  exactDigits,
  type InvoiceSummary,
  type InvoiceToken,
  tokenKey,
} from "@/features/invoices/invoices";
import { INVOICES_COPY } from "@/features/invoices/invoices-copy";

/** The exact amount in the invoice's token; a token no longer enabled has no known decimals, so it shows base units. */
export function InvoiceAmount({
  invoice,
  tokens,
  className,
}: {
  invoice: InvoiceSummary;
  tokens: readonly InvoiceToken[] | null;
  className?: string;
}) {
  if (!tokens) return <Skeleton className="inline-block h-4 w-24" />;
  const token = tokens.find((t) => tokenKey(t) === tokenKey(invoice));
  const amount = BigInt(invoice.amount);
  return token ? (
    <Money
      baseUnits={amount}
      decimals={token.decimals}
      fractionDigits={exactDigits(amount, token.decimals)}
      token={token.symbol}
      className={className}
    />
  ) : (
    <span className={className}>
      <span className="font-mono tabular-nums">{invoice.amount}</span>{" "}
      <span className="text-muted">{INVOICES_COPY.baseUnits(shortAddress(invoice.token))}</span>
    </span>
  );
}
