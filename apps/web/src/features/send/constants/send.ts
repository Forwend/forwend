/** Send opens on its choice of recipient; Transfer opens on the owner's other profiles. */
export const SEND_MODES = { send: "send", transfer: "transfer" } as const;

export const SEND_STEPS = {
  to: "to",
  address: "address",
  asset: "asset",
  amount: "amount",
  review: "review",
  progress: "progress",
} as const;

/** GET /v1/profiles/{id}/sends/{sendId}, Send.status. */
export const SEND_STATUSES = {
  prepared: "prepared",
  sending: "sending",
  sent: "sent",
  failed: "failed",
  canceled: "canceled",
  expired: "expired",
} as const;

export const SEND_WARNINGS = { contract: "contract", newRecipient: "newRecipient" } as const;

export const SEND_FAILURES = { reverted: "reverted", dropped: "dropped" } as const;

/** An EVM chain's gas coin counts in 18 decimals (Arc's USDC too), whatever its token interface uses. */
export const NATIVE_DECIMALS = 18;

/** An estimated fee shows 4 decimals: enough to see it, never a false precision. */
export const FEE_DECIMALS = 4;

/** Who pays the network fee (D-119): Forwend where it sponsors gas, else the wallet, from the token itself (R-216). */
export const FEE_PAYERS = { forwend: "forwend", wallet: "wallet" } as const;

/** How often an open sheet asks for the send's progress: about one block. */
export const SEND_POLL_MS = 1500;
