export interface LinkPurchase {
  idempotencyKey: string;
  amountUsd: string | null;
  cents: string;
  offerVersion: string | null;
}
