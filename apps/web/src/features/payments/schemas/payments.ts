import { z } from "zod";
import { DOCUMENT_KINDS, PAYMENT_PURPOSES } from "@/features/invoices/constants/invoices";
import {
  depositSchema,
  invoiceLineSchema,
  paymentAmountsSchema,
} from "@/features/invoices/schemas/invoices";
import { PAYMENT_SOURCES } from "@/features/payments/constants/payments";
import { apiTime, baseUnits, count, evmAddress, hash32, pageOf } from "@/shared/schemas/api";

const signedUnits = z.string().regex(/^-?\d+$/);
export const paymentSchema = z.object({
  receipts: z
    .array(
      z.object({
        optionId: hash32,
        chainId: count,
        token: evmAddress,
        symbol: z.string(),
        decimals: count,
        received: baseUnits,
        pending: baseUnits,
        /** Booked money still owed to the payer on this option. */
        held: baseUnits.optional(),
      }),
    )
    .optional(),
  customerName: z.string().nullable().optional(),
  customerEmail: z.string().nullable().optional(),
  paymentId: hash32,
  optionId: hash32,
  optionLocked: z.boolean(),
  optionCount: count,
  source: z.enum(PAYMENT_SOURCES),
  purpose: z.enum(PAYMENT_PURPOSES),
  documentKind: z.enum(DOCUMENT_KINDS),
  number: count.nullable(),
  storeId: z.string().nullable(),
  storeName: z.string().nullable(),
  linkId: z.string().nullable(),
  livemode: z.boolean(),
  title: z.string().nullable(),
  reference: z.string().nullable(),
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  amount: baseUnits,
  paymentStatus: z.string(),
  settlementStatus: z.string(),
  refundStatus: z.string(),
  confirming: z.boolean(),
  closed: z.boolean(),
  createdAt: apiTime,
  closesAt: apiTime,
  hostedUrl: z.url().nullable(),
  amounts: paymentAmountsSchema,
  /** Derived by the API (D-114); older reads leave them out and the raw facts decide. */
  state: z.string().optional(),
  wallet: z.string().optional(),
  dueDate: z.string().nullable().optional(),
});
export const paymentProblemSchema = z.object({
  amount: signedUnits.nullable(),
  asset: z
    .object({ chainId: count, token: evmAddress, symbol: z.string(), decimals: count })
    .nullable(),
  code: z.string(),
  action: z.string(),
  optionId: hash32.nullable(),
  endpointId: z.string().nullable(),
  eventId: z.string().nullable(),
  reason: z.string().nullable(),
});
const coverageSchema = z.object({
  historyComplete: z.boolean(),
  verifiedBlock: count.nullable(),
  verifiedHash: z.string().nullable(),
  verifiedTime: apiTime.nullable(),
  observedBalance: signedUnits.nullable(),
  balanceDifference: signedUnits.nullable(),
  reconciliationError: z.string().nullable(),
  bookingError: z.string().nullable(),
  retryAt: apiTime.nullable(),
  updatedAt: apiTime,
  chainFinalizedBlock: count.nullable(),
  pendingDeposits: count,
  unbookedDeposits: count,
  unprovedDeposits: count,
  unbookedOutflows: count,
});
export const paymentDetailSchema = paymentSchema.extend({
  snapshotAt: apiTime,
  /** Line items in base units of the option whose id is the payment's. */
  items: z.array(invoiceLineSchema).optional(),
  customer: z.object({ name: z.string().nullable(), email: z.string().nullable() }),
  metadata: z.record(z.string(), z.string()),
  options: z.array(
    z.object({
      optionId: hash32,
      chainId: count,
      token: evmAddress,
      symbol: z.string(),
      decimals: count,
      amount: baseUnits,
      receiveAddress: evmAddress,
      closesAt: apiTime,
      paymentStatus: z.string(),
      settlementStatus: z.string(),
      refundStatus: z.string(),
      amounts: paymentAmountsSchema,
      coverage: coverageSchema,
      settlement: z
        .object({
          status: z.string(),
          wait: z.string().nullable(),
          attempts: count,
          createdAt: apiTime,
          nextAttemptAt: apiTime,
          signedAt: apiTime.nullable(),
          txHash: hash32.nullable(),
          receiptTxHash: hash32.nullable().optional(),
          blockNumber: count.nullable().optional(),
          blocksLeft: count.nullable().optional(),
          secondsLeft: count.nullable().optional(),
        })
        .nullable(),
      deposits: z.array(depositSchema),
      depositsTruncated: z.boolean(),
    }),
  ),
  deliveries: z.array(
    z.object({
      endpointId: z.string(),
      eventId: z.string(),
      eventType: z.string(),
      status: z.string(),
      enabled: z.boolean(),
      attempts: count,
      lastStatusCode: count.nullable(),
      lastAttemptAt: apiTime.nullable(),
      nextAttemptAt: apiTime,
      canManage: z.boolean(),
    }),
  ),
  deliveryCount: count,
  deliveriesTruncated: z.boolean(),
  problems: z.array(paymentProblemSchema),
});
export const paymentsPageSchema = pageOf(paymentSchema);
export const attentionPageSchema = pageOf(
  paymentSchema.extend({ problems: z.array(paymentProblemSchema) }),
).extend({
  snapshotAt: apiTime,
  webhooksTruncated: z.boolean(),
  webhooks: z.array(
    z.object({
      endpointId: z.string(),
      storeId: z.string().nullable(),
      description: z.string(),
      enabled: z.boolean(),
      livemode: z.boolean(),
      failed: count,
      disabledPending: count,
      lastProblemAt: apiTime,
      action: z.string(),
    }),
  ),
});
const balancesSchema = z.object({ receiver: signedUnits, payable: signedUnits, held: signedUnits });
export const reconciliationSchema = z.object({
  snapshotAt: apiTime,
  from: apiTime,
  to: apiTime,
  assets: z.array(
    z.object({
      storeId: z.string().nullable(),
      storeName: z.string().nullable(),
      chainId: count,
      token: evmAddress,
      symbol: z.string(),
      decimals: count,
      livemode: z.boolean(),
      opening: balancesSchema,
      changes: balancesSchema,
      closing: balancesSchema,
      settled: signedUnits,
      refunded: signedUnits,
      checkpointBalance: signedUnits.nullable(),
      checkpointDifference: signedUnits.nullable(),
      receiverCount: count,
      verifiedReceivers: count,
      unreconciledReceivers: count,
      pendingDeposits: count,
      unbookedDeposits: count,
      unprovedDeposits: count,
      unbookedOutflows: count,
      otherAssetMovements: count,
      policyExceptions: count,
      bookedMovements: count,
      minVerifiedBlock: count.nullable(),
      maxVerifiedBlock: count.nullable(),
      chainFinalizedBlock: count.nullable(),
    }),
  ),
});
