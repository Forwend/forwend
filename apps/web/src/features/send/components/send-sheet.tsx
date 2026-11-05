"use client";

import {
  AmountField,
  Button,
  EmptyState,
  formatTokenAmount,
  RowButton,
  Sheet,
  Skeleton,
  STEP_DIRECTIONS,
  type StepDirection,
  StepTransition,
  TextField,
} from "@forwend/ui-web";
import { ChevronRight, Users, WalletMinimal } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useFreshSignIn } from "@/features/auth/components/fresh-sign-in";
import type { Balances } from "@/features/balances/types/balances";
import { AMOUNT_ERRORS } from "@/features/invoices/constants/invoices";
import { parseTokenAmount } from "@/features/invoices/lib/invoices";
import { profileLabel } from "@/features/profiles/lib/profile";
import type { Profile } from "@/features/profiles/types/profile";
import { useCancelSendMutation, usePrepareSendMutation } from "@/features/send/api/send-api";
import { SendProgress } from "@/features/send/components/send-progress";
import { SendReview } from "@/features/send/components/send-review";
import { SEND_MODES, SEND_STEPS } from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import {
  isWalletAddress,
  matchesRequest,
  maxAmount,
  sendError,
  sendOptions,
  transferTargets,
} from "@/features/send/lib/send";
import type { Recipient, Send, SendMode, SendOption, SendStep } from "@/features/send/types/send";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { LoadError } from "@/shared/components/load-error";
import { exactDigits } from "@/shared/lib/money";

export interface SendSheetProps {
  open: boolean;
  /** Transfer starts on the owner's other profiles; Send also offers a wallet address. */
  mode: SendMode;
  onOpenChange: (open: boolean) => void;
  profile: Profile;
  profiles: Profile[];
  balances: Balances | null;
  failed: boolean;
  onRetry: () => void;
  /** The send reached the chain: balances and lists can read again. */
  onSent: () => void;
}

const TITLES: Record<SendStep, string> = {
  [SEND_STEPS.to]: SEND_COPY.to,
  [SEND_STEPS.address]: SEND_COPY.walletAddress,
  [SEND_STEPS.asset]: SEND_COPY.what,
  [SEND_STEPS.amount]: SEND_COPY.amount,
  [SEND_STEPS.review]: SEND_COPY.review,
  [SEND_STEPS.progress]: "",
};

// R-213: one sheet walks recipient, money, amount and review, then follows the send to the chain (R-214). Each
// step slides in from its direction and the sheet's height follows it; the server checks the send before the review
// (R-211), so the review shows what the server will let the wallet sign.
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
  const [direction, setDirection] = useState<StepDirection>(STEP_DIRECTIONS.next);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [option, setOption] = useState<SendOption | null>(null);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Send | null>(null);
  const [submitted, setSubmitted] = useState<Send | null>(null);
  // While Privy signs, the sheet stays open: closing it would not stop the money.
  const [signing, setSigning] = useState(false);
  // Every send checked this time; the unsigned ones are given up when the sheet closes.
  const [checked, setChecked] = useState<string[]>([]);
  const [prepare, preparing] = usePrepareSendMutation();
  const [cancel] = useCancelSendMutation();
  const fresh = useFreshSignIn();
  // Every opening starts over: a send is chosen and checked anew each time.
  const [wasOpen, setWasOpen] = useState(open);
  const [wasMode, setWasMode] = useState(mode);
  if (open !== wasOpen || mode !== wasMode) {
    setWasOpen(open);
    setWasMode(mode);
    if (open) {
      setPath([first]);
      setDirection(STEP_DIRECTIONS.next);
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
      preparing.reset();
    }
  }
  const step = path[path.length - 1] ?? first;
  const options = sendOptions(balances);
  const sendable = options.filter((o) => o.sendable);

  const go = (next: SendStep) => {
    setDirection(STEP_DIRECTIONS.next);
    setPath((p) => [...p, next]);
  };
  const back = () => {
    setDirection(STEP_DIRECTIONS.back);
    setPath((p) => (p.length > 1 ? p.slice(0, -1) : p));
  };
  // With one network and token to send, there is nothing to choose.
  const toMoney = (to: Recipient) => {
    setRecipient(to);
    if (sendable.length === 1 && sendable[0]) {
      setOption(sendable[0]);
      go(SEND_STEPS.amount);
    } else go(SEND_STEPS.asset);
  };
  const close = (next: boolean) => {
    if (!next) {
      if (signing) return;
      if (fresh.pending) fresh.cancel();
      for (const sendId of checked) {
        if (sendId !== submitted?.sendId) cancel({ profileId: profile.profileId, sendId });
      }
    }
    onOpenChange(next);
  };

  const units = option ? parseTokenAmount(amount, option.decimals) : null;
  const shownAmount = (value: bigint, o: SendOption) =>
    `${formatTokenAmount({ baseUnits: value, decimals: o.decimals, fractionDigits: exactDigits(value, o.decimals) })} ${o.symbol}`;

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    if (!isWalletAddress(address)) {
      setAddressError(SEND_COPY.addressInvalid);
      return;
    }
    toMoney({ address: address.trim() });
  };

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
    if (units > option.balance) {
      setAmountError(SEND_COPY.moreThanBalance);
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
    const result = await fresh
      .run(() => prepare({ profileId: profile.profileId, ...request }).unwrap())
      .catch((error: unknown) => {
        if (!fresh.cancelled(error)) setAmountError(sendError(error));
        return null;
      });
    if (!result) return;
    setChecked((c) => [...c, result.sendId]);
    const expected =
      "profile" in recipient ? (recipient.profile.walletAddress ?? "") : recipient.address;
    if (!matchesRequest(result, request, expected)) {
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
      : TITLES[step];
  const canGoBack = path.length > 1 && step !== SEND_STEPS.progress;

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
    body =
      own.length === 0 ? (
        <EmptyState
          compact
          icon={Users}
          title={SEND_COPY.noOtherProfiles}
          description={SEND_COPY.noOtherProfilesHint}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <Choices title={SEND_COPY.yourProfiles}>
            {own.map((p) => (
              <Choice
                key={p.profileId}
                icon={<Initial text={profileLabel(p)} />}
                label={profileLabel(p)}
                onClick={() => toMoney({ profile: p })}
              />
            ))}
          </Choices>
          {mode === SEND_MODES.send ? (
            <Choices title={SEND_COPY.anotherWallet}>
              <Choice
                icon={
                  <span className="grid size-9 place-items-center rounded-pill bg-surface-2 text-muted">
                    <WalletMinimal aria-hidden className="size-[var(--fw-icon-sm)]" />
                  </span>
                }
                label={SEND_COPY.walletAddress}
                note={SEND_COPY.walletAddressNote}
                onClick={() => go(SEND_STEPS.address)}
              />
            </Choices>
          ) : null}
        </div>
      );
  } else if (step === SEND_STEPS.address) {
    body = (
      <form noValidate onSubmit={submitAddress} className="flex flex-col gap-5">
        <TextField
          label={SEND_COPY.address}
          placeholder={SEND_COPY.addressPlaceholder}
          value={address}
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          className="font-mono"
          onChange={(e) => {
            setAddress(e.target.value);
            setAddressError(null);
          }}
          hint={SEND_COPY.addressHint}
          error={addressError ?? undefined}
          action={
            <Button
              variant="secondary"
              onClick={async () => {
                const text = await navigator.clipboard?.readText().catch(() => "");
                if (text) {
                  setAddress(text.trim());
                  setAddressError(null);
                }
              }}
            >
              {SEND_COPY.paste}
            </Button>
          }
        />
        <Button type="submit" className="w-full">
          {SEND_COPY.continue}
        </Button>
      </form>
    );
  } else if (step === SEND_STEPS.asset) {
    body =
      options.length === 0 ? (
        <EmptyState compact icon={WalletMinimal} title={SEND_COPY.nothingToSend} />
      ) : (
        <Choices title={SEND_COPY.what}>
          {options.map((o) => (
            <Choice
              key={`${o.chainId}-${o.token}`}
              icon={<TokenMark chainId={o.chainId} symbol={o.symbol} />}
              note={o.sendable ? shownAmount(o.balance, o) : SEND_COPY.notSendable}
              disabled={!o.sendable}
              onClick={() => {
                setOption(o);
                setAmount("");
                setAmountError(null);
                go(SEND_STEPS.amount);
              }}
            />
          ))}
        </Choices>
      );
  } else if (step === SEND_STEPS.amount && option) {
    const theyGet = typeof units === "bigint" && units <= option.balance ? units : 0n;
    body = (
      <form noValidate onSubmit={submitAmount} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <AmountField
            label={SEND_COPY.amount}
            unit={option.symbol}
            placeholder="0.00"
            value={amount}
            autoFocus
            onChange={(e) => {
              setAmount(e.target.value);
              setAmountError(null);
            }}
            error={amountError ?? undefined}
          />
          <div className="flex items-center justify-between gap-3 text-sm text-muted">
            <span className="tabular-nums">
              {SEND_COPY.available(shownAmount(option.balance, option))}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAmount(maxAmount(option.balance, option.decimals));
                setAmountError(null);
              }}
            >
              {SEND_COPY.max}
            </Button>
          </div>
        </div>
        <dl className="flex flex-col gap-2 rounded-md bg-surface-2 px-4 py-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">{SEND_COPY.networkFee}</dt>
            <dd className="text-right text-ink">{SEND_COPY.free}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">{SEND_COPY.theyGet}</dt>
            <dd className="font-medium text-ink tabular-nums">{shownAmount(theyGet, option)}</dd>
          </div>
        </dl>
        {fresh.step ?? (
          <Button type="submit" className="w-full" loading={preparing.isLoading}>
            {SEND_COPY.continue}
          </Button>
        )}
      </form>
    );
  } else if (step === SEND_STEPS.review && prepared && option && recipient) {
    body = (
      <SendReview
        mode={mode}
        send={prepared}
        option={option}
        from={profile}
        recipient={recipient}
        onSigning={setSigning}
        onSubmitted={(s) => {
          setSubmitted(s);
          go(SEND_STEPS.progress);
        }}
      />
    );
  } else if (step === SEND_STEPS.progress && submitted && option && recipient) {
    body = (
      <SendProgress
        profileId={profile.profileId}
        initial={submitted}
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
      onBack={canGoBack && !signing ? back : undefined}
      backLabel={SEND_COPY.back}
      locked={signing}
    >
      {/* A closed sheet holds no step, so nothing in it polls or signs. */}
      {open ? (
        <StepTransition step={step} direction={direction} label={title}>
          {body}
        </StepTransition>
      ) : null}
    </Sheet>
  );
}

function Choices({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted">{title}</h3>
      <ul className="flex flex-col gap-1">{children}</ul>
    </section>
  );
}

function Choice({
  icon,
  label,
  note,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label?: string;
  note?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <RowButton onClick={onClick} disabled={disabled}>
        <span className="min-w-0 shrink-0">{icon}</span>
        {label ? (
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
        ) : null}
        <span className={label ? "text-xs text-muted" : "ml-auto text-xs text-muted tabular-nums"}>
          {note}
        </span>
        {disabled ? null : (
          <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-muted" />
        )}
      </RowButton>
    </li>
  );
}

function Initial({ text }: { text: string }) {
  return (
    <span className="grid size-9 place-items-center rounded-pill bg-surface-2 text-sm font-medium text-ink">
      {text.slice(0, 1)}
    </span>
  );
}
