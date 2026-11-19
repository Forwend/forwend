/** InvoiceTerms in packages/contracts/src/InvoiceTypes.sol, in ABI field order. */
export interface InvoiceTerms {
  invoiceId: string;
  recipient: string;
  token: string;
  amount: bigint;
  expiresAt: bigint;
  settleDeadline: bigint;
  intendedChainId: bigint;
  networkFee?: bigint; // absent in v1 terms
  platformFee?: bigint;
}
