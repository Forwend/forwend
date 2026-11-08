"use client";

import { useAuthorizationSignature, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { useCallback } from "react";
import { PRIVY_CHAINS } from "@/features/auth/constants/privy-chains";
import { FEE_PAYERS } from "@/features/send/constants/send";
import { matchesPrivyRequest, transferCalldata } from "@/features/send/lib/send";
import type { Send, Signed } from "@/features/send/types/send";

/** Signs a prepared send from the profile's own wallet with Privy (D-46). A wallet-paid send signs its transaction with
 * the gas caps the server set (R-216). A paymaster send signs the approve's Privy request with the user's key, for
 * the server to send (R-225). Privy shows no screen of its own, so the review is the one the owner reads.
 * canSign waits for Privy to list the wallet: signing before that fails at once (S-9). */
export function useSignSend(from: string | null) {
  const { sendTransaction } = useSendTransaction();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const { wallets } = useWallets();
  const wallet = from
    ? wallets.find((w) => w.address.toLowerCase() === from.toLowerCase())
    : undefined;
  const sign = useCallback(
    async (send: Send, privyRequest: Send["privyRequest"]): Promise<Signed> => {
      if (!wallet) throw new Error("The wallet is not ready to sign");
      if (!PRIVY_CHAINS.some((c) => c.id === send.chainId))
        throw new Error("Privy can't sign on this network");
      if (send.networkFee.paidBy === FEE_PAYERS.paymaster) {
        // The server built the request: it is signed only if it moves what the review showed.
        if (!privyRequest || !matchesPrivyRequest(send, privyRequest))
          throw new Error("The Privy request is not this send");
        const { signature } = await generateAuthorizationSignature({
          version: 1,
          method: "POST",
          url: privyRequest.url,
          body: privyRequest.body,
          headers: privyRequest.headers as { "privy-app-id": string },
        });
        return { signature };
      }
      // A wallet-paid send (R-216) signs with the server's caps, so it never costs more than the review showed.
      const gas = send.gas;
      const { hash } = await sendTransaction(
        {
          to: send.token as `0x${string}`,
          chainId: send.chainId,
          data: transferCalldata(send.to, BigInt(send.amount)),
          value: 0,
          ...(gas
            ? {
                type: 2,
                gasLimit: BigInt(gas.limit),
                maxFeePerGas: BigInt(gas.maxFeePerGas),
                maxPriorityFeePerGas: BigInt(gas.maxPriorityFeePerGas),
              }
            : {}),
        },
        { address: wallet.address, uiOptions: { showWalletUIs: false } },
      );
      return { txHash: hash };
    },
    [wallet, sendTransaction, generateAuthorizationSignature],
  );
  return { sign, canSign: wallet !== undefined };
}
