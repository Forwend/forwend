import { z } from "zod";
import { SEND_FAILURES, SEND_STATUSES, SEND_WARNINGS } from "@/features/send/constants/send";
import { apiTime, baseUnits, count, evmAddress } from "@/shared/schemas/api";

/** POST /v1/profiles/{id}/sends and the reads after it (R-211, R-212). Amounts are base units. */
export const sendSchema = z.object({
  sendId: z.guid(),
  chainId: count,
  token: evmAddress,
  from: evmAddress,
  to: evmAddress,
  toProfileId: z.guid().nullable(),
  amount: baseUnits,
  status: z.enum(SEND_STATUSES),
  // The block with its transfer can no longer change.
  final: z.boolean(),
  txHash: z.string().nullable(),
  failure: z.enum(SEND_FAILURES).nullable(),
  networkFee: z.object({ amount: baseUnits, paidBy: z.string() }),
  warnings: z.array(z.enum(SEND_WARNINGS)),
  createdAt: apiTime,
});
