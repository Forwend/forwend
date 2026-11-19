"use client";

import { EmptyState, Sheet, Skeleton, StepTransition } from "@forwend/ui-web";
import { skipToken } from "@reduxjs/toolkit/query";
import { WalletMinimal } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { TwoStepSetup } from "@/features/auth/components/two-step-setup";
import { FRESH_SIGN_IN_COPY, TWO_STEP_COPY } from "@/features/auth/constants/auth-copy";
import type { Balances } from "@/features/balances/types/balances";
import { AMOUNT_ERRORS } from "@/features/invoices/constants/invoices";
import { parseTokenAmount } from "@/features/invoices/lib/invoices";
import type { Profile } from "@/features/profiles/types/profile";
import {
  useCancelSendMutation,
  useGetSendFeeQuery,
  usePrepareSendMutation,
} from "@/features/send/api/send-api";
import { SendAddressStep } from "@/features/send/components/send-address-step";
import { SendAmountStep } from "@/features/send/components/send-amount-step";
import { SendAssetStep } from "@/features/send/components/send-asset-step";
import { SendProgress } from "@/features/send/components/send-progress";
import { SendRecipientStep } from "@/features/send/components/send-recipient-step";
import { SendReview } from "@/features/send/components/send-review";
import { SEND_MODES, SEND_STEPS } from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import { useSendApproval } from "@/features/send/hooks/use-send-approval";
import {
  matchesRequest,
  roomForFee,
  sendError,
  sendOptions,
  transferTargets,
} from "@/features/send/lib/send";
import type {
  Recipient,
  Relay,
  Send,
  SendMode,
  SendOption,
  SendStep,
} from "@/features/send/types/send";
import { LoadError } from "@/shared/components/load-error";

export interface SendSheetProps {
  open: boolean;
  mode: SendMode;
  onOpenChange: (open: boolean) => void;
  profile: Profile;
  profiles: Profile[];
  balances: Balances | null;
  failed: boolean;
  onRetry: () => void;
  onSent: () => void;
}

const TITLES: Record<SendStep, string> = {
  [SEND_STEPS.to]: SEND_COPY.to,
  [SEND_STEPS.address]: SEND_COPY.walletAddress,
  [SEND_STEPS.asset]: SEND_COPY.what,
  [SEND_STEPS.amount]: SEND_COPY.amount,
  [SEND_STEPS.review]: SEND_COPY.review,
  [SEND_STEPS.confirm]: FRESH_SIGN_IN_COPY.title,
  [SEND_STEPS.progress]: "",
};

export function SendSheet({
  open,
  mode,
  onOpenChange,
  profile,
  profiles,
  balances,
  failed,
  onRetry,
  onSent,
}: SendSheetProps) {
  const own = transferTargets(profiles, profile);
  const first: SendStep =
    mode === SEND_MODES.send && own.length === 0 ? SEND_STEPS.address : SEND_STEPS.to;
  const [path, setPath] = useState<SendStep[]>([first]);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [option, setOption] = useState<SendOption | null>(null);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Send | null>(null);
  const [submitted, setSubmitted] = useState<Send | null>(null);
  const [relay, setRelay] = useState<Relay | null>(null);
  const [signing, setSigning] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [ticked, setTicked] = useState<string | null>(null);
  const [prepare, preparing] = usePrepareSendMutation();
  const [cancel] = useCancelSendMutation();
  const [wasOpen, setWasOpen] = useState(open);
  const [wasMode, setWasMode] = useState(mode);
  if (open !== wasOpen || mode !== wasMode) {
    setWasOpen(open);
    setWasMode(mode);
    if (open) {
      setPath([first]);
      setRecipient(null);
      setAddress("");
      setAddressError(null);
      setOption(null);
      setAmount("");
      setAmountError(null);
      setPrepared(null);
      setSubmitted(null);
      setSigning(false);
      setChecked([]);
      setTicked(null);
      preparing.reset();
    }
  }
  const shown = path[path.length - 1] ?? first;
  const options = sendOptions(balances);
  const sendable = options.filter((o) => o.sendable);

  const go = (next: SendStep) => setPath((p) => [...p, next]);
  const approval = useSendApproval({
    profileId: profile.profileId,
    send: prepared,
    onSigning: setSigning,
    onSubmitted: (s, r) => {
      setSubmitted(s);
      setRelay(r);
      go(SEND_STEPS.progress);
    },
  });
  const confirming =
    (approval.confirmStep !== null || approval.settingUp) && shown === SEND_STEPS.review;
  const step = confirming ? SEND_STEPS.confirm : shown;
  const back = () => {
    if (confirming) {
      approval.cancelConfirm();
      return;
    }
    setPath((p) => (p.length > 1 ? p.slice(0, -1) : p));
  };
  const toMoney = (to: Recipient) => {
    setRecipient(to);
    if (sendable.length === 1 && sendable[0]) {
      setOption(sendable[0]);
      go(SEND_STEPS.amount);
    } else go(SEND_STEPS.asset);
  };
  const close = (next: boolean) => {
    if (!next) {
      if (locked) return;
      approval.cancelConfirm();
      for (const sendId of checked) {
        if (sendId !== submitted?.sendId) cancel({ profileId: profile.profileId, sendId });
      }
    }
    onOpenChange(next);
  };

  const units = option ? parseTokenAmount(amount, option.decimals) : null;
  const recipientAddress = recipient
    ? "profile" in recipient
      ? (recipient.profile.walletAddress ?? "")
      : recipient.address
    : "";
  const feeRead = useGetSendFeeQuery(
    step === SEND_STEPS.amount && option
      ? {
          profileId: profile.profileId,
          chainId: option.chainId,
          token: option.token,
          to: recipientAddress,
        }
      : skipToken,
    { refetchOnMountOrArgChange: true },
  );
  const fee = feeRead.currentData ? BigInt(feeRead.currentData.amount) : null;
  const room = option ? roomForFee(option.balance, fee) : null;

  const submitAmount = async (event: FormEvent) => {
    event.preventDefault();
    if (!option || !recipient) return;
    if (typeof units !== "bigint") {
      setAmountError(
        units === AMOUNT_ERRORS.decimals
          ? SEND_COPY.amountDecimals(option.symbol, option.decimals)
          : units === AMOUNT_ERRORS.zero
            ? SEND_COPY.amountZero
            : SEND_COPY.amountFormat,
      );
      return;
    }
    if (units > (room ?? option.balance)) {
      setAmountError(fee ? SEND_COPY.moreThanBalanceWithFee : SEND_COPY.moreThanBalance);
      return;
    }
    setAmountError(null);
    const request = {
      chainId: option.chainId,
      token: option.token,
      amount: units.toString(),
      ...("profile" in recipient
        ? { toProfileId: recipient.profile.profileId }
        : { to: recipient.address }),
    };
    const result = await prepare({ profileId: profile.profileId, ...request })
      .unwrap()
      .catch((error: unknown) => {
        setAmountError(sendError(error));
        if (fee) void feeRead.refetch();
        return null;
      });
    if (!result) return;
    setChecked((c) => [...c, result.sendId]);
    if (
      !matchesRequest(result, request, {
        to: recipientAddress,
        from: profile.walletAddress ?? "",
        decimals: option.decimals,
      })
    ) {
      cancel({ profileId: profile.profileId, sendId: result.sendId });
      setAmountError(SEND_COPY.failedToPrepare);
      return;
    }
    setPrepared(result);
    go(SEND_STEPS.review);
  };

  const title =
    step === SEND_STEPS.to || step === SEND_STEPS.progress
      ? mode === SEND_MODES.transfer
        ? SEND_COPY.transfer
        : SEND_COPY.send
      : step === SEND_STEPS.confirm && approval.settingUp
        ? TWO_STEP_COPY.setUp
        : TITLES[step];
  const canGoBack = path.length > 1 && step !== SEND_STEPS.progress;
  // Once the approve or signing has started, closing can't stop the money.
  const locked = signing || approval.locked;

  let body: ReactNode;
  if (!profile.walletAddress) {
    body = <EmptyState compact icon={WalletMinimal} title={SEND_COPY.nothingToSend} />;
  } else if (!balances && failed) {
    body = <LoadError message={SEND_COPY.failedToPrepare} onRetry={onRetry} />;
  } else if (!balances) {
    body = (
      <div aria-hidden className="flex flex-col gap-2">
        <Skeleton className="h-4 w-14" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  } else if (step === SEND_STEPS.to) {
    body = (
      <SendRecipientStep
        mode={mode}
        own={own}
        onProfile={(p) => toMoney({ profile: p })}
        onAddress={() => go(SEND_STEPS.address)}
      />
    );
  } else if (step === SEND_STEPS.address) {
    body = (
      <SendAddressStep
        address={address}
        error={addressError}
        onAddress={setAddress}
        onError={setAddressError}
        onContinue={(to) => toMoney({ address: to })}
      />
    );
  } else if (step === SEND_STEPS.asset) {
    body = (
      <SendAssetStep
        options={options}
        onChoose={(o) => {
          setOption(o);
          setAmount("");
          setAmountError(null);
          go(SEND_STEPS.amount);
        }}
      />
    );
  } else if (step === SEND_STEPS.amount && option) {
    body = (
      <SendAmountStep
        option={option}
        amount={amount}
        error={amountError}
        fee={fee}
        feeFailed={feeRead.isError}
        room={room}
        preparing={preparing.isLoading}
        onAmount={(value) => {
          setAmount(value);
          setAmountError(null);
        }}
        onSubmit={submitAmount}
      />
    );
  } else if (step === SEND_STEPS.review && prepared && option && recipient) {
    body = (
      <SendReview
        mode={mode}
        send={prepared}
        option={option}
        from={profile}
        recipient={recipient}
        checked={ticked === prepared.sendId}
        onChecked={(on) => setTicked(on ? prepared.sendId : null)}
        working={approval.working}
        error={approval.error}
        canSign={approval.canSign}
        onHold={() => void approval.start()}
      />
    );
  } else if (step === SEND_STEPS.confirm) {
    body = approval.confirmStep ?? (
      <TwoStepSetup onDone={approval.endSetUp} onCancel={approval.endSetUp} />
    );
  } else if (step === SEND_STEPS.progress && submitted && option && recipient) {
    body = (
      <SendProgress
        profileId={profile.profileId}
        initial={submitted}
        relay={relay}
        option={option}
        recipient={recipient}
        onSent={onSent}
        onHolding={setSigning}
        onDone={() => close(false)}
      />
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title={title}
      onBack={canGoBack && !locked ? back : undefined}
      backLabel={SEND_COPY.back}
      locked={locked}
    >
      {/* A closed sheet holds no step, so nothing in it polls or signs. */}
      {open ? (
        <StepTransition step={step} label={title}>
          {body}
        </StepTransition>
      ) : null}
    </Sheet>
  );
}
