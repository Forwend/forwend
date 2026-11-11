# Forwend

Get paid in stablecoins, by clients anywhere.

Forwend is stablecoin payments for businesses and freelancers, and next for AI agents.
Your clients pay with almost any token on almost any chain, and you get paid in stablecoins.

- Website: https://forwend.com
- Live demo: https://x.com/0xEnsp1re/status/2120536074787205365
- Code: https://github.com/Forwend/forwend
- Developer docs: https://forwend.com/docs

## The problem

A stablecoin is a token that keeps the value of a currency, such as USDC for the US dollar.
Stablecoins cost little to send and work across borders, so they suit getting paid from anywhere.

Clients don't always hold stablecoins, though.
Some hold other tokens on other chains, and many have only a bank card.
Asking them to swap, bridge or buy crypto first makes paying harder than it should be.

## What Forwend does today

- **Invoices.** Send an invoice with a pay link, a PDF and reminders.
- **Payment links and checkout.** Take payments in a store, at a counter with a QR code, or on your own site.
- **Balances.** See what is in your wallet, what is on its way and what is held.
- **Send.** Move money between your profiles or to another wallet on the same network.
- **Developer tools.** An API, signed webhooks and packages for Node, JavaScript and React.

Each payment lands in its own contract, which settles it to your wallet.
Forwend accepts USDC on Base, Arbitrum and Arc, and stablecoins on Tempo.

## Pay with anything: cross-chain payments with NEAR Intents

A client can pay with almost any token, on the chain it is already on.
NEAR Intents converts it, and the exact amount due arrives as USDC on Base.

- Forwend gets a NEAR Intents quote for the exact amount due and checks its signature.
- The client sends their token to a deposit address. The price holds for 15 minutes.
- Solvers in the NEAR Intents network convert it and deliver USDC to the invoice.
- The client pays the conversion cost. Your invoice is paid in full, as for a direct payment.
- Extra, short or failed money goes back to the client's refund address.
- It works in live mode only, because NEAR Intents has no testnet.

## Where we are going

We want anyone, in any country, to get paid in stablecoins, whatever their clients pay with.

Card payments are a planned step toward that.
A client will pay with a card, Apple Pay or Google Pay.
They won't need to know what a stablecoin is, and you will still receive stablecoins.

## Roadmap

- **Done: payments.** Invoices, payment links, hosted and embedded checkout, signed webhooks, and cross-chain payments through NEAR Intents.
- **Next: payments for AI agents.** With x402, an agent pays for an API or content per request, in stablecoins.
- **Planned: card and wallet payments.** Clients pay with a card, Apple Pay or Google Pay, and you receive stablecoins.
- **Planned: bank withdrawals.** Move stablecoins to your bank account.

## Status

- Forwend is under active development.
- Test mode runs on testnets.
- Live mode runs on mainnets as a development deployment.
- It is not for other people's money until a security review and an independent contract audit.

## NEAR HACKATHON

Forwend is entered in NEAR HACKATHON, in the Real-World Money track.
The cross-chain payments above were built during the hackathon.
