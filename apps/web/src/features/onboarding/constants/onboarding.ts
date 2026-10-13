/** First-run choices (apps/backend/api/openapi.yaml, OnboardingRequest), in the order the screen shows them. */
export const ONBOARDING_CHOICES = {
  receiveAndSend: "receive_and_send",
  getPaidByClients: "get_paid_by_clients",
  acceptBusinessPayments: "accept_business_payments",
  buildIntegration: "build_integration",
} as const;

/** Checklist steps, in the order the card lists them. */
export const CHECKLIST_STEPS = {
  passkey: "passkey",
  billingDetails: "billing_details",
  firstInvoice: "first_invoice",
  firstPaid: "first_paid",
  firstMoney: "first_money",
} as const;
