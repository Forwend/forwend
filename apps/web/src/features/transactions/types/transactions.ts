import type { z } from "zod";
import type {
  RELATIVE_DAYS,
  TRANSACTION_CLASSES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_LABELS,
} from "@/features/transactions/constants/transactions";
import type {
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
