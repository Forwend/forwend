import {
  COPY_STATUS,
  formatTokenAmount,
  IconButton,
  Money,
  QrCode,
  ReceiveAddress,
  useCopy,
} from "@forwend/ui-web";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import type { PayToken } from "@/features/pay/types/pay";
import { exactDigits } from "@/shared/lib/money";

export interface SendAddressProps {
  address: string;
  amount: bigint;
  token: PayToken;
  network: string;
  lookalike?: string | null; // a bridged token that does not pay
}

export function SendAddress({ address, amount, token, network, lookalike }: SendAddressProps) {
  return (
    <>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:gap-4">
        <QrCode value={address} label={COPY.qr} className="w-26 border border-line p-1 sm:w-32" />
        <div className="flex min-w-0 flex-col gap-2">
          <ExactAmount amount={amount} token={token} />
          <p role="note" className="flex flex-col gap-0.5 text-xs font-medium text-warning">
            <span className="flex items-start gap-1.5">
              <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
              {COPY.sendOnly(token.symbol, network)}
            </span>
            {/* The space keeps the two sentences apart when read aloud; the flex column drops it on screen. */}
            {lookalike ? " " : null}
            {lookalike ? (
              <span className="pl-5">{COPY.notLookalike(token.symbol, lookalike)}</span>
            ) : null}
          </p>
        </div>
      </div>
      <ReceiveAddress address={address} label={COPY.sendTo(token.symbol, network)} />
    </>
  );
}

// Wallets and exchanges reject "1,250.50": the copy is the plain decimal, exact to the base unit.
function ExactAmount({ amount, token }: { amount: bigint; token: PayToken }) {
  const fractionDigits = exactDigits(amount, token.decimals);
  const plain = formatTokenAmount({
    baseUnits: amount,
    decimals: token.decimals,
    fractionDigits,
  }).replaceAll(",", "");
  const [status, copy] = useCopy(plain);
  const label =
    status === COPY_STATUS.copied
      ? COPY.amountCopied
      : status === COPY_STATUS.failed
        ? COPY.copyAmountFailed
        : COPY.copyAmount;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-muted">{COPY.exactAmount}</span>
      <div className="flex items-center justify-between gap-2 rounded-md border border-field bg-surface py-1 pr-1 pl-3">
        <Money
          baseUnits={amount}
          decimals={token.decimals}
          fractionDigits={fractionDigits}
          token={token.symbol}
          className="min-w-0 text-base font-semibold break-all text-ink"
        />
        <IconButton label={label} title={label} onClick={copy}>
          {status === COPY_STATUS.copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)] text-success" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
        </IconButton>
      </div>
      <span role="status" className="sr-only">
        {status === COPY_STATUS.idle ? "" : label}
      </span>
    </div>
  );
}
