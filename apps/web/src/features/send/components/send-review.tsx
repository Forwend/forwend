"use client";

import {
  Button,
  Checkbox,
  FullAddress,
  formatTokenAmount,
  HoldButton,
  NOTICE_TONES,
  Notice,
  TruncatedAddress,
} from "@forwend/ui-web";
import type { ReactNode } from "react";
import { TWO_STEP_COPY } from "@/features/auth/constants/auth-copy";
import { useWalletMfa } from "@/features/auth/hooks/use-wallet-mfa";
import { profileLabel } from "@/features/profiles/lib/profile";
import type { Profile } from "@/features/profiles/types/profile";
import { SEND_MODES, SEND_WARNINGS } from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import { feeLabel, feeShown } from "@/features/send/lib/send";
import type { Recipient, Send, SendMode, SendOption } from "@/features/send/types/send";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

export interface SendReviewProps {
  mode: SendMode;
  send: Send;
  option: SendOption;
  from: Profile;
  recipient: Recipient;
  /** The owner ticked that they checked the address a warning names. */
  checked: boolean;
  onChecked: (checked: boolean) => void;
  /** The send is being approved and signed (useSendApproval). */
  working: boolean;
  error: string | null;
  canSign: boolean;
  onHold: () => void;
}

// The Summary: the one screen the owner reads before signing, as Privy shows none of its own (R-213). A first send to
// an address, or one to a contract, asks the owner to tick that they checked it, so a warning can't be passed by
// habit. Every value shown is the server's send, which is what Privy signs; the sheet refused it if it differs from
// the request. Send is held, not clicked: a stray tap or Enter can't move money.
export function SendReview({
  mode,
  send,
  option,
  from,
  recipient,
  checked,
  onChecked,
  working,
  error,
  canSign,
  onHold,
}: SendReviewProps) {
  const units = BigInt(send.amount);
  const amount = formatTokenAmount({
    baseUnits: units,
    decimals: option.decimals,
    fractionDigits: exactDigits(units, option.decimals),
  });
  const needsCheck = send.warnings.length > 0;
  const mfa = useWalletMfa();
  const fee = BigInt(send.networkFee.amount);
  const label =
    mode === SEND_MODES.transfer
      ? SEND_COPY.transferAmount(`${amount} ${option.symbol}`)
      : SEND_COPY.sendAmount(`${amount} ${option.symbol}`);

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
          {/* The server finds the other profile's wallet itself, so it reads short like From. A pasted address shows
              whole: the owner ticks that they checked it, and a look-alike copies only its start and end. */}
          {"profile" in recipient ? (
            <>
              <span className="block text-ink">{profileLabel(recipient.profile)}</span>
              <TruncatedAddress address={send.to} mono={false} className="text-xs text-muted" />
            </>
          ) : (
            <FullAddress address={send.to} />
          )}
        </Row>
        <Row term={SEND_COPY.network}>{chainName(send.chainId)}</Row>
        <Row term={SEND_COPY.networkFee}>
          <span className="tabular-nums">{feeLabel(fee, option)}</span>
        </Row>
        {fee === 0n ? null : (
          // The amount and the fee come from one balance: the total is what leaves the wallet, at most.
          <Row term={SEND_COPY.total}>
            <span className="font-medium tabular-nums">
              {SEND_COPY.approx(
                `${formatTokenAmount({
                  baseUnits: units + feeShown(fee, option.decimals),
                  decimals: option.decimals,
                  fractionDigits: exactDigits(
                    units + feeShown(fee, option.decimals),
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
          onChange={(e) => onChecked(e.target.checked)}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {/* R-219: Privy asks for two-step before it signs. Until it is set up, this sets it up as the sheet's next step,
          then the Summary comes back with Send. */}
      {mfa.needed ? (
        <Button className="w-full" disabled={needsCheck && !checked} onClick={onHold}>
          {TWO_STEP_COPY.setUp}
        </Button>
      ) : (
        <HoldButton
          className="w-full"
          disabled={!canSign || (needsCheck && !checked)}
          loading={working || !canSign}
          onHold={onHold}
        >
          {label}
        </HoldButton>
      )}
      {/* The setup signs nothing, so it waits for no wallet. */}
      {mfa.needed || !canSign ? (
        <p className="-mt-3 text-center text-xs text-balance text-muted">
          {mfa.needed ? SEND_COPY.setUpMfa : SEND_COPY.walletLoading}
        </p>
      ) : null}
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
