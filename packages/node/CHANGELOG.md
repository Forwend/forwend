# Changelog

## Unreleased

- Invoices, payments and their options carry networkFee, platformFee, netAmount and feesPaidBy.
- Payment amounts carry fees: what settlement paid the settler and Forwend. settled is what reached the wallet.
- Invoice and checkout session creates take feesPaidBy.
- An invoice's and a payment's own read, and webhooks, carry crossChain: a payment through NEAR Intents, with 1Click's
  status, what the payer sent and got back, and both chains' transactions. A payments list carries it once 1Click
  saw a deposit, and an invoice's own read carries crossChainOn.

## 0.2.0 (2026-11-08)

- Checkout sessions, payments with their details, stores, and invoice cancel, reopen and send.
- Types match the API: payment state, wallet, dueDate and payToken, held receipts, and the list filters.
- Tries a rate limit again after a short Retry-After, and a lost answer on reads and keyed requests with the same key.
- ForwendError has retryAfter. Each try times out after 30 seconds, and a redirect is refused.
- baseUrl must be https, or http on localhost; an id that isn't one can't change the request's path.
- verifyWebhook reads headers in any case, and a signed body that isn't JSON throws a WebhookVerificationError.

## 0.1.0

- First release: invoices, webhook events and webhook verification.
