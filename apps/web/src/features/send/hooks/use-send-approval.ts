"use client";

import { useState } from "react";
import { useFreshSignIn } from "@/features/auth/components/fresh-sign-in";
import { useMfaStep } from "@/features/auth/components/mfa-step";
import { TWO_STEP_COPY } from "@/features/auth/constants/auth-copy";
import { useWalletMfa } from "@/features/auth/hooks/use-wallet-mfa";
import { mfaCancelled } from "@/features/auth/lib/two-step";
import { useApproveSendMutation, useSubmitSendMutation } from "@/features/send/api/send-api";
import { SEND_STATUSES } from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import { useSignSend } from "@/features/send/hooks/use-sign-send";
import { sendError } from "@/features/send/lib/send";
import type { Relay, Send } from "@/features/send/types/send";

const CANCELLED = "cancelled";

/** After the owner holds Send: two-step (set up first when needed), approve (Confirm it's you when the server asks),
 * sign with Privy, report the hash or the signed request. Each ask is the sheet's one confirm step, never a dialog over it.
 * It lives in the sheet, not the Summary, so the Summary may give way to the confirm step and come back while one
 * send is under way, and a second hold can't start another. */
export function useSendApproval({
  profileId,
  send,
  onSigning,
  onSubmitted,
}: {
  profileId: string;
  send: Send | null;
  /** True from Privy's signing until the server holds the hash or the signed request: the sheet can't close then. */
  onSigning: (signing: boolean) => void;
  /** relay: a paymaster send's signature, which the progress step sends again if the server never got it. */
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
  // A send checked again from the amount starts with no error.
  const [errorFor, setErrorFor] = useState(send?.sendId);
  if (send?.sendId !== errorFor) {
    setErrorFor(send?.sendId);
    setError(null);
  }

  const mfa = useWalletMfa();
  const start = async () => {
    if (!send || working) return;
    // R-219: until two-step is set up, the Summary's button sets it up, as the sheet's next step.
    if (mfa.needed) {
      setSettingUp(true);
      return;
    }
    setWorking(true);
    setError(null);
    // Two-step first, so closing it leaves nothing approved and the owner can hold again at once. Privy signs on that
    // code, and the approve then needs no emailed code (D-49).
    if (mfa.enrolled) {
      const failed = await mfaStep.run(mfa.verify).then(
        () => null,
        (e: unknown) => e,
      );
      if (failed) {
        // Closed by the owner: back to the Summary with no error.
        if (!mfaCancelled(failed)) setError(TWO_STEP_COPY.failed);
        setWorking(false);
        return;
      }
    }
    try {
      await approveAndSign(send);
    } finally {
      // The code was for this send alone; a failed clear leaves Privy's own 15 minutes.
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
    // Back from the confirm step: the Summary again, with no error.
    if (latest === CANCELLED) {
      setWorking(false);
      return;
    }
    // Only a send the server approved just now is signed, once (R-211): one past its 10 minutes, or replaced from
    // another tab, was checked against a balance and fees that may have moved, and one approved before may have gone
    // out already though its answer was lost.
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
    // The money is moving now. The progress step holds the lock until the server has the hash, which it reports again
    // if this report is lost, so the sheet never opens in between. A signed request the server never got sends
    // nothing; the approval ends after its hold.
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
    /** From the hold until signing starts, except while a confirm step waits for the owner: the sheet can't close and
     * shows no Back, so a send it gave up can't be signed once the approve answer comes. Two-step locks it while Privy
     * checks an answer, which goes on whatever the sheet does. */
    locked: working && fresh.step === null && (mfaStep.step === null || mfaStep.busy),
    /** The one confirm step: two-step itself, or Confirm it's you when the server asks. */
    confirmStep: fresh.step ?? mfaStep.step,
    /** Two-step's setup is the confirm step instead (TwoStepSetup); endSetUp brings the Summary back. */
    settingUp,
    endSetUp: () => setSettingUp(false),
    /** Back to the Summary, or the sheet closing: gives up the confirm. */
    cancelConfirm: () => {
      fresh.cancel();
      mfaStep.cancel();
      setSettingUp(false);
    },
  };
}
