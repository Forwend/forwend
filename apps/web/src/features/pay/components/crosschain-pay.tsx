"use client";

import { Button, Notice, Skeleton, TextField, TruncatedAddress } from "@forwend/ui-web";
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Invoice } from "@/features/invoices/types/invoices";
import {
  useCreateCrossQuoteMutation,
  useGetCrossPriceQuery,
  useGetCrossTokensQuery,
} from "@/features/pay/api/crosschain-api";
import { CrossChainPicker } from "@/features/pay/components/crosschain-picker";
import { CrossChainPrice } from "@/features/pay/components/crosschain-price";
import { PayWays } from "@/features/pay/components/pay-ways";
import { SendAddress } from "@/features/pay/components/send-address";
import { TwoPress } from "@/features/pay/components/two-press";
import { AmountRows } from "@/features/pay/components/you-send";
import { FADE, PAY_WAYS } from "@/features/pay/constants/pay";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";
import {
  quoteProblem,
  signedDeposit,
  slippageCoversRefundFee,
  verifyQuote,
} from "@/features/pay/lib/crosschain";
import { amountText } from "@/features/pay/lib/pay";
import { keepAsked, readAsked } from "@/features/pay/lib/tab-memory";
import type { CrossChain, CrossToken } from "@/features/pay/types/crosschain";
import { PoweredByNearIntents } from "@/shared/components/chains/near-intents";
import { MarkIcon } from "@/shared/components/chains/token-mark";
import { LineSkeleton } from "@/shared/components/rows-skeleton";
import {
  BLOCKCHAIN_ICONS,
  CROSS_CHAIN_STATUSES,
  CROSS_CHAIN_TARGET,
  CROSS_CHAIN_TOKEN_ICONS,
} from "@/shared/constants/chains";
import { ENTER } from "@/shared/constants/motion";
import { blockchainName, chainLogo, iconOf, tokenLogo } from "@/shared/lib/chains";

const COPY = PAY_COPY.crossChain;

/** Its address and amount are read from the signed answer once it verifies, never from the api's fields. */
interface Shown {
  quoteId: string;
  token: Pick<CrossToken, "assetId" | "blockchain" | "symbol" | "decimals" | "coingeckoId">;
  refundTo: string;
  shownUntil: number;
  signed: unknown;
}

type Deposit = NonNullable<ReturnType<typeof signedDeposit>>;

export interface CrossChainPayProps {
  invoice: Invoice;
  linkToken: string;
  receive: string;
  due: bigint; // exactly what the quote must deliver
  now: number;
  onDirect: () => void;
  viaTabs: boolean;
  onTabsFocused: () => void;
  preview: boolean;
}

const left = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function CrossChainPay({
  invoice,
  linkToken,
  receive,
  due,
  now,
  onDirect,
  viaTabs,
  onTabsFocused,
  preview,
}: CrossChainPayProps) {
  const kept = invoice.crossChain ?? null;
  const [picking, setPicking] = useState(false);
  // A reload shows a kept quote only for this tab's refund address: the api's copy could be anyone's.
  const [asked] = useState(() => readAsked(invoice.invoiceId));
  const [token, setToken] = useState<Shown["token"] | null>(kept ? keptToken(kept) : null);
  const [refundTo, setRefundTo] = useState(asked?.refundTo ?? "");
  const heading = useRef<HTMLHeadingElement>(null);
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
  // A new price whose amount differs waits for Understood before its QR shows.
  const [changedFrom, setChangedFrom] = useState<bigint | null>(null);
  const [renewed, setRenewed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const tokens = useGetCrossTokensQuery(linkToken, { skip: !picking && token !== null });
  const price = useGetCrossPriceQuery(
    { payToken: linkToken, originAsset: token?.assetId ?? "" },
    { skip: !token || shown !== null },
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
      if (current) setDeposit((ok && signedDeposit(shown.signed, shown.token.decimals)) || false);
    });
    return () => {
      current = false;
    };
  }, [shown, receive, due]);

  const addressShown = shown !== null;
  useEffect(() => {
    if (!viaTabs || !addressShown) return;
    heading.current?.focus();
    onTabsFocused();
  }, [viaTabs, addressShown, onTabsFocused]);

  const forgetQuote = () => {
    setShown(null);
    setProblem(null);
    setChangedFrom(null);
    setRenewed(false);
    heading.current?.focus();
  };

  const ask = async (renewing: boolean) => {
    if (!token) return;
    setProblem(null);
    const result = await createQuote({
      payToken: linkToken,
      originAsset: token.assetId,
      refundTo: refundTo.trim(),
      preview,
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
    const next = signedDeposit(q.signed, token.decimals);
    if (renewing && before && next) {
      setChangedFrom(next.send === before.send ? null : before.send);
      setRenewed(next.send === before.send);
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

  const chain = token ? blockchainName(token.blockchain) : "";
  const expired = shown !== null && now >= shown.shownUntil;
  return (
    <section aria-labelledby="pay-cross" className={`flex flex-col gap-4 p-4 sm:p-5 ${ENTER}`}>
      <div className={shown ? "flex min-h-10 items-center gap-3" : "flex flex-col gap-4"}>
        <h2
          id="pay-cross"
          ref={heading}
          tabIndex={-1}
          className={`text-sm outline-none ${shown ? "w-20 shrink-0 text-muted" : "font-medium text-ink"}`}
        >
          {PAY_COPY.payWith}
        </h2>
        {shown ? (
          <>
            <CrossMark token={shown.token} />
            <TwoPress onConfirm={forgetQuote} className="ml-auto" />
          </>
        ) : (
          <>
            <PayWays
              way={PAY_WAYS.cross}
              onChange={onDirect}
              focused={viaTabs}
              onFocused={onTabsFocused}
            />
            {token ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                <CrossMark token={token} />
                <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
                  {PAY_COPY.change}
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => setPicking(true)}
              >
                {PAY_COPY.chooseToken}
              </Button>
            )}
          </>
        )}
      </div>
      <CrossChainPicker
        open={picking}
        onOpenChange={setPicking}
        tokens={tokens.data?.tokens}
        due={tokens.data ? BigInt(tokens.data.due) : undefined}
        dueDecimals={tokens.data?.decimals ?? CROSS_CHAIN_TARGET.decimals}
        onPick={(picked) => {
          // An address on one chain is no address on another: the payer types the new chain's.
          if (picked.blockchain !== token?.blockchain) setRefundTo("");
          setToken(picked);
          forgetQuote();
        }}
      />
      {token && !shown ? (
        <>
          <CrossChainPrice
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
            {PAY_COPY.showAddress}
          </Button>
        </>
      ) : null}
      {shown && deposit === null ? (
        <div aria-hidden className="flex flex-col gap-4">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:gap-4">
            <Skeleton className="size-26 sm:size-32" />
            <div className="flex flex-col gap-2">
              <LineSkeleton size="text-xs" className="w-16" />
              <Skeleton className="h-11 w-full" />
              <LineSkeleton size="text-xs" className="w-40 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-18 w-full" />
        </div>
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
            amountText(deposit.send, shown.token),
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
    </section>
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
    <div className={`flex flex-col gap-4 ${FADE}`}>
      {renewed && !expired ? (
        <p role="status" className="text-sm font-medium text-ink">
          {COPY.newAddress}
        </p>
      ) : null}
      <div className="relative">
        {/* An expired price must not be paid: its address and QR blur behind the way to a new one. */}
        <div
          inert={expired}
          className={`flex flex-col gap-4 ${expired ? "select-none blur-sm" : ""}`}
        >
          <SendAddress
            address={deposit.depositAddress}
            amount={deposit.send}
            token={shown.token}
            network={chain}
          />
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
      <AmountRows
        className="border-t border-line pt-3"
        rows={[
          ...(expired
            ? []
            : [
                {
                  term: COPY.priceHeldRow,
                  // A screen reader hears the timer once, not every second.
                  value: <span aria-live="off">{left(shown.shownUntil - now)}</span>,
                },
              ]),
          {
            term: COPY.refundsTo,
            value: <TruncatedAddress address={shown.refundTo} className="text-xs" />,
          },
          { term: COPY.refundFeeRow, value: amountText(deposit.refundFee, shown.token) },
        ]}
      />
      {slippageCoversRefundFee(deposit.send, deposit.minAmountIn, deposit.refundFee) ? null : (
        <p role="note" className="flex items-start gap-1.5 text-xs font-medium text-warning">
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          {COPY.slippageUnderFee}
        </p>
      )}
      <PoweredByNearIntents />
    </div>
  );
}

function CrossMark({ token }: { token: Shown["token"] }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <MarkIcon
        token={iconOf(CROSS_CHAIN_TOKEN_ICONS, token.symbol)}
        chain={iconOf(BLOCKCHAIN_ICONS, token.blockchain)}
        letter={token.symbol.slice(0, 1)}
        logo={tokenLogo(token.coingeckoId)}
        chainLogo={chainLogo(token.blockchain)}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-ink">{token.symbol}</span>
        <span className="truncate text-xs text-muted">{blockchainName(token.blockchain)}</span>
      </span>
    </span>
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
