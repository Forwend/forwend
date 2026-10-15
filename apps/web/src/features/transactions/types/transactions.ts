import type { z } from "zod";
import type {
  RELATIVE_DAYS,
  TRANSACTION_DIRECTIONS,
} from "@/features/transactions/constants/transactions";
import type {
  transactionSchema,
  transactionsPageSchema,
} from "@/features/transactions/schemas/transactions";

export type TransactionDirection =
  (typeof TRANSACTION_DIRECTIONS)[keyof typeof TRANSACTION_DIRECTIONS];

export type RelativeDay = (typeof RELATIVE_DAYS)[keyof typeof RELATIVE_DAYS];

export type Transaction = z.infer<typeof transactionSchema>;

export type TransactionsPage = z.infer<typeof transactionsPageSchema>;
