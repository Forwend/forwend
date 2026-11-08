/** Send opens on its choice of recipient; Transfer opens on the owner's other profiles. */
export const SEND_MODES = { send: "send", transfer: "transfer" } as const;

export const SEND_STEPS = {
  to: "to",
  address: "address",
  asset: "asset",
  amount: "amount",
  review: "review",
  confirm: "confirm",
  progress: "progress",
} as const;

/** GET /v1/profiles/{id}/sends/{sendId}, Send.status. */
export const SEND_STATUSES = {
  prepared: "prepared",
  approved: "approved",
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

/** 0x and 40 hex digits: a whole EVM address, which the address step checks as soon as it is typed. */
export const ADDRESS_LENGTH = 42;

/** How the wallet pays its network fee from the token itself (D-121): as the chain's gas coin, signing with the gas caps
 * (R-216), or to Privy's paymaster through a request the server sends (R-225). Forwend paid for sends before D-121. */
export const FEE_PAYERS = { forwend: "forwend", wallet: "wallet", paymaster: "paymaster" } as const;

/** How often an open sheet asks for the send's progress: about one block. */
export const SEND_POLL_MS = 1500;
