/** InvoiceTerms in packages/contracts/src/InvoiceTypes.sol, in ABI field order. */
export interface InvoiceTerms {
  invoiceId: string;
  recipient: string;
  token: string;
  amount: bigint;
  expiresAt: bigint;
  settleDeadline: bigint;
  intendedChainId: bigint;
  /** Only in a v2 factory's terms; absent is 0. */
  networkFee?: bigint;
  platformFee?: bigint;
}
