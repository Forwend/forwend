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

// A gas coin has 18 decimals (Arc's USDC too), whatever the token reports.
export const NATIVE_DECIMALS = 18;

export const FEE_DECIMALS = 4;

export const ADDRESS_LENGTH = 42;

export const FEE_PAYERS = { forwend: "forwend", wallet: "wallet", paymaster: "paymaster" } as const;

export const SEND_POLL_MS = 1500;
