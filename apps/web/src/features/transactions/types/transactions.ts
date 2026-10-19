import type { z } from "zod";
import type {
  RELATIVE_DAYS,
  TRANSACTION_CLASSES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_LABELS,
} from "@/features/transactions/constants/transactions";
import type {
  recordsCurrencySchema,
  transactionSchema,
  transactionsPageSchema,
} from "@/features/transactions/schemas/transactions";

export type TransactionDirection =
  (typeof TRANSACTION_DIRECTIONS)[keyof typeof TRANSACTION_DIRECTIONS];

export type RelativeDay = (typeof RELATIVE_DAYS)[keyof typeof RELATIVE_DAYS];

export type TransactionClass = (typeof TRANSACTION_CLASSES)[keyof typeof TRANSACTION_CLASSES];

export type TransactionLabel = (typeof TRANSACTION_LABELS)[number];

export type Transaction = z.infer<typeof transactionSchema>;

export type TransactionsPage = z.infer<typeof transactionsPageSchema>;

/** A transaction's value in the profile's other records currency (R-110). */
export type TransactionRecordsValue = NonNullable<Transaction["recordsValue"]>;

export type RecordsCurrencySetting = z.infer<typeof recordsCurrencySchema>;
