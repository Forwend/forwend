"use client";

import { useState } from "react";
import { TWO_STEP_COPY } from "@/features/auth/constants/auth-copy";
import { useFreshSignIn } from "@/features/auth/hooks/use-fresh-sign-in";
import { useMfaStep } from "@/features/auth/hooks/use-mfa-step";
import { useWalletMfa } from "@/features/auth/hooks/use-wallet-mfa";
import { mfaCancelled } from "@/features/auth/lib/two-step";
import { useApproveSendMutation, useSubmitSendMutation } from "@/features/send/api/send-api";
import { SEND_STATUSES } from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import { useSignSend } from "@/features/send/hooks/use-sign-send";
import { sendError } from "@/features/send/lib/send";
import type { Relay, Send } from "@/features/send/types/send";

const CANCELLED = "cancelled";

export function useSendApproval({
  profileId,
  send,
  onSigning,
  onSubmitted,
}: {
  profileId: string;
  send: Send | null;
  onSigning: (signing: boolean) => void;
  onSubmitted: (send: Send, relay: Relay | null) => void;
}) {
  const { sign, canSign } = useSignSend(send?.from ?? null);
  const [approve] = useApproveSendMutation();
  const [submit] = useSubmitSendMutation();
  const fresh = useFreshSignIn();
  const mfaStep = useMfaStep();
  const [settingUp, setSettingUp] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorFor, setErrorFor] = useState(send?.sendId);
  if (send?.sendId !== errorFor) {
    setErrorFor(send?.sendId);
    setError(null);
  }

  const mfa = useWalletMfa();
  const start = async () => {
    if (!send || working) return;
    if (mfa.needed) {
      setSettingUp(true);
      return;
    }
    setWorking(true);
    setError(null);
    // Two-step before the approve, so closing it leaves nothing approved.
    if (mfa.enrolled) {
      const failed = await mfaStep.run(mfa.verify).then(
        () => null,
        (e: unknown) => e,
      );
      if (failed) {
        if (!mfaCancelled(failed)) setError(TWO_STEP_COPY.failed);
        setWorking(false);
        return;
      }
    }
    try {
      await approveAndSign(send);
    } finally {
      // The code was for this send; a failed clear leaves Privy's own 15 minutes.
      if (mfa.enrolled) void mfa.forget().catch(() => undefined);
    }
  };
  const approveAndSign = async (send: Send) => {
    let refused: string | null = null;
    const latest = await fresh
      .run(() => approve({ profileId, sendId: send.sendId }).unwrap())
      .catch((e: unknown) => {
        if (fresh.cancelled(e)) return CANCELLED;
        refused = sendError(e);
        return null;
      });
    if (latest === CANCELLED) {
      setWorking(false);
      return;
    }
    // Sign only a send approved just now: an older approval may have gone out already.
    if (latest?.status !== SEND_STATUSES.approved) {
      setError(latest ? SEND_COPY.outOfDate : (refused ?? SEND_COPY.failedToPrepare));
      setWorking(false);
      return;
    }
    onSigning(true);
    let signed: Awaited<ReturnType<typeof sign>>;
    try {
      signed = await sign(send, latest.privyRequest);
    } catch {
      setError(SEND_COPY.signFailed);
      setWorking(false);
      onSigning(false);
      return;
    }
    // A lost report is sent again by the progress step, which holds the lock until then.
    const reported = await submit({ profileId, sendId: send.sendId, ...signed })
      .unwrap()
      .catch(() => null);
    onSubmitted(
      reported ?? {
        ...send,
        status: SEND_STATUSES.sending,
        txHash: "txHash" in signed ? signed.txHash : null,
      },
      "signature" in signed
        ? {
            signature: signed.signature,
            until: Number(latest.privyRequest?.headers["privy-request-expiry"] ?? 0),
          }
        : null,
    );
    setWorking(false);
  };

  return {
    start,
    working,
    error,
    canSign,
    locked: working && fresh.step === null && (mfaStep.step === null || mfaStep.busy),
    confirmStep: fresh.step ?? mfaStep.step,
    settingUp,
    endSetUp: () => setSettingUp(false),
    cancelConfirm: () => {
      fresh.cancel();
      mfaStep.cancel();
      setSettingUp(false);
    },
  };
}
