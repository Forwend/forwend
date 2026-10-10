import { PAY_STATES, type PayState } from "@/features/pay/pay";

/** Amounts arrive formatted with their symbol, like "1,250.00 USDC". */
export const PAY_COPY = {
  title: "Pay invoice",
  failed: "We could not load this invoice. Check your connection and try again.",
  retry: "Try again",
  invoice: (number: string) => `Invoice ${number}`,
  // A personal profile's request has no issuer, only the name its sender gave (D-52).
  requests: (name: string, amount: string) => `${name} requests ${amount}`,
  request: (number: string) => `Request ${number}`,
  noIssuer: "The sender gave no name or billing details for this invoice.",
  invoicePdf: "Download invoice PDF",
  amountDue: "Amount due",
  amountPaid: "Amount paid",
  dueDate: "Due date",
  closes: "Checkout closes",
  closesIn: (left: string) => `in ${left}`,
  closedNow: "closed",
  note: "Note from the sender",
  testnet: (network: string, symbol: string) =>
    `${network} is a test network. Pay with test ${symbol}; it has no real value.`,
  mismatch: "This payment page does not match the invoice. Do not pay; contact the sender.",
  unknownToken:
    "This page does not support the token this invoice asks for. Do not pay; contact the sender.",
  beforeYouPay: "Before you pay",
  host: "You are on",
  hostHint: "Check that this is the site the sender's link opened.",
  refund: (amount: string) =>
    `Send exactly ${amount}. If you send more, or pay after the checkout closes, the extra is held for you and not paid to the sender. Ask the sender to get it back; each refund is checked first.`,
  scam: "Forwend never asks you to pay a different address or an extra fee.",
  confirm: (symbol: string, network: string) => `I will send ${symbol} on ${network}`,
  confirmHint: "The address appears after you confirm the network.",
  confirmed: (symbol: string, network: string) => `You will send ${symbol} on ${network}`,
  send: "Send the payment",
  how: "How you pay",
  wallet: "From a wallet",
  exchange: "From an exchange",
  walletSteps: (amount: string, network: string) => [
    `Open your wallet and choose the ${network} network.`,
    `Send exactly ${amount} to the address below. Scan the code or copy the address.`,
    "Keep this page open. The status updates by itself.",
  ],
  exchangeSteps: (amount: string, symbol: string, network: string) => [
    `Choose Withdraw, then ${symbol}, then the ${network} network. Another network loses the money, even with the same token.`,
    "Paste the address below as where to send it.",
    `Make sure ${amount} arrives. If the exchange takes its withdrawal fee from the amount, add the fee on top.`,
  ],
  address: (symbol: string, network: string) => `Send ${symbol} on ${network} to`,
  qr: "QR code of the address to pay",
  status: "Payment status",
  progress: "Payment progress",
  // Confirming has its own short line (ConfirmingStatus).
  states: {
    [PAY_STATES.waiting]: () =>
      "Waiting for your payment. This page updates by itself; you don't need to reload it.",
    [PAY_STATES.checking]: ({ network }) =>
      `Your payment is final on ${network}. We are checking it once more before the invoice is marked paid.`,
    [PAY_STATES.partial]: ({ received, remaining }) =>
      `We received ${received}. Send the remaining ${remaining} to the same address before the checkout closes.`,
    [PAY_STATES.paid]: () =>
      "Paid. Forwend is now sending the money to the sender. You can close this page.",
    [PAY_STATES.settled]: () =>
      "Settled. The sender has received the money. You can close this page.",
    [PAY_STATES.closed]: () =>
      "The checkout has closed. Do not send money to this address; ask the sender for a new pay link.",
    [PAY_STATES.closedPartial]: ({ received }) =>
      `The checkout closed before the full amount arrived. Do not send more. The ${received} you sent is held for you; ask the sender to get it back.`,
  } satisfies Record<Exclude<PayState, typeof PAY_STATES.confirming>, (v: StateValues) => string>,
  extra: (extra: string) =>
    `You sent ${extra} more than the invoice. The extra is held for you; ask the sender to get it back.`,
  late: (late: string) =>
    `${late} arrived after the checkout closed. It is held for you, not paid to the sender; ask the sender to get it back.`,
  receipt: "Receipt",
  paidAt: "Paid",
  settledAt: "Settled",
  paymentTx: (count: number) => (count === 1 ? "Payment transaction" : "Payment transactions"),
  settlementTx: "Settlement transaction",
  receiptPdf: "Download receipt PDF",
  footer: "Payments by Forwend. You don't need an account to pay.",
} as const;

interface StateValues {
  network: string;
  received: string;
  remaining: string;
}
