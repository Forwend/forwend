import { PAY_STATES } from "@/features/pay/constants/pay";
import type { PayState } from "@/features/pay/types/pay";

/** Amounts arrive formatted with their symbol, like "1,250.00 USDC". */
export const PAY_COPY = {
  title: "Pay",
  failedTitle: "We could not load this payment",
  failed: "Check your connection and try again.",
  retry: "Try again",
  invoice: (number: string) => (number ? `Invoice ${number}` : "Invoice"),
  request: (number: string) => (number ? `Request ${number}` : "Request"),
  noIssuer: "Payment",
  checkout: "Checkout",
  pdfLabel: "Download invoice PDF",
  amountDue: "Amount due",
  amount: "Amount",
  amountPaid: "Amount paid",
  leftToPay: "Left to pay",
  on: (network: string) => `on ${network}`,
  reference: (reference: string) => `Reference ${reference}`,
  agreed: (value: string, date: string) => `Agreed value ${value} on ${date}`,
  due: (date: string) => `Due ${date}`,
  // R-128: what the issuer changed before any payment.
  updates: {
    title: "Updates",
    reference: "Reference updated",
    note: "Note updated",
    dueDate: (from: string | null, to: string | null) =>
      to
        ? from
          ? `Due date moved from ${from} to ${to}`
          : `Due date set to ${to}`
        : "Due date removed",
  },
  closesIn: (left: string) => `Closes in ${left}`,
  stale: "Can't reach the server. Retrying…",
  loading: "Loading payment",
  payWith: "Pay with",
  payingWith: "Paying with",
  progress: "Payment progress",
  network: "Network",
  token: "Token",
  chooseNetwork: "Choose a network",
  chooseToken: "Choose a token",
  searchNetworks: "Search networks",
  searchTokens: "Search tokens",
  noMatch: "No match",
  showAddress: "Show address",
  sendOnly: (symbol: string, network: string) => `Send only ${symbol} on ${network}.`,
  // R-78: a bridged token with the same name is another contract, and does not pay this invoice.
  notLookalike: (symbol: string, lookalike: string) => `Native ${symbol}, not ${lookalike}.`,
  contract: (symbol: string) => `${symbol} contract`,
  sendTo: (symbol: string, network: string) => `Send ${symbol} on ${network} to`,
  updatesItself: "This page updates on its own.",
  found: "Payment found",
  foundNote: "Recording it now. Don't pay again.",
  // R-68: once money is seen the payer has nothing left to do; saying so keeps them from paying twice.
  seen: "Payment detected",
  finalAround: (time: string) => `Final around ${time}`,
  nothingToDo: "Don't pay again. This page updates on its own.",
  exactAmount: "Amount",
  copyAmount: "Copy amount",
  amountCopied: "Amount copied",
  copyAmountFailed: "Copy failed: type the amount instead",
  exchange: (amount: string, network: string) =>
    `Paying from an exchange? Withdraw on ${network}, and make sure ${amount} arrives after its fee.`,
  closingSoon: "Less than 30 minutes left.",
  qr: "QR code of the address to pay",
  mismatch: "This payment page does not match the payment. Do not pay; contact the recipient.",
  unknownToken:
    "This page does not support the token this payment asks for. Do not pay; contact the recipient.",
  // One status line (R-68); confirming adds its block count (ConfirmingStatus).
  states: {
    [PAY_STATES.waiting]: () => "Waiting for payment…",
    // The steps say it arrived; the line counts the blocks (ConfirmingStatus).
    [PAY_STATES.confirming]: () => "Confirming",
    // Final on chain, not yet booked: no time is promised, because none is known.
    [PAY_STATES.checking]: ({ delayed }) =>
      delayed ? "Confirmation is taking longer than usual." : "Awaiting confirmation.",
    [PAY_STATES.review]: () =>
      "Payment could not be verified. Contact the merchant before sending more.",
    [PAY_STATES.partial]: ({ received, total, remaining }) =>
      `${received} of ${total} received. Send the remaining ${remaining}.`,
    [PAY_STATES.paid]: () => "Paid",
    [PAY_STATES.settled]: () => "Paid",
    [PAY_STATES.closing]: ({ received }) =>
      `Checkout closed. ${received} is recorded. We are checking the final payment records.`,
    [PAY_STATES.closed]: ({ payee }) =>
      `This payment is closed. If you already sent money, it is not lost: contact ${payee}.`,
    [PAY_STATES.canceled]: ({ payee }) => `${payee} closed this payment. Do not send money.`,
    [PAY_STATES.closedPartial]: ({ received, payee }) =>
      `Closed before the full amount arrived. The ${received} you sent is held for you; ask ${payee} to get it back.`,
  } satisfies Record<PayState, (v: StateValues) => string>,
  receiptRows: { amount: "Amount", to: "Paid to", date: "Date", transaction: "Transaction" },
  paid: "Paid",
  closeHint: "You can close this page.",
  viewTx: "View transaction",
  receiptPdf: "Download receipt",
  backTo: (host: string) => `Back to ${host}`,
  // Who asked for the money: the name on the invoice, never "the sender", who could be read as the payer.
  creator: "the recipient",
  // Address poisoning: a look-alike address planted in the payer's wallet history after the first payment (R-77).
  copyFromHere:
    "Copy the address from this page for the rest, not from your wallet's history: scammers plant look-alike addresses there.",
  overpaid: (extra: string) => `Overpaid by ${extra}. The extra is held for you.`,
  late: (late: string, payee: string) =>
    `${late} arrived after the checkout closed. It is held for you; ask ${payee} to get it back.`,
  // R-129.
  replaced: (number: string) => `This invoice was replaced by ${number}. Pay that one instead.`,
  openReplacement: (number: string) => `Open ${number}`,
  canceledHeld: (received: string, payee: string) =>
    `The ${received} you sent is held for you; ask ${payee} to get it back.`,
  otherOption: (amount: string, network: string, payee: string) =>
    `${amount} sent on ${network} went to another payment option. It is held for you; ask ${payee} to get it back.`,
  // R-82, D-68.
  receipt: {
    open: "Email me a receipt",
    label: "Email me the receipt (optional)",
    placeholder: "you@example.com",
    hint: "Used for this receipt only. Nothing else is sent to it.",
    send: "Send",
    sentTitle: "Receipt sent",
    savedTitle: "Receipt saved",
    another: "Use another address",
    before: (email: string) => `We will email the receipt to ${email} once it is paid.`,
    after: (email: string) => `The receipt is on its way to ${email}.`,
    invalid: "Enter an address like name@example.com.",
    sent: "The receipt was already sent.",
    tooMany: "Too many tries. Wait a minute and try again.",
    failed: "We could not save the address. Try again.",
  },
  change: "Change",
  confirmChange: "Confirm change",
  changeLabel: "Change network and token",
  close: "Close",
  help: "Need help?",
  host: "You are on",
  hostHint: "Check that this is the site your link opened.",
  unverifiedName: "The name is what the recipient gave; Forwend doesn't check it.",
  refund:
    "If you send more, or pay after the checkout closes, the extra is held for you and not paid out. Ask the recipient to get it back.",
  scam: "Forwend never asks you to pay a different address or an extra fee.",
  testnet: "Testnet",
  testnetHint: "Test tokens have no monetary value.",
  paymentsBy: "Payments by",
  forwend: "Forwend",
  newTab: " (opens in a new tab)",
} as const;

/** R-142: a payment link's page, before Pay creates checkout. */
export const LINK_PAY_COPY = {
  title: "Payment link",
  loading: "Loading the payment link",
  amount: "Amount",
  amountField: "Amount (USD)",
  amountHint: (limits: string) => `${limits}. You pay in a stablecoin worth 1 USD each.`,
  fixedHint: "You pay in a stablecoin worth 1 USD each.",
  pay: "Pay",
  previous: "Your previous payment",
  purchaseHelp: "Continue this payment, or start a separate purchase.",
  continue: "Continue payment",
  another: "Start another purchase",
  next: "You pick the token and network on the next page.",
  payPanel: "Pay with stablecoins",
  closed: {
    off: "This link is off. Ask the seller for another way to pay.",
    ended: "This link has ended. Ask the seller for another way to pay.",
    full: "This link has no available payment slots right now.",
    not_ready: "This seller can't take payments yet. Ask them for another way to pay.",
  },
  errors: {
    amount: "Enter an amount like 25 or 25.50.",
    limits: (limits: string) => `Enter an amount within the limits: ${limits}.`,
    busy: "Many payments are starting right now. Try again in a minute.",
    notReady: "This seller can't take payments yet. Ask them for another way to pay.",
    failed: "We could not check whether checkout started. Continue payment to try again.",
    changed: "This offer changed. Start another purchase to review the current price.",
  },
} as const;

interface StateValues {
  delayed: boolean;
  received: string;
  remaining: string;
  total: string;
  payee: string;
}
