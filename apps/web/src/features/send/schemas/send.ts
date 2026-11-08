import { z } from "zod";
import {
  FEE_PAYERS,
  SEND_FAILURES,
  SEND_STATUSES,
  SEND_WARNINGS,
} from "@/features/send/constants/send";
import { apiTime, baseUnits, count, evmAddress } from "@/shared/schemas/api";

/** GET /v1/profiles/{id}/sends/fee, and a send's networkFee: the most the wallet pays, in the token's base units. */
export const sendFeeSchema = z.object({ amount: baseUnits, paidBy: z.enum(FEE_PAYERS) });

/** POST /v1/profiles/{id}/sends and the reads after it (R-211, R-212). Amounts are base units. */
export const sendSchema = z.object({
  sendId: z.guid(),
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  from: evmAddress,
  to: evmAddress,
  toProfileId: z.guid().nullable(),
  amount: baseUnits,
  status: z.enum(SEND_STATUSES),
  // The block with its transfer can no longer change.
  final: z.boolean(),
  txHash: z.string().nullable(),
  failure: z.enum(SEND_FAILURES).nullable(),
  networkFee: sendFeeSchema,
  // What a wallet-paid send is signed with, so it costs at most networkFee (R-216); null otherwise.
  gas: z
    .object({ limit: baseUnits, maxFeePerGas: baseUnits, maxPriorityFeePerGas: baseUnits })
    .nullable(),
  warnings: z.array(z.enum(SEND_WARNINGS)),
  createdAt: apiTime,
  // Approve's answer for a paymaster send: the Privy request the user's key signs (R-225).
  privyRequest: z
    .object({
      url: z.string(),
      body: z.record(z.string(), z.unknown()),
      headers: z.record(z.string(), z.string()),
    })
    .optional(),
});

/** GET /v1/profiles/{id}/sends: signed sends no block holds yet (R-215). */
export const pendingSendsSchema = z.object({ sends: z.array(sendSchema) });
