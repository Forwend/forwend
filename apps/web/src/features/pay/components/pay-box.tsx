import { Button, buttonClasses, StepTransition, shortAddress } from "@forwend/ui-web";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PaymentAmountsNotice } from "@/features/invoices/components/payment-amounts-notice";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import { CrossChainPay } from "@/features/pay/components/crosschain-pay";
import { CrossChainEnded, CrossChainProgress } from "@/features/pay/components/crosschain-progress";
import { HeldNote } from "@/features/pay/components/held-note";
import { type Choice, OptionPicker } from "@/features/pay/components/option-picker";
import { PaidReceipt } from "@/features/pay/components/paid-receipt";
import { PayReceived } from "@/features/pay/components/pay-received";
import { PayStatusLine } from "@/features/pay/components/pay-status";
import { PayWays } from "@/features/pay/components/pay-ways";
import { ReceiptEmail } from "@/features/pay/components/receipt-email";
import { SendAddress } from "@/features/pay/components/send-address";
import { TwoPress } from "@/features/pay/components/two-press";
import { CROSS_CHAIN_LEAST_MS } from "@/features/pay/constants/crosschain";
import { CLOSING_SOON_MS, PAY_STATES, PAY_WAYS } from "@/features/pay/constants/pay";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { useFound } from "@/features/pay/hooks/use-found";
import type { CrossChainTarget } from "@/features/pay/lib/crosschain";
import {
  checkoutClosesAt,
  heldOnOtherOptions,
  payeeName,
  payerNoticeOptions,
  stateLine,
} from "@/features/pay/lib/pay";
import { keepTab, readAsked, shownKey } from "@/features/pay/lib/tab-memory";
import type { EmbedLayout, PayStatus, PayToken } from "@/features/pay/types/pay";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { CROSS_CHAIN_STATUSES } from "@/shared/constants/chains";
import { ENTER } from "@/shared/constants/motion";
import { addressLink, chainName, crossChainEnded, lookalikeOf } from "@/shared/lib/chains";
import { amountText } from "@/shared/lib/money";

export interface PayBoxProps {
  invoice: Invoice;
  linkToken: string;
  address: string;
  token: PayToken;
  pay: PayStatus;
  now: number;
  readAt: number | null;
  choice: Choice | null;
  tabShown: string | null;
  kept: string | null;
  keep?: (optionId: string) => void;
  embed?: EmbedLayout;
  crossTarget: CrossChainTarget | null;
  preview: boolean;
}

export function PayBox({
  invoice,
  linkToken,
  address,
  token,
  pay,
  now,
  readAt,
  choice,
  tabShown,
  kept,
  keep,
  embed,
  crossTarget,
  preview,
}: PayBoxProps) {
  const picking = choice !== null && !choice.picked;
  // A canceled invoice takes no money on any option; invoice.closed is only the checkout's time.
  const canChoose =
    choice !== null &&
    pay.state !== PAY_STATES.canceled &&
    !invoice.closed &&
    choice.options.some(
      (option) => now < checkoutClosesAt({ closesAt: option.closesAt ?? invoice.closesAt }),
    );
  const network = chainName(invoice.chainId);
  // Found money locks the pick: paying again on another option would be a second payment.
  const found = useFound(linkToken, pay);
  const contract = addressLink(invoice.chainId, invoice.token);
  const optionId = invoice.optionId;
  // "" after Change, so the kept pick doesn't bring the old address back.
  const [shown, setShown] = useState(tabShown);
  const sendHeading = useRef<HTMLHeadingElement>(null);
  const beforeHeading = useRef<HTMLHeadingElement>(null);
  const [presses, setPresses] = useState(0);
  useEffect(() => {
    if (presses > 0) sendHeading.current?.focus();
  }, [presses]);
  const [restarts, setRestarts] = useState(0);
  useEffect(() => {
    if (restarts > 0) beforeHeading.current?.focus();
  }, [restarts]);
  // The heading is clipped off-screen: focusing it must not scroll the found line away.
  useEffect(() => {
    if (found > 0n && document.activeElement === document.body)
      sendHeading.current?.focus({ preventScroll: true });
  }, [found]);
  const show = () => {
    setShown(optionId);
    setPresses((n) => n + 1);
    keep?.(optionId);
    keepTab(shownKey(invoice.invoiceId), optionId);
  };
  const startOver = () => {
    setShown("");
    keepTab(shownKey(invoice.invoiceId), null);
    choice?.onPick(undefined);
    setRestarts((n) => n + 1);
  };
  const money = (units: bigint) => amountText(units, token);
  const done = pay.state === PAY_STATES.paid || pay.state === PAY_STATES.settled;
  const crossKept = invoice.crossChain;
  const [crossOpen, setCrossOpen] = useState(
    () =>
      crossKept?.status === CROSS_CHAIN_STATUSES.pending &&
      Date.parse(crossKept.shownUntil) > Date.now() &&
      // Turned off, a kept quote opens again only in the tab that asked for it.
      (invoice.crossChainOn !== false ||
        readAsked(invoice.invoiceId)?.assetId === crossKept.assetId),
  );
  const [viaTabs, setViaTabs] = useState(false);
  const tabsFocused = useCallback(() => setViaTabs(false), []);
  const sending = (shown ?? kept) === optionId && !picking;
  const seen =
    pay.state === PAY_STATES.confirming ||
    pay.state === PAY_STATES.checking ||
    pay.state === PAY_STATES.partial;
  const crossEnded = crossKept ? crossChainEnded(crossKept) : false;
  const crossSeen = Boolean(crossKept?.depositSeenAt) && !crossEnded;
  const crossAllowed =
    crossTarget !== null &&
    pay.canSend &&
    found === 0n &&
    !seen &&
    crossTarget.closesAt - now >= CROSS_CHAIN_LEAST_MS;
  // The payee's switch stops only new quotes: a kept one still shows, so the payer never pays twice.
  const crossOffered = crossAllowed && invoice.crossChainOn !== false;
  const crossing = crossTarget !== null && !done && (crossSeen || (crossOpen && crossAllowed));
  const folded = choice ? sending : sending || !pay.canSend;
  const statusFirst = seen && !pay.canSend;
  // A change within a state, such as a new block count, is no new phase.
  const phase = done
    ? "paid"
    : crossing
      ? crossSeen
        ? "converting"
        : "any-token"
      : statusFirst
        ? "seen"
        : folded
          ? "send"
          : "choose";
  const received = seen ? (
    <PayReceived
      invoice={invoice}
      linkToken={linkToken}
      pay={pay}
      token={token}
      network={network}
      now={now}
      readAt={readAt}
      lead={statusFirst}
    />
  ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="fw-panel">
        {crossEnded && crossKept && !done ? <CrossChainEnded crossChain={crossKept} /> : null}
        <StepTransition step={phase} label={COPY.payBox} className="mx-0 px-0">
          {done ? (
            <PaidReceipt invoice={invoice} linkToken={linkToken} token={token} embed={embed} />
          ) : crossing && crossSeen && crossKept ? (
            <CrossChainProgress
              invoice={invoice}
              crossChain={crossKept}
              now={now}
              readAt={readAt}
              confirming={pay.state === PAY_STATES.confirming}
              calm={!pay.closed && pay.state !== PAY_STATES.review}
              stateLine={stateLine(invoice, pay, token)}
              payee={payeeName(invoice)}
            />
          ) : crossing && crossTarget ? (
            <CrossChainPay
              invoice={invoice}
              linkToken={linkToken}
              receive={crossTarget.receive}
              due={crossTarget.due}
              now={now}
              viaTabs={viaTabs}
              onTabsFocused={tabsFocused}
              preview={preview}
              onDirect={() => {
                setViaTabs(true);
                setCrossOpen(false);
              }}
            />
          ) : (
            <>
              {statusFirst ? received : null}
              {statusFirst && folded ? null : (pay.canSend || canChoose) && folded ? (
                <section
                  aria-labelledby="pay-before"
                  className={`flex min-h-16 items-center gap-3 px-4 py-3 sm:px-5 ${ENTER}`}
                >
                  <h2
                    id="pay-before"
                    ref={beforeHeading}
                    tabIndex={-1}
                    className="w-20 shrink-0 text-sm text-muted outline-none"
                  >
                    {COPY.payWith}
                  </h2>
                  {choice && found === 0n ? (
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                      <TokenMark chainId={invoice.chainId} symbol={token.symbol} />
                      <TwoPress label={COPY.changeLabel} onConfirm={startOver} />
                    </div>
                  ) : (
                    <TokenMark chainId={invoice.chainId} symbol={token.symbol} />
                  )}
                </section>
              ) : pay.canSend || canChoose ? (
                <section
                  aria-labelledby="pay-before"
                  className={`flex flex-col gap-4 p-4 sm:p-5 ${ENTER}`}
                >
                  <h2
                    id="pay-before"
                    ref={beforeHeading}
                    tabIndex={-1}
                    className="text-sm font-medium text-ink outline-none"
                  >
                    {COPY.payWith}
                  </h2>
                  {crossOffered ? (
                    <PayWays
                      way={PAY_WAYS.direct}
                      focused={viaTabs}
                      onFocused={tabsFocused}
                      onChange={() => {
                        setViaTabs(true);
                        setCrossOpen(true);
                      }}
                    />
                  ) : null}
                  {choice ? (
                    <OptionPicker {...choice} />
                  ) : (
                    <TokenMark chainId={invoice.chainId} symbol={token.symbol} />
                  )}
                  {!pay.canSend || picking ? null : (
                    <div className={choice ? ENTER : undefined}>
                      <Button size="lg" className="w-full" onClick={show}>
                        {COPY.showAddress}
                      </Button>
                    </div>
                  )}
                </section>
              ) : null}
              {pay.canSend && sending ? (
                <section
                  aria-labelledby="pay-send"
                  className={`flex flex-col gap-4 border-t border-line p-4 sm:p-5 ${ENTER}`}
                >
                  <h2 id="pay-send" ref={sendHeading} tabIndex={-1} className="sr-only">
                    {COPY.sendTo(token.symbol, network)}
                  </h2>
                  <SendAddress
                    address={address}
                    amount={pay.remaining}
                    token={token}
                    network={network}
                    lookalike={lookalikeOf(invoice.chainId, token.symbol)}
                  />
                  {contract ? (
                    <p className="text-xs text-muted">
                      {COPY.contract(token.symbol)}{" "}
                      <a
                        href={contract.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-ink underline decoration-line-strong decoration-1 underline-offset-4 hover:decoration-2"
                      >
                        {shortAddress(invoice.token)}
                        {/* Never the full contract address here: next to the one to pay, it could be copied instead. */}
                        <span className="sr-only">{` on ${contract.name}${COPY.newTab}`}</span>
                      </a>
                    </p>
                  ) : null}
                  <p className="text-xs text-muted">
                    {checkoutClosesAt(invoice) - now < CLOSING_SOON_MS
                      ? `${COPY.closingSoon} `
                      : null}
                    {COPY.exchange(money(pay.remaining), network)}
                  </p>
                </section>
              ) : null}
              {seen ? (
                statusFirst ? null : (
                  received
                )
              ) : pay.state === PAY_STATES.waiting && !sending ? null : (
                <PayStatusLine
                  invoice={invoice}
                  linkToken={linkToken}
                  pay={pay}
                  token={token}
                  network={network}
                  bordered={pay.canSend}
                  choosable={canChoose}
                />
              )}
            </>
          )}
        </StepTransition>
        {seen || done ? <ReceiptEmail linkToken={linkToken} paid={done} /> : null}
      </div>
      <PaymentAmountsNotice
        options={payerNoticeOptions(invoice.options)}
        showVerification={pay.state !== PAY_STATES.review}
      />
      {/* A closed checkout's status line already names all its held money, late money included. */}
      {pay.late > 0n && pay.state !== PAY_STATES.closedPartial ? (
        <HeldNote>{COPY.late(money(pay.late))}</HeldNote>
      ) : null}
      {invoice.replacedBy?.payToken ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink">
          {COPY.replaced(invoiceNumber(invoice.replacedBy.number))}
          <Link
            href={`/pay/${invoice.replacedBy.payToken}`}
            target={embed ? "_blank" : undefined}
            rel={embed ? "noopener" : undefined}
            className={buttonClasses({ size: "sm", variant: "secondary" })}
          >
            {COPY.openReplacement(invoiceNumber(invoice.replacedBy.number))}
          </Link>
        </p>
      ) : null}
      {pay.state === PAY_STATES.canceled && pay.received > 0n ? (
        <HeldNote>{COPY.canceledHeld(money(pay.received))}</HeldNote>
      ) : null}
      {heldOnOtherOptions(invoice).map((held) => (
        <HeldNote key={held.optionId}>
          {COPY.otherOption(amountText(held.units, held.token), chainName(held.chainId))}
        </HeldNote>
      ))}
    </div>
  );
}
