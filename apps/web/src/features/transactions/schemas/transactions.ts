import { z } from "zod";
import {
  TRANSACTION_DIRECTIONS,
  type TRANSACTION_STATUSES,
} from "@/features/transactions/constants/transactions";
import type { TransactionClass } from "@/features/transactions/types/transactions";
import {
  apiTime,
  baseUnits,
  count,
  evmAddress,
  hash32,
  openEnum,
  pageOf,
  usdAmount,
} from "@/shared/schemas/api";

export const transactionSchema = z.object({
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  direction: z.enum(TRANSACTION_DIRECTIONS),
  amount: baseUnits,
  // The sender for in, the receiver for out; the zero address for a mint or a burn.
  counterparty: evmAddress,
  txHash: hash32,
  logIndex: count,
  blockNumber: count,
  at: apiTime,
  // Other values may come from a newer API.
  status: openEnum<(typeof TRANSACTION_STATUSES)[keyof typeof TRANSACTION_STATUSES]>(),
  // R-108: the value at receipt, what it was, whether the user may label it, and the invoice money in paid.
  usdValue: usdAmount,
  classification: openEnum<TransactionClass>(),
  labelable: z.boolean(),
  invoice: z
    .object({ invoiceId: hash32, number: count, clientName: z.string().nullable() })
    .nullable(),
});

export const transactionsPageSchema = pageOf(transactionSchema);
