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
import { SEND_FAILURES, SEND_POLL_MS, SEND_STATUSES } from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import type { Recipient, Send, SendOption } from "@/features/send/types/send";
import { txLink } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

export interface SendProgressProps {
  profileId: string;
  initial: Send;
  option: SendOption;
  recipient: Recipient;
  onSent: () => void;
  /** True until the server holds the hash: the sheet can't close then. */
  onHolding: (holding: boolean) => void;
  onDone: () => void;
}

const SETTLED: readonly string[] = [SEND_STATUSES.sent, SEND_STATUSES.failed];

// R-214: the chain, read through the server, says Sent; the browser's own answer only says it was signed.
export function SendProgress({
  profileId,
  initial,
  option,
  recipient,
  onSent,
  onHolding,
  onDone,
}: SendProgressProps) {
  const read = useGetSendQuery({ profileId, sendId: initial.sendId });
  const send = read.currentData ?? initial;
  const settled = SETTLED.includes(send.status);
  const { refetch } = read;
  useEffect(() => {
    if (settled) return;
    const timer = setInterval(refetch, SEND_POLL_MS);
    return () => clearInterval(timer);
  }, [settled, refetch]);
  // A hash the server doesn't have yet is reported again on every read: the server must know it to follow the money.
  // It takes the hash for a send that expired or was replaced meanwhile too.
  const [submit] = useSubmitSendMutation();
  const hash = initial.txHash;
  const lost = read.currentData !== undefined && read.currentData.txHash === null;
  const readAt = read.fulfilledTimeStamp;
  // A refusal (not a lost connection) won't change on the next try: the sheet may close, and the watcher still shows
  // the transfer in Transactions.
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    if (!lost || !hash || !readAt) return;
    submit({ profileId, sendId: initial.sendId, txHash: hash })
      .unwrap()
      .catch((e: { status?: unknown }) => {
        if (e.status === 404 || e.status === 422) setRefused(true);
      });
  }, [lost, hash, readAt, submit, profileId, initial.sendId]);
  const holding = read.currentData?.txHash == null && !refused;
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
  const failed = send.status === SEND_STATUSES.failed;
  const sent = send.status === SEND_STATUSES.sent;

  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <div className="grid size-16 place-items-center">
        {sent ? (
          <SuccessCheck label={SEND_COPY.sent} className="size-14" />
        ) : failed ? (
          <CircleAlert aria-hidden className="size-12 text-danger" />
        ) : (
          <Spinner label={SEND_COPY.sending} className="size-12" />
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
              ? send.failure === SEND_FAILURES.dropped
                ? SEND_COPY.dropped
                : SEND_COPY.reverted
              : SEND_COPY.sendingNote}
        </p>
      </div>
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
