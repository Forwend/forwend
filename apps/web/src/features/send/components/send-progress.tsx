"use client";

import {
  Button,
  buttonClasses,
  formatTokenAmount,
  Spinner,
  SuccessCheck,
  shortAddress,
} from "@forwend/ui-web";
import { CircleAlert, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { profileLabel } from "@/features/profiles/lib/profile";
import { useGetSendQuery, useSubmitSendMutation } from "@/features/send/api/send-api";
import {
  FEE_PAYERS,
  SEND_FAILURES,
  SEND_POLL_MS,
  SEND_STATUSES,
} from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import type { Recipient, Relay, Send, SendOption } from "@/features/send/types/send";
import { txLink } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

export interface SendProgressProps {
  profileId: string;
  initial: Send;
  /** A paymaster send's signature, sent again while the server shows it unsent and its request is valid. */
  relay?: Relay | null;
  option: SendOption;
  recipient: Recipient;
  onSent: () => void;
  /** True until the server holds the hash: the sheet can't close then. */
  onHolding: (holding: boolean) => void;
  onDone: () => void;
}

// R-214: the chain, read through the server, says Sent; the browser's own answer only says it was signed.
export function SendProgress({
  profileId,
  initial,
  relay,
  option,
  recipient,
  onSent,
  onHolding,
  onDone,
}: SendProgressProps) {
  // Each read can cost the api a chain call: none while the tab is hidden, none once the send is over.
  const [polling, setPolling] = useState(true);
  const read = useGetSendQuery(
    { profileId, sendId: initial.sendId },
    { pollingInterval: polling ? SEND_POLL_MS : 0, skipPollingIfUnfocused: true },
  );
  const send = read.currentData ?? initial;
  const readAt = read.fulfilledTimeStamp;
  // A refusal (not a lost connection) won't change on the next try: the sheet may close, and the watcher still shows
  // the transfer in Transactions.
  const [refused, setRefused] = useState(false);
  // A paymaster send the server shows approved or expired never reached it, or Privy answered and the server lost
  // that: the same signed request again is safe, as Privy sends it once. Once it expires (the server refuses it by
  // its own clock) the send is over. A wallet-paid send has its hash to report instead.
  const relayLate = relay != null && readAt !== undefined && readAt >= relay.until;
  const unsent = send.status === SEND_STATUSES.expired && relay != null && (relayLate || refused);
  // Sent is followed until final: the note then says it arrived, and a reorg shows as Sending again.
  const settled =
    send.status === SEND_STATUSES.failed ||
    unsent ||
    (send.status === SEND_STATUSES.sent && send.final);
  useEffect(() => setPolling(!settled), [settled]);
  // A hash the server doesn't have yet is reported again on every read: the server must know it to follow the money.
  // It takes the hash for a send whose approval ended meanwhile too.
  const [submit] = useSubmitSendMutation();
  const hash = initial.txHash;
  const lost = read.currentData !== undefined && read.currentData.txHash === null;
  const relayLost =
    relay != null &&
    !relayLate &&
    !refused &&
    (read.currentData?.status === SEND_STATUSES.approved ||
      read.currentData?.status === SEND_STATUSES.expired);
  // One at a time: a relay can take the server 25 s, and reads come every 1.5 s.
  const relaying = useRef(false);
  useEffect(() => {
    if (!relayLost || !relay || !readAt || relaying.current) return;
    relaying.current = true;
    submit({ profileId, sendId: initial.sendId, signature: relay.signature })
      .unwrap()
      .catch((e: { status?: unknown }) => {
        if (e.status === 404 || e.status === 422) setRefused(true);
      })
      .finally(() => {
        relaying.current = false;
      });
  }, [relayLost, relay, readAt, submit, profileId, initial.sendId]);
  useEffect(() => {
    if (!lost || !hash || !readAt) return;
    submit({ profileId, sendId: initial.sendId, txHash: hash })
      .unwrap()
      .catch((e: { status?: unknown }) => {
        if (e.status === 404 || e.status === 422) setRefused(true);
      });
  }, [lost, hash, readAt, submit, profileId, initial.sendId]);
  // Locked until the server holds the hash, unless the server can't be reached: then the owner may leave, and the
  // transfer still shows in Transactions once the watcher records it. A paymaster send has no hash to report: the
  // server already holds its signed request (R-225).
  // read.error stays until a read succeeds, so a retry in flight doesn't lock the sheet again.
  const unreachable = read.error !== undefined;
  const holding =
    send.networkFee.paidBy !== FEE_PAYERS.paymaster &&
    read.currentData?.txHash == null &&
    !unreachable &&
    !refused;
  useEffect(() => onHolding(holding), [holding, onHolding]);
  const told = useRef(false);
  useEffect(() => {
    if (send.status === SEND_STATUSES.sent && !told.current) {
      told.current = true;
      onSent();
    }
  }, [send.status, onSent]);

  const units = BigInt(send.amount);
  const amount = `${formatTokenAmount({ baseUnits: units, decimals: option.decimals, fractionDigits: exactDigits(units, option.decimals) })} ${option.symbol}`;
  const to =
    "profile" in recipient ? profileLabel(recipient.profile) : shortAddress(recipient.address);
  const link = send.txHash ? txLink(send.chainId, send.txHash) : null;
  const failed = send.status === SEND_STATUSES.failed || unsent;
  const sent = send.status === SEND_STATUSES.sent;

  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <div className="grid size-16 place-items-center">
        {sent ? (
          <SuccessCheck label={SEND_COPY.sent} className="size-14" />
        ) : failed ? (
          <CircleAlert aria-hidden className="size-12 text-danger" />
        ) : (
          <Spinner label={SEND_COPY.sending} size="xl" />
        )}
      </div>
      <div aria-live="polite" className="flex flex-col gap-1">
        <h3 className="text-xl font-medium text-ink">
          {sent ? SEND_COPY.sent : failed ? SEND_COPY.failed : SEND_COPY.sending}
        </h3>
        <p className="max-w-xs text-sm text-muted">
          {sent
            ? send.final
              ? SEND_COPY.arrived(amount, to)
              : SEND_COPY.sentNote(amount, to)
            : failed
              ? unsent
                ? SEND_COPY.notSent
                : send.failure === SEND_FAILURES.dropped
                  ? SEND_COPY.dropped
                  : SEND_COPY.reverted
              : SEND_COPY.sendingNote}
        </p>
      </div>
      {unreachable && !sent && !failed ? (
        <p role="status" className="text-sm text-muted">
          {SEND_COPY.unreachable}
        </p>
      ) : null}
      <div className="flex w-full flex-col gap-2">
        {link ? (
          <a
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className={`${buttonClasses({ variant: "secondary" })} w-full`}
          >
            {SEND_COPY.viewOn(link.name)}
            <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
          </a>
        ) : null}
        <Button
          variant={sent || failed ? "primary" : "ghost"}
          className="w-full"
          disabled={holding}
          onClick={onDone}
        >
          {SEND_COPY.done}
        </Button>
      </div>
    </div>
  );
}
