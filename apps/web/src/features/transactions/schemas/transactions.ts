import { z } from "zod";
import { DOCUMENT_KINDS, PAYMENT_PURPOSES } from "@/features/invoices/constants/invoices";
import {
  TRANSACTION_DIRECTIONS,
  type TRANSACTION_STATUSES,
} from "@/features/transactions/constants/transactions";
import type { TransactionClass } from "@/features/transactions/types/transactions";
import {
  apiDate,
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
  counterparty: evmAddress, // zero address for a mint or burn
  txHash: hash32,
  logIndex: count,
  blockNumber: count,
  at: apiTime,
  status: openEnum<(typeof TRANSACTION_STATUSES)[keyof typeof TRANSACTION_STATUSES]>(),
  usdValue: usdAmount,
  classification: openEnum<TransactionClass>(),
  labelable: z.boolean(),
  payment: z
    .object({
      paymentId: hash32,
      purpose: z.enum(PAYMENT_PURPOSES),
      documentKind: z.enum(DOCUMENT_KINDS),
      policyException: z.string().nullable(),
      unreconciled: z.boolean(),
      fees: baseUnits.nullable().optional(), // taken before the rest reached the wallet
    })
    .optional(),
  invoice: z
    .object({ invoiceId: hash32, number: count, clientName: z.string().nullable() })
    .nullable(),
  recordsValue: z
    .object({ currency: z.string().regex(/^[A-Z]{3}$/), amount: usdAmount, rateDate: apiDate })
    .nullable(),
  feePaid: baseUnits.nullable(), // "0" where Forwend paid; null if unknown
});

export const recordsCurrencySchema = z.object({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
});

export const transactionsPageSchema = pageOf(transactionSchema);
