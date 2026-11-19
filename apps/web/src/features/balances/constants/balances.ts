export const USD_DECIMALS = 2;

/** The amounts a token balance has: the API's wallet, pending and held, pending's parts, and the part not final. */
export const BALANCE_FIELDS = {
  wallet: "wallet",
  pending: "pending",
  held: "held",
  settling: "settling",
  confirming: "confirming",
  partial: "partial",
  notFinal: "notFinal",
} as const;
