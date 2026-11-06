"use client";

import { useSendTransaction, useWallets } from "@privy-io/react-auth";
import { useCallback } from "react";
import { PRIVY_CHAINS } from "@/features/auth/constants/privy-chains";
import { transferCalldata } from "@/features/send/lib/send";
import type { Send } from "@/features/send/types/send";

/** Signs a prepared send from the profile's own wallet with Privy (D-46): sponsored, or with the gas caps the server
 * set where the wallet pays (R-216). Privy shows no screen of its own, so the review is the one the owner reads.
 * canSign waits for Privy to list the wallet: signing before that fails at once (S-9). */
export function useSignSend(from: string | null) {
  const { sendTransaction } = useSendTransaction();
  const { wallets } = useWallets();
  const wallet = from
    ? wallets.find((w) => w.address.toLowerCase() === from.toLowerCase())
    : undefined;
  const sign = useCallback(
    async (send: Send): Promise<string> => {
      if (!wallet) throw new Error("The wallet is not ready to sign");
      if (!PRIVY_CHAINS.some((c) => c.id === send.chainId))
        throw new Error("Privy can't sign on this network");
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
        { sponsor: gas === null, address: wallet.address, uiOptions: { showWalletUIs: false } },
      );
      return hash;
    },
    [wallet, sendTransaction],
  );
  return { sign, canSign: wallet !== undefined };
}
