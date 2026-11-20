import { PROFILE_KINDS } from "@/features/profiles/constants/profile";

/** In the order the screen shows them. */
export const ONBOARDING_CHOICES = {
  receiveAndSend: "receive_and_send",
  getPaidByClients: "get_paid_by_clients",
  acceptBusinessPayments: "accept_business_payments",
  buildIntegration: "build_integration",
} as const;

/** As the API maps them (profile/onboard.go). */
export const CHOICE_KINDS = {
  [ONBOARDING_CHOICES.receiveAndSend]: PROFILE_KINDS.personal,
  [ONBOARDING_CHOICES.getPaidByClients]: PROFILE_KINDS.freelancer,
  [ONBOARDING_CHOICES.acceptBusinessPayments]: PROFILE_KINDS.merchant,
  [ONBOARDING_CHOICES.buildIntegration]: PROFILE_KINDS.merchant,
} as const;

export const ONBOARDING_STEPS = {
  use: "use",
  freelancerDetails: "freelancer_details",
  merchantDetails: "merchant_details",
  tokens: "tokens",
  passkey: "passkey",
  ready: "ready",
} as const;

export const CHECKLIST_STEPS = {
  passkey: "passkey",
  billingDetails: "billing_details",
  firstInvoice: "first_invoice",
  firstPaid: "first_paid",
  firstMoney: "first_money",
} as const;

export const TEST_USDC_FAUCET = "https://faucet.circle.com";
