import { PAY_METHODS, PAY_STATES, type PayState } from "@/features/pay/pay";

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
  unverifiedName: "The sender gave this name. Forwend doesn't check it.",
  invoicePdf: "Download invoice PDF",
  amountDue: "Amount due",
  amountPaid: "Amount paid",
  leftToPay: "Left to pay",
  invoiceTotal: "Invoice total",
  receivedSoFar: "Received",
  stale: "We can't reach Forwend right now, so this page may be out of date. It keeps retrying.",
  loading: "Loading invoice",
  exactAmount: "Exact amount",
  copyAmount: "Copy amount",
  amountCopied: "Amount copied",
  copyAmountFailed: "Copy failed: type the amount instead",
  closingSoon:
    "Less than 30 minutes left. An exchange withdrawal can take longer; money that arrives after the checkout closes is held for you, not paid to the sender.",
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
  stepNetwork: "Network and token",
  stepDone: ", done",
  pair: (symbol: string, network: string) => `${symbol} on ${network}`,
  onlyOption: "The only way to pay this invoice",
  network: "Network",
  token: "Token",
  usd: "USD",
  chooseFirst: "Choose a network and token",
  change: "Change",
  changeNetwork: "Change network and token",
  changeMethod: "Change how you pay",
  methods: {
    [PAY_METHODS.wallet]: { label: "From a wallet", hint: "Send from a wallet app you control." },
    [PAY_METHODS.exchange]: {
      label: "From an exchange",
      hint: "Withdraw from your exchange account.",
    },
  },
  host: "You are on",
  hostHint: "Check that this is the site the sender's link opened.",
  refund:
    "If you send more, or pay after the checkout closes, the extra is held for you and not paid to the sender. Ask the sender to get it back; each refund is checked first.",
  scam: "Forwend never asks you to pay a different address or an extra fee.",
  confirm: (symbol: string, network: string) => `I will send ${symbol} on ${network}`,
  confirmHint: "The address appears after you confirm the network.",
  send: "Send the payment",
  how: "How you pay",
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
  paymentsBy: "Payments by",
  forwend: "Forwend",
  newTab: " (opens in a new tab)",
  backTo: (host: string) => `Back to ${host}`,
} as const;

interface StateValues {
  network: string;
  received: string;
  remaining: string;
}
