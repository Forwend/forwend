"use client";

import {
  Button,
  Checkbox,
  formatTokenAmount,
  NOTICE_TONES,
  Notice,
  TruncatedAddress,
} from "@forwend/ui-web";
import { type ReactNode, useState } from "react";
import { profileLabel } from "@/features/profiles/lib/profile";
import type { Profile } from "@/features/profiles/types/profile";
import { useSubmitSendMutation } from "@/features/send/api/send-api";
import { SEND_MODES, SEND_STATUSES, SEND_WARNINGS } from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import { useSignSend } from "@/features/send/hooks/use-sign-send";
import { feeText } from "@/features/send/lib/send";
import type { Recipient, Send, SendMode, SendOption } from "@/features/send/types/send";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

export interface SendReviewProps {
  mode: SendMode;
  send: Send;
  option: SendOption;
  from: Profile;
  recipient: Recipient;
  /** True while Privy signs: the sheet can't close then. */
  onSigning: (signing: boolean) => void;
  onSubmitted: (send: Send) => void;
}

// The one screen the owner reads before signing: Privy shows none of its own (R-213). A first send to an address,
// or one to a contract, asks the owner to tick that they checked it, so a warning can't be passed by habit.
// Every value shown is the server's send, which is what Privy signs; the sheet refused it if it differs from the
// request.
export function SendReview({
  mode,
  send,
  option,
  from,
  recipient,
  onSigning,
  onSubmitted,
}: SendReviewProps) {
  const { sign, canSign } = useSignSend(send.from);
  const [submit] = useSubmitSendMutation();
  const [checked, setChecked] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const units = BigInt(send.amount);
  const amount = formatTokenAmount({
    baseUnits: units,
    decimals: option.decimals,
    fractionDigits: exactDigits(units, option.decimals),
  });
  const needsCheck = send.warnings.length > 0;
  const label =
    mode === SEND_MODES.transfer
      ? SEND_COPY.transferAmount(`${amount} ${option.symbol}`)
      : SEND_COPY.sendAmount(`${amount} ${option.symbol}`);

  const confirm = async () => {
    setWorking(true);
    onSigning(true);
    setError(null);
    let hash: string;
    try {
      hash = await sign(send);
    } catch {
      setError(SEND_COPY.signFailed);
      setWorking(false);
      onSigning(false);
      return;
    }
    // The money is moving now. The sheet stays locked until the progress step holds the hash, which it reports
    // again if this report is lost; the progress step lifts the lock, so it never opens in between.
    const reported = await submit({ profileId: from.profileId, sendId: send.sendId, txHash: hash })
      .unwrap()
      .catch(() => null);
    onSubmitted(reported ?? { ...send, status: SEND_STATUSES.sending, txHash: hash });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-1 py-2 text-center">
        <p className="text-4xl font-medium tracking-tight text-ink tabular-nums">
          {amount} <span className="text-2xl text-muted">{option.symbol}</span>
        </p>
      </div>
      <dl className="divide-y divide-line rounded-md border border-line text-sm">
        <Row term={SEND_COPY.from}>
          <span className="block text-ink">{profileLabel(from)}</span>
          <TruncatedAddress address={send.from} mono={false} className="text-xs text-muted" />
        </Row>
        <Row term={SEND_COPY.to}>
          {"profile" in recipient ? (
            <>
              <span className="block text-ink">{profileLabel(recipient.profile)}</span>
              <TruncatedAddress address={send.to} mono={false} className="text-xs text-muted" />
            </>
          ) : (
            <TruncatedAddress address={send.to} mono={false} className="text-ink" />
          )}
        </Row>
        <Row term={SEND_COPY.network}>{chainName(send.chainId)}</Row>
        <Row term={SEND_COPY.networkFee}>{feeText(send, option)}</Row>
        <Row term={SEND_COPY.theyGet}>
          <span className="font-medium tabular-nums">
            {amount} {option.symbol}
          </span>
        </Row>
        {send.networkFee.amount === "0" ? null : (
          <Row term={SEND_COPY.total}>
            <span className="tabular-nums">
              {SEND_COPY.upTo(
                `${formatTokenAmount({
                  baseUnits: units + BigInt(send.networkFee.amount),
                  decimals: option.decimals,
                  fractionDigits: exactDigits(
                    units + BigInt(send.networkFee.amount),
                    option.decimals,
                  ),
                })} ${option.symbol}`,
              )}
            </span>
          </Row>
        )}
      </dl>
      {send.warnings.includes(SEND_WARNINGS.contract) ? (
        <Notice tone={NOTICE_TONES.danger}>{SEND_COPY.contract}</Notice>
      ) : null}
      {send.warnings.includes(SEND_WARNINGS.newRecipient) ? (
        <Notice>{SEND_COPY.newRecipient}</Notice>
      ) : null}
      {needsCheck ? (
        <Checkbox
          label={SEND_COPY.checked}
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button
        className="w-full"
        disabled={!canSign || (needsCheck && !checked)}
        loading={working || !canSign}
        onClick={confirm}
      >
        {label}
      </Button>
      {canSign ? null : (
        <p className="-mt-3 text-center text-xs text-muted">{SEND_COPY.walletLoading}</p>
      )}
    </div>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="shrink-0 text-muted">{term}</dt>
      <dd className="min-w-0 text-right text-ink">{children}</dd>
    </div>
  );
}
