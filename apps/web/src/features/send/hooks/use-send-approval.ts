"use client";

import { useState } from "react";
import { useFreshSignIn } from "@/features/auth/components/fresh-sign-in";
import { useApproveSendMutation, useSubmitSendMutation } from "@/features/send/api/send-api";
import { SEND_STATUSES } from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import { useSignSend } from "@/features/send/hooks/use-sign-send";
import type { Send } from "@/features/send/types/send";

const CANCELLED = "cancelled";

/** After the owner holds Send: approve (Confirm it's you when the server asks), sign with Privy, report the hash.
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
  /** True from Privy's signing until the server holds the hash: the sheet can't close then. */
  onSigning: (signing: boolean) => void;
  onSubmitted: (send: Send) => void;
}) {
  const { sign, canSign } = useSignSend(send?.from ?? null);
  const [approve] = useApproveSendMutation();
  const [submit] = useSubmitSendMutation();
  const fresh = useFreshSignIn({ titled: false });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A send checked again from the amount starts with no error.
  const [errorFor, setErrorFor] = useState(send?.sendId);
  if (send?.sendId !== errorFor) {
    setErrorFor(send?.sendId);
    setError(null);
  }

  const start = async () => {
    if (!send || working) return;
    setWorking(true);
    setError(null);
    const latest = await fresh
      .run(() => approve({ profileId, sendId: send.sendId }).unwrap())
      .catch((e: unknown) => (fresh.cancelled(e) ? CANCELLED : null));
    // Back from the confirm step: the Summary again, with no error.
    if (latest === CANCELLED) {
      setWorking(false);
      return;
    }
    // Only a send the server still holds as prepared is signed: one past its 10 minutes, or replaced from another tab,
    // was checked against a balance and fees that may have moved.
    if (latest?.status !== SEND_STATUSES.prepared) {
      setError(latest ? SEND_COPY.outOfDate : SEND_COPY.failedToPrepare);
      setWorking(false);
      return;
    }
    onSigning(true);
    let hash: string;
    try {
      hash = await sign(send);
    } catch {
      setError(SEND_COPY.signFailed);
      setWorking(false);
      onSigning(false);
      return;
    }
    // The money is moving now. The progress step holds the lock until the server has the hash, which it reports again
    // if this report is lost, so the sheet never opens in between.
    const reported = await submit({ profileId, sendId: send.sendId, txHash: hash })
      .unwrap()
      .catch(() => null);
    onSubmitted(reported ?? { ...send, status: SEND_STATUSES.sending, txHash: hash });
    setWorking(false);
  };

  return {
    start,
    working,
    error,
    canSign,
    /** From the hold until signing starts, except while Confirm it's you waits for a code: the sheet can't close and
     * shows no Back, so a send it gave up can't be signed once the approve answer comes. */
    locked: working && fresh.step === null,
    /** Confirm it's you, while the server asks for it: the sheet shows it as its own step. */
    confirmStep: fresh.step,
    /** Back to the Summary, or the sheet closing: gives up the confirm. */
    cancelConfirm: fresh.cancel,
  };
}
