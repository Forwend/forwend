import { z } from "zod";
import type {
  ApiDepositStatus,
  ApiPaymentStatus,
  ApiSettlementStatus,
} from "@/features/activity/types/activity";
import { clientBodySchema } from "@/features/clients/schemas/clients";
import { SETTLEMENT_WAITS } from "@/features/invoices/constants/invoices";
import type { InvoiceEventKind } from "@/features/invoices/types/invoices";
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

export const invoiceClientSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  country: z.string().nullable(),
  taxId: z.string().nullable(),
});

/** The profile's billing details as they were when the invoice was made. */
export const invoiceIssuerSchema = z.object({
  name: z.string(),
  address: z.string(),
  country: z.string(),
  taxId: z.string().nullable(),
  email: z.string(),
});

export const depositSchema = z.object({
  txHash: hash32,
  logIndex: count,
  from: evmAddress,
  amount: baseUnits,
  blockNumber: count,
  blockTime: apiTime,
  status: openEnum<ApiDepositStatus>(),
  // Paid after expiry: held for the payer, never the creator's.
  late: z.boolean(),
  blocksLeft: count,
  // The blocks it had to wait when first seen, fixed across reads: blocksTotal - blocksLeft have passed (R-73).
  blocksTotal: count,
  secondsLeft: count,
});

/** openapi.yaml, InvoiceSummary. */
export const invoiceSummarySchema = z.object({
  // The pay link's id.
  invoiceId: hash32,
  // The on-chain id in the terms below: invoiceId, or the chosen or first option's of a payer-chooses invoice.
  optionId: hash32,
  // An option received money, so the payer can't pick another (R-56).
  optionLocked: z.boolean(),
  // How many tokens and networks it accepts; 1 for a fixed invoice.
  optionCount: z.number().int().positive(),
  // A payment before expiry is seen and not final: a partly paid invoice reads as confirming meanwhile (R-69).
  confirming: z.boolean(),
  // The checkout closed and it can no longer be paid, before paymentStatus catches up: show it expired (R-77).
  closed: z.boolean(),
  number: z.number().int().positive(),
  title: z.string().nullable(),
  note: z.string().nullable(),
  // YYYY-MM-DD; shown only, payment closes at expiresAt.
  dueDate: apiDate.nullable(),
  // Only in the owner's answers (create, list and the profile's read); the public GET leaves it out.
  client: invoiceClientSchema.optional(),
  issuer: invoiceIssuerSchema.nullable(),
  // The name the payer sees when there is no issuer, such as on a personal profile's request.
  senderName: z.string().nullable(),
  // The creator's https link, offered to the payer once paid (R-58).
  returnUrl: z.string().nullable(),
  chainId: count,
  token: evmAddress,
  amount: baseUnits,
  // The profile wallet that settlement pays.
  recipient: evmAddress,
  receiveAddress: evmAddress,
  expiresAt: apiTime,
  settleDeadline: apiTime,
  paymentStatus: openEnum<ApiPaymentStatus>(),
  settlementStatus: openEnum<ApiSettlementStatus>(),
  settlementTxHash: hash32.nullable(),
  createdAt: apiTime,
});

export const settlementWaitSchema = z.object({
  kind: z.enum(SETTLEMENT_WAITS),
  // retrying and dailyLimit: when the signer tries again.
  until: apiTime.nullable(),
  // finalizing: estimated chain time until the settle is final.
  secondsLeft: count.nullable(),
});

/** One token and network the invoice accepts, with its own on-chain id, amount and address (R-56). */
export const invoiceOptionSchema = z.object({
  optionId: hash32,
  chainId: count,
  // The API's chain name, such as base-sepolia.
  network: z.string(),
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  amount: baseUnits,
  receiveAddress: evmAddress,
  // On an option other than the shown one, these are held for the payer (D-76).
  deposits: z.array(depositSchema),
});

/** One line item (R-88), in the base units of the option whose id is the invoice's; quantity has 2 decimals. */
export const invoiceLineSchema = z.object({
  description: z.string(),
  quantity: z.string(),
  unitPrice: baseUnits,
  amount: baseUnits,
});

/** An invoice read alone or just created. */
export const invoiceSchema = invoiceSummarySchema.extend({
  // Every accepted option, the shown one included: one for a fixed invoice.
  options: z.array(invoiceOptionSchema),
  // Once paid: the block time of the deposit that completed the amount.
  paidAt: apiTime.nullable(),
  // Once settled: when the settlement was recorded as final.
  settledAt: apiTime.nullable(),
  // When the owner canceled it (R-79).
  canceledAt: apiTime.nullable(),
  deposits: z.array(depositSchema),
  // When Check status may run again; null when it may now (R-55).
  nextCheckAt: apiTime.nullable(),
  // Its line items, empty without a breakdown (R-88).
  lines: z.array(invoiceLineSchema),
  // Only in the owner's reads: null while not paid or once settled.
  settlementWait: settlementWaitSchema.nullable().optional(),
});

/** POST /v1/invoices/{id}/recheck (R-55): what Check status found. Amounts in base units. */
export const recheckSchema = z.object({
  onChain: baseUnits,
  recorded: baseUnits,
  rescanning: z.boolean(),
  nextCheckAt: apiTime,
  // Chains of options whose network did not answer; the others were checked (F144).
  unreadable: z.array(count),
});

export const invoicesPageSchema = pageOf(invoiceSummarySchema);

/** Fixed: chainId, token and amount; payer chooses: amountUsd alone (R-56). */
export const createInvoiceBodySchema = z.object({
  chainId: count.optional(),
  token: evmAddress.optional(),
  amount: baseUnits.optional(),
  amountUsd: usdAmount.optional(),
  returnUrl: z.string(),
  expiresIn: z.number().int().positive(),
  title: z.string(),
  note: z.string(),
  dueDate: z.string(),
  senderName: z.string(),
  client: clientBodySchema,
  // R-88: unitPrice in the amount's own unit, base units with amount and a USD decimal with amountUsd.
  lines: z
    .array(z.object({ description: z.string(), quantity: z.string(), unitPrice: z.string() }))
    .optional(),
});

/** One of the bell's events (R-81): GET /v1/profiles/{id}/events. */
export const invoiceEventSchema = z.object({
  id: z.number().int(),
  kind: openEnum<InvoiceEventKind>(),
  invoiceId: hash32,
  number: z.number().int().positive(),
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  // The option's amount; for held money, the amount newly held for the payer.
  amount: baseUnits,
  at: apiTime,
});

export const invoiceEventsSchema = z.object({ items: z.array(invoiceEventSchema) });
