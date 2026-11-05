/** First-run choices (apps/backend/api/openapi.yaml, OnboardingRequest), in the order the screen shows them. */
export const ONBOARDING_CHOICES = {
  receiveAndSend: "receive_and_send",
  getPaidByClients: "get_paid_by_clients",
  acceptBusinessPayments: "accept_business_payments",
  buildIntegration: "build_integration",
} as const;

/** First-run steps, in the order they show; a run holds only the ones its choices need (R-50). */
export const ONBOARDING_STEPS = {
  use: "use",
  freelancerDetails: "freelancer_details",
  merchantDetails: "merchant_details",
  tokens: "tokens",
  passkey: "passkey",
  ready: "ready",
} as const;

/** Checklist steps, in the order the card lists them. */
export const CHECKLIST_STEPS = {
  passkey: "passkey",
  billingDetails: "billing_details",
  firstInvoice: "first_invoice",
  firstPaid: "first_paid",
  firstMoney: "first_money",
} as const;

/** Circle's faucet hands out test USDC on the testnets Forwend accepts (Base Sepolia, Arbitrum Sepolia, Arc). */
export const TEST_USDC_FAUCET = "https://faucet.circle.com";

/** Privy's linked-account type for a passkey. */
export const PRIVY_PASSKEY = "passkey";
