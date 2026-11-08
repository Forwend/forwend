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
  // The sender for in, the receiver for out; the zero address for a mint or a burn.
  counterparty: evmAddress,
  txHash: hash32,
  logIndex: count,
  blockNumber: count,
  at: apiTime,
  status: openEnum<(typeof TRANSACTION_STATUSES)[keyof typeof TRANSACTION_STATUSES]>(),
  // R-108.
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
      // What the settlement paid out of the payment before the rest reached the wallet (R-228).
      fees: baseUnits.nullable().optional(),
    })
    .optional(),
  invoice: z
    .object({ invoiceId: hash32, number: count, clientName: z.string().nullable() })
    .nullable(),
  // R-110: the value in the profile's other records currency at the ECB rate of rateDate.
  recordsValue: z
    .object({ currency: z.string().regex(/^[A-Z]{3}$/), amount: usdAmount, rateDate: apiDate })
    .nullable(),
  // R-224: the gas the wallet paid for the Forwend send behind an outgoing transfer, in the token's base units: "0"
  // where Forwend paid, null for other transfers or a fee not known yet.
  feePaid: baseUnits.nullable(),
});

export const recordsCurrencySchema = z.object({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
});

export const transactionsPageSchema = pageOf(transactionSchema);
