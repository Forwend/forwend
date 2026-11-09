import { createPrivateKey, sign } from "node:crypto";
import { base58, quoteMessage } from "../src/features/pay/lib/crosschain";

// The private half of ONECLICK_TEST_KEY (servers.ts), which the e2e build takes as the fake 1Click's key.
const SEED = "423cbe6d2187278cf6acdc955a62fe7c9c2de1276b96faecc498c8deae7f7215";
const PRIVATE = createPrivateKey({
  key: Buffer.from(`302e020100300506032b657004220420${SEED}`, "hex"),
  format: "der",
  type: "pkcs8",
});

export const BASE_USDC_ASSET = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

/** A quote answer as 1Click signs it: exactly amount of Base USDC to recipient, for amountIn of originAsset. */
export function signedQuote(q: {
  recipient: string;
  amount: string;
  amountIn: string;
  originAsset: string;
  refundTo: string;
  depositAddress: string;
}) {
  const answer: Record<string, unknown> = {
    quote: {
      amountIn: q.amountIn,
      amountInFormatted: q.amountIn,
      amountInUsd: "1263.00",
      minAmountIn: q.amountIn,
      amountOut: q.amount,
      amountOutFormatted: q.amount,
      amountOutUsd: "1250.00",
      minAmountOut: q.amount,
      timeEstimate: 27,
      refundFee: "5300",
      withdrawFee: "2400",
      deadline: "2026-10-13T12:00:00.000Z",
      depositAddress: q.depositAddress,
    },
    quoteRequest: {
      dry: false,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: q.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: BASE_USDC_ASSET,
      amount: q.amount,
      refundTo: q.refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: q.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: "2026-10-10T13:00:00.000Z",
    },
    timestamp: "2026-10-10T12:00:00.000Z",
    correlationId: "e2e",
  };
  const signature = sign(null, Buffer.from(quoteMessage(answer)), PRIVATE);
  return { ...answer, signature: `ed25519:${base58(new Uint8Array(signature))}` } as Record<
    string,
    unknown
  >;
}
