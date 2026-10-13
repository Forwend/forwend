import { PAY_STATES, type PayState } from "@/features/pay/pay";

/** Amounts arrive formatted with their symbol, like "1,250.00 USDC". */
export const PAY_COPY = {
  title: "Pay invoice",
  failed: "We could not load this invoice. Check your connection and try again.",
  retry: "Try again",
  invoice: (number: string) => `Invoice ${number}`,
  request: (number: string) => `Request ${number}`,
  noIssuer: "Invoice",
  pdf: "PDF",
  pdfLabel: "Download invoice PDF",
  amountDue: "Amount due",
  amountPaid: "Amount paid",
  leftToPay: "Left to pay",
  on: (network: string) => `on ${network}`,
  due: (date: string) => `Due ${date}`,
  closesIn: (left: string) => `Closes in ${left}`,
  stale: "Can't reach Forwend right now. This page keeps retrying.",
  loading: "Loading invoice",
  payWith: "Pay with",
  payingWith: "Paying with",
  progress: "Payment progress",
  network: "Network",
  token: "Token",
  usd: "USD",
  chooseNetwork: "Choose a network",
  chooseToken: "Choose a token",
  showAddress: "Show address",
  sendOnly: (symbol: string, network: string) => `Send only ${symbol} on ${network}.`,
  sendTo: (symbol: string, network: string) => `Send ${symbol} on ${network} to`,
  exactAmount: "Amount",
  copyAmount: "Copy amount",
  amountCopied: "Amount copied",
  copyAmountFailed: "Copy failed: type the amount instead",
  exchange: (amount: string) =>
    `Paying from an exchange? Make sure ${amount} arrives after its fee.`,
  closingSoon: "Less than 30 minutes left.",
  qr: "QR code of the address to pay",
  mismatch:
    "This payment page does not match the invoice. Do not pay; contact the invoice's creator.",
  unknownToken:
    "This page does not support the token this invoice asks for. Do not pay; contact the invoice's creator.",
  // One status line (R-68); confirming adds its block count (ConfirmingStatus).
  states: {
    [PAY_STATES.waiting]: () => "Waiting for payment…",
    // The steps say it arrived; the line counts the blocks (ConfirmingStatus).
    [PAY_STATES.confirming]: () => "Confirming",
    [PAY_STATES.checking]: () => "Final check",
    [PAY_STATES.partial]: ({ received, total, remaining }) =>
      `${received} of ${total} received. Send the remaining ${remaining}.`,
    [PAY_STATES.paid]: () => "Paid",
    [PAY_STATES.settled]: () => "Paid",
    [PAY_STATES.closed]: ({ payee }) =>
      `This invoice is closed. If you already sent money, it is not lost: contact ${payee}.`,
    [PAY_STATES.closedPartial]: ({ received, payee }) =>
      `Closed before the full amount arrived. The ${received} you sent is held for you; ask ${payee} to get it back.`,
  } satisfies Record<PayState, (v: StateValues) => string>,
  paidTo: (amount: string, name: string | null, at: string) =>
    name ? `${amount} to ${name} · ${at}` : `${amount} · ${at}`,
  paid: "Paid",
  closeHint: "You can close this page.",
  viewTx: "View transaction",
  receiptPdf: "Download receipt",
  backTo: (host: string) => `Back to ${host}`,
  // Who asked for the money: the name on the invoice, never "the sender", who could be read as the payer.
  creator: "the invoice's creator",
  late: (late: string, payee: string) =>
    `${late} arrived after the checkout closed. It is held for you; ask ${payee} to get it back.`,
  change: "Change",
  confirmChange: "Confirm change",
  changeLabel: "Change network and token",
  close: "Close",
  help: "Need help?",
  host: "You are on",
  hostHint: "Check that this is the site your link opened.",
  unverifiedName: "The name is what the invoice's creator gave; Forwend doesn't check it.",
  refund:
    "If you send more, or pay after the checkout closes, the extra is held for you and not paid out. Ask the invoice's creator to get it back.",
  scam: "Forwend never asks you to pay a different address or an extra fee.",
  paymentsBy: "Payments by",
  forwend: "Forwend",
  newTab: " (opens in a new tab)",
} as const;

interface StateValues {
  received: string;
  remaining: string;
  total: string;
  payee: string;
}
