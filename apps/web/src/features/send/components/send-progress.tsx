"use client";

import { Button, buttonClasses, formatTokenAmount, Spinner, SuccessCheck } from "@forwend/ui-web";
import { CircleAlert, ExternalLink } from "lucide-react";
import { useEffect, useRef } from "react";
import { profileLabel } from "@/features/profiles/lib/profile";
import { useGetSendQuery, useSubmitSendMutation } from "@/features/send/api/send-api";
import type { Recipient } from "@/features/send/components/send-sheet";
import { SEND_FAILURES, SEND_POLL_MS, SEND_STATUSES } from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import { addressGroups, type SendOption } from "@/features/send/lib/send";
import type { Send } from "@/features/send/types/send";
import { txLink } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

export interface SendProgressProps {
  profileId: string;
  initial: Send;
  option: SendOption;
  recipient: Recipient;
  onSent: () => void;
  onDone: () => void;
}

const SETTLED: readonly string[] = [
  SEND_STATUSES.sent,
  SEND_STATUSES.failed,
  SEND_STATUSES.canceled,
];

// R-214: the chain, read through the server, says Sent; the browser's own answer only says it was signed.
export function SendProgress({
  profileId,
  initial,
  option,
  recipient,
  onSent,
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
  // A hash whose first report was lost is reported again: the server must know it to follow the money.
  const [submit] = useSubmitSendMutation();
  const hash = initial.txHash;
  const lost = read.currentData !== undefined && read.currentData.txHash === null;
  useEffect(() => {
    if (lost && hash) submit({ profileId, sendId: initial.sendId, txHash: hash });
  }, [lost, hash, submit, profileId, initial.sendId]);
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
    "profile" in recipient
      ? profileLabel(recipient.profile)
      : `${addressGroups(recipient.address).slice(0, 2).join("")}…${recipient.address.slice(-4)}`;
  const link = send.txHash ? txLink(send.chainId, send.txHash) : null;
  const failed = send.status === SEND_STATUSES.failed || send.status === SEND_STATUSES.canceled;
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
        <Button variant={sent || failed ? "primary" : "ghost"} className="w-full" onClick={onDone}>
          {SEND_COPY.done}
        </Button>
      </div>
    </div>
  );
}
