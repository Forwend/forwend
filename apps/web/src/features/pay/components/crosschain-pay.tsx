"use client";

import {
  Button,
  formatTokenAmount,
  Notice,
  PaymentTimeline,
  QrCode,
  ReceiveAddress,
  STEP_STATES,
  shortAddress,
  TextField,
  type TimelineStep,
} from "@forwend/ui-web";
import { ExternalLink, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Invoice } from "@/features/invoices/types/invoices";
import {
  useCreateCrossQuoteMutation,
  useGetCrossPriceQuery,
  useGetCrossTokensQuery,
} from "@/features/pay/api/crosschain-api";
import { CrossChainPicker } from "@/features/pay/components/crosschain-picker";
import { ExactAmount } from "@/features/pay/components/exact-amount";
import { ENTER } from "@/features/pay/constants/pay";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";
import { signedDeposit, verifyQuote } from "@/features/pay/lib/crosschain";
import type { CrossToken } from "@/features/pay/types/crosschain";
import { CROSS_CHAIN_STATUSES } from "@/shared/constants/chains";
import { blockchainName, crossChainEnded } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

const COPY = PAY_COPY.crossChain;
type CrossChain = NonNullable<Invoice["crossChain"]>;

/** A quote the page may show: what it asked for, and 1Click's signed answer (D-124). Its address and amount are read
 * from the signed answer once it verifies, never from the api's own fields. */
interface Shown {
  quoteId: string;
  token: Pick<CrossToken, "assetId" | "blockchain" | "symbol" | "decimals">;
  refundTo: string;
  shownUntil: number;
  signed: unknown;
}

type Deposit = NonNullable<ReturnType<typeof signedDeposit>>;

export interface CrossChainPayProps {
  invoice: Invoice;
  linkToken: string;
  /** The Base option's receive address, as this page computed it from the terms. */
  receive: string;
  /** What is due on the Base option, in its base units: exactly what the quote must deliver. */
  due: bigint;
  now: number;
  /** Back to the tokens the invoice takes directly. */
  onDirect: () => void;
}

const left = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const amountText = (units: bigint, token: { decimals: number; symbol: string }) =>
  `${formatTokenAmount({ baseUnits: units, decimals: token.decimals, fractionDigits: exactDigits(units, token.decimals) })} ${token.symbol}`;

/** Pay from another chain and token (R-236, R-237): a price, a refund address, then a verified deposit address. */
export function CrossChainPay({
  invoice,
  linkToken,
  receive,
  due,
  now,
  onDirect,
}: CrossChainPayProps) {
  const kept = invoice.crossChain ?? null;
  const [picking, setPicking] = useState(false);
  // The token and refund address this tab asked with. A reload shows the kept quote again only against them: the
  // api's copy of the refund address could be anyone's (D-124).
  const [asked] = useState(() => readAsked(invoice.invoiceId));
  const [token, setToken] = useState<Shown["token"] | null>(kept ? keptToken(kept) : null);
  const [refundTo, setRefundTo] = useState(asked?.refundTo ?? "");
  const heading = useRef<HTMLHeadingElement>(null);
  // A reload shows the kept quote again, checked as a new one is, for the token and refund address this tab asked
  // with. Without them the payer types the refund address again, and Show address gives the same open quote (R-233).
  const [shown, setShown] = useState<Shown | null>(() =>
    kept &&
    asked &&
    kept.status === CROSS_CHAIN_STATUSES.pending &&
    kept.assetId === asked.assetId &&
    Date.parse(kept.shownUntil) > Date.now()
      ? { ...fromKept(kept), refundTo: asked.refundTo }
      : null,
  );
  // null while checking; false when the answer isn't 1Click's for this invoice.
  const [deposit, setDeposit] = useState<Deposit | false | null>(null);
  // A new price whose amount differs waits for Understood before its QR shows (D-125).
  const [changedFrom, setChangedFrom] = useState<bigint | null>(null);
  const [renewed, setRenewed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const tokens = useGetCrossTokensQuery(linkToken, { skip: !picking && token !== null });
  const price = useGetCrossPriceQuery(
    { payToken: linkToken, originAsset: token?.assetId ?? "" },
    // No price once a quote shows, or while 1Click converts a deposit; one it returned can be paid again.
    { skip: !token || shown !== null || Boolean(kept?.depositSeenAt && !crossChainEnded(kept)) },
  );
  const [createQuote, creating] = useCreateCrossQuoteMutation();

  useEffect(() => {
    if (!shown) return;
    let current = true;
    setDeposit(null);
    verifyQuote(shown.signed, {
      recipient: receive,
      amount: due.toString(),
      originAsset: shown.token.assetId,
      refundTo: shown.refundTo,
    }).then((ok) => {
      if (current) setDeposit((ok && signedDeposit(shown.signed)) || false);
    });
    return () => {
      current = false;
    };
  }, [shown, receive, due]);

  const ask = async (renewing: boolean) => {
    if (!token) return;
    setProblem(null);
    const result = await createQuote({
      payToken: linkToken,
      originAsset: token.assetId,
      refundTo: refundTo.trim(),
    });
    if ("error" in result) {
      setProblem(quoteProblem(result.error));
      return;
    }
    const q = result.data;
    const before = deposit || null;
    keepAsked(invoice.invoiceId, { assetId: token.assetId, refundTo: refundTo.trim() });
    if (!q.quoteId || !q.shownUntil) {
      setProblem(COPY.unavailable);
      return;
    }
    // A new price is told apart by what its signed answer says the payer sends.
    const next = signedDeposit(q.signed);
    if (renewing && before && next) {
      setChangedFrom(next.amountIn === before.amountIn ? null : before.amountIn);
      setRenewed(next.amountIn === before.amountIn);
    }
    // The old address must not show beside the new quote while it is checked.
    setDeposit(null);
    heading.current?.focus();
    setShown({
      quoteId: q.quoteId,
      token,
      refundTo: refundTo.trim(),
      shownUntil: Date.parse(q.shownUntil),
      signed: q.signed,
    });
  };

  // Once 1Click saw the deposit, the payer follows it to Paid (R-238).
  if (kept?.depositSeenAt && !crossChainEnded(kept)) {
    return <CrossChainProgress invoice={invoice} crossChain={kept} />;
  }

  const chain = token ? blockchainName(token.blockchain) : "";
  const expired = shown !== null && now >= shown.shownUntil;
  return (
    <section aria-labelledby="pay-cross" className={`flex flex-col gap-4 p-4 sm:p-5 ${ENTER}`}>
      <h2
        id="pay-cross"
        ref={heading}
        tabIndex={-1}
        className="text-sm font-medium text-ink outline-none"
      >
        {COPY.other}
      </h2>
      {token ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="font-medium text-ink">{token.symbol}</span>
            <span className="text-xs text-muted">{chain}</span>
          </span>
          {shown ? null : (
            <Button variant="link" size="sm" onClick={() => setPicking(true)}>
              {COPY.change}
            </Button>
          )}
        </div>
      ) : (
        <Button variant="secondary" size="lg" className="w-full" onClick={() => setPicking(true)}>
          {COPY.choose}
        </Button>
      )}
      <CrossChainPicker
        open={picking}
        onOpenChange={setPicking}
        tokens={tokens.data?.tokens}
        onPick={(picked) => {
          setToken(picked);
          setShown(null);
          setProblem(null);
          heading.current?.focus();
        }}
      />
      {token && !shown ? (
        <>
          <PricePreview
            price={price.data}
            loading={price.isFetching}
            error={price.error}
            token={token}
          />
          <TextField
            label={COPY.refund(chain)}
            hint={COPY.refundHint}
            value={refundTo}
            onChange={(event) => setRefundTo(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            inputClassName="font-mono"
          />
          <Button
            size="lg"
            className="w-full"
            loading={creating.isLoading}
            disabled={!price.data || refundTo.trim() === ""}
            onClick={() => ask(false)}
          >
            {COPY.showAddress}
          </Button>
        </>
      ) : null}
      {shown && deposit === false ? (
        <Notice
          tone="danger"
          role="alert"
          action={
            <Button
              size="sm"
              variant="secondary"
              loading={creating.isLoading}
              onClick={() => ask(false)}
            >
              {PAY_COPY.retry}
            </Button>
          }
        >
          {COPY.unverified}
        </Notice>
      ) : null}
      {shown && deposit && changedFrom !== null ? (
        <Notice
          tone="warning"
          role="alert"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setChangedFrom(null);
                heading.current?.focus();
              }}
            >
              {COPY.understood}
            </Button>
          }
        >
          <span className="font-medium">{COPY.changed}.</span>{" "}
          {COPY.changedNote(
            amountText(changedFrom, shown.token),
            amountText(deposit.amountIn, shown.token),
          )}
        </Notice>
      ) : null}
      {shown && deposit && changedFrom === null ? (
        <Send
          shown={shown}
          deposit={deposit}
          chain={chain}
          now={now}
          expired={expired}
          renewed={renewed}
          renewing={creating.isLoading}
          onRenew={() => ask(true)}
        />
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : null}
      <Button variant="link" size="sm" className="self-start" onClick={onDirect}>
        {COPY.direct}
      </Button>
    </section>
  );
}

function PricePreview({
  price,
  loading,
  error,
  token,
}: {
  price:
    | {
        amountIn: string;
        minAmountIn: string;
        amountInUsd: string;
        amountOut: string;
        timeEstimate: number;
      }
    | undefined;
  loading: boolean;
  error: unknown;
  token: Shown["token"];
}) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {quoteProblem(error)}
      </p>
    );
  }
  if (!price || loading) {
    return (
      <p role="status" className="text-sm text-muted">
        {COPY.gettingPrice}
      </p>
    );
  }
  const sends = BigInt(price.amountIn);
  // The cost is the least 1Click converts over what arrives, at 1Click's price: the slippage on top comes back unused.
  const usdPerUnit = Number(price.amountInUsd) / Number(sends);
  const cost = Math.max(
    0,
    Number(price.minAmountIn) * usdPerUnit - Number(price.amountOut) / 10 ** 6,
  );
  return (
    <div className="flex flex-col gap-1 rounded-md bg-surface-2 px-3 py-2.5">
      <span className="text-xs text-muted">{COPY.youSend}</span>
      <span className="text-base font-semibold text-ink tabular-nums">
        {amountText(sends, token)}
      </span>
      <span className="text-xs text-muted">
        {COPY.cost(cost.toFixed(2))} · {COPY.time(Math.max(1, Math.round(price.timeEstimate / 60)))}
      </span>
    </div>
  );
}

function Send({
  shown,
  deposit,
  chain,
  now,
  expired,
  renewed,
  renewing,
  onRenew,
}: {
  shown: Shown;
  deposit: Deposit;
  chain: string;
  now: number;
  expired: boolean;
  renewed: boolean;
  renewing: boolean;
  onRenew: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {renewed && !expired ? (
        <p role="status" className="text-sm font-medium text-ink">
          {COPY.newAddress}
        </p>
      ) : null}
      <div className="relative">
        {/* An expired price must not be paid: its address and QR blur behind the way to a new one (D-125). */}
        <div
          inert={expired}
          className={`flex flex-col gap-4 ${expired ? "select-none blur-sm" : ""}`}
        >
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:gap-4">
            <QrCode
              value={deposit.depositAddress}
              label={PAY_COPY.qr}
              className="w-26 border border-line p-1 sm:w-32"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <ExactAmount amount={deposit.amountIn} token={shown.token} />
              <p role="note" className="flex items-start gap-1.5 text-xs font-medium text-warning">
                <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                {COPY.sendOnly(shown.token.symbol, chain)}
              </p>
            </div>
          </div>
          <ReceiveAddress
            address={deposit.depositAddress}
            label={COPY.sendTo(shown.token.symbol, chain)}
          />
          <p className="text-xs text-muted">
            {COPY.extraBack} {COPY.refundsTo(shortAddress(shown.refundTo))}
          </p>
        </div>
        {expired ? (
          <div className="absolute inset-0 grid place-items-center">
            <div
              role="alert"
              className="flex max-w-xs flex-col items-center gap-2 rounded-md bg-surface p-4 text-center shadow-md"
            >
              <span className="font-medium text-ink">{COPY.expired}</span>
              <span className="text-sm text-muted">{COPY.expiredNote}</span>
              <Button size="sm" loading={renewing} onClick={onRenew}>
                {COPY.newPrice}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      {expired ? null : (
        <p className="text-sm text-muted tabular-nums" aria-live="off">
          {COPY.priceHeld(left(shown.shownUntil - now))}
        </p>
      )}
    </div>
  );
}

/** Detected on the payer's chain, Converting, Confirming on Base, Paid (R-238). */
function CrossChainProgress({ invoice, crossChain }: { invoice: Invoice; crossChain: CrossChain }) {
  const chain = blockchainName(crossChain.blockchain);
  const onBase = invoice.deposits.length > 0 || invoice.options.some((o) => o.deposits.length > 0);
  const paid = invoice.paymentStatus === "paid";
  const reached = paid ? 4 : onBase || crossChain.convertedAt ? 2 : 1;
  const labels = [
    COPY.steps.detected,
    COPY.steps.converting,
    COPY.steps.confirming,
    COPY.steps.paid,
  ];
  const steps: TimelineStep[] = labels.map((label, i) => ({
    label,
    state:
      i < reached
        ? STEP_STATES.complete
        : i === reached
          ? STEP_STATES.current
          : STEP_STATES.upcoming,
  }));
  const origin = crossChain.originTxs[0];
  return (
    <section
      aria-labelledby="pay-cross-progress"
      className={`flex flex-col gap-4 p-4 sm:p-5 ${ENTER}`}
    >
      <h2 id="pay-cross-progress" className="text-sm font-medium text-ink">
        {COPY.seenOn(chain)}
      </h2>
      <PaymentTimeline label={PAY_COPY.progress} steps={steps} />
      <p role="status" className="text-sm text-muted">
        {reached === 1 ? COPY.converting : PAY_COPY.updatesItself}
      </p>
      {origin?.explorerUrl ? (
        <a
          href={origin.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 self-start text-sm text-ink underline decoration-line-strong decoration-1 underline-offset-4 hover:decoration-2"
        >
          {COPY.originTx}
          <ExternalLink aria-hidden className="size-3.5" />
          <span className="sr-only">{PAY_COPY.newTab}</span>
        </a>
      ) : null}
    </section>
  );
}

const askedKey = (invoiceId: string) => `forwend:cross:${invoiceId}`;

/** What this tab asked a quote with; null without, or when storage is off. */
function readAsked(invoiceId: string): { assetId: string; refundTo: string } | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(askedKey(invoiceId)) ?? "null");
    const asked = value as { assetId?: unknown; refundTo?: unknown } | null;
    return typeof asked?.assetId === "string" && typeof asked.refundTo === "string"
      ? { assetId: asked.assetId, refundTo: asked.refundTo }
      : null;
  } catch {
    return null;
  }
}

function keepAsked(invoiceId: string, asked: { assetId: string; refundTo: string }) {
  try {
    sessionStorage.setItem(askedKey(invoiceId), JSON.stringify(asked));
  } catch {
    // Storage may be off: a reload asks for the refund address again.
  }
}

/** The one line a returned cross-chain payment leaves above the pay box, with the quote's ID for support. */
export function CrossChainEnded({ crossChain }: { crossChain: CrossChain }) {
  const line =
    crossChain.status === CROSS_CHAIN_STATUSES.incomplete
      ? COPY.incomplete
      : crossChain.status === CROSS_CHAIN_STATUSES.refunded
        ? COPY.refunded
        : COPY.failed;
  return (
    <div
      role="status"
      className="flex flex-col gap-1 border-b border-line px-4 py-3 text-sm sm:px-5"
    >
      <span className="text-ink">{line}</span>
      <span className="text-xs text-muted">{COPY.supportId(crossChain.quoteId)}</span>
    </div>
  );
}

function keptToken(c: CrossChain): Shown["token"] {
  return { assetId: c.assetId, blockchain: c.blockchain, symbol: c.symbol, decimals: c.decimals };
}

function fromKept(c: CrossChain): Shown {
  return {
    quoteId: c.quoteId,
    token: keptToken(c),
    refundTo: c.refundTo,
    shownUntil: Date.parse(c.shownUntil),
    signed: c.signed,
  };
}

// The api's error codes for a quote (docs/backend/api.md); anything else is 1Click not answering.
function quoteProblem(error: unknown): string {
  const code = (error as { data?: { error?: { code?: string } } } | undefined)?.data?.error?.code;
  switch (code) {
    case "below_minimum":
      return COPY.belowMinimum;
    case "invalid_value":
      return COPY.refused;
    case "too_many_quotes":
    case "rate_limited":
      return COPY.tooMany;
    default:
      return COPY.unavailable;
  }
}
