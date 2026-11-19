import { timeLeft } from "@/features/invoices/constants/invoices-copy";
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
  withFees: (price: string, fees: readonly string[]) => `${price} plus ${fees.join(" and ")}`,
  networkFee: (amount: string) => `${amount} network fee`,
  platformFee: (amount: string) => `${amount} platform fee`,
  reference: (reference: string) => `Reference ${reference}`,
  agreed: (value: string, date: string) => `Agreed value ${value} on ${date}`,
  due: (date: string) => `Due ${date}`,
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
  loading: "Loading payment",
  payWith: "Pay with",
  payBox: "Payment",
  ways: { label: "How to pay", direct: "Stablecoin", cross: "Any token" },
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
  notLookalike: (symbol: string, lookalike: string) => `Native ${symbol}, not ${lookalike}.`,
  contract: (symbol: string) => `${symbol} contract`,
  sendTo: (symbol: string, network: string) => `Send ${symbol} on ${network} to`,
  updatesItself: "This page updates on its own.",
  found: "Payment found",
  foundNote: (amount: string) => `Found ${amount}. Recording it now. Don't pay again.`,
  nothingMore: "Nothing more to do",
  nothingMoreNote: "Don't send again. You can close this page; it keeps updating if you stay.",
  steps: {
    received: "We received your payment",
    receivedMore: "We received another payment",
    confirms: (network: string) => `${network} confirms the transfer`,
    confirming: (network: string) => `${network} is confirming the transfer`,
    confirmed: (network: string) => `${network} confirmed the transfer`,
    paid: (payee?: string) => `${payee ?? "The recipient"} is paid`,
  },
  receivedOn: (network: string, time: string) => `on ${network} · ${time}`,
  confirmingLine: (done: number, total: number, seconds: number, final: string | null) => {
    const line = [
      total > 0
        ? `${done.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} blocks`
        : null,
      seconds > 0 ? `${timeLeft(seconds)} left` : null,
      final ? `final around ${final}` : null,
    ]
      .filter((part) => part !== null)
      .map((part) => part.replaceAll(" ", "\u00a0"))
      .join(" · ");
    return line ? `${line[0]?.toUpperCase()}${line.slice(1)}` : "Confirming";
  },
  exactAmount: "You send",
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
  states: {
    [PAY_STATES.waiting]: () => "Waiting for payment…",
    [PAY_STATES.confirming]: () => "Confirming",
    [PAY_STATES.checking]: ({ delayed }) =>
      delayed ? "Confirmation is taking longer than usual." : "Awaiting confirmation.",
    [PAY_STATES.review]: () =>
      "Payment could not be verified. Contact the merchant before sending more.",
    [PAY_STATES.partial]: ({ received, remaining }) =>
      `${received} received. ${remaining} left to send.`,
    [PAY_STATES.paid]: () => "Paid",
    [PAY_STATES.settled]: () => "Paid",
    [PAY_STATES.closing]: ({ received }) =>
      `Checkout closed. ${received} is recorded. We are checking the final payment records.`,
    [PAY_STATES.closed]: () =>
      "This payment is closed. Do not send money. If you already did, Need help says what to do.",
    [PAY_STATES.canceled]: ({ payee }) => `${payee} closed this payment. Do not send money.`,
    [PAY_STATES.closedPartial]: ({ received }) =>
      `Closed before the full amount arrived. ${received} is held for you.`,
  } satisfies Record<PayState, (v: StateValues) => string>,
  closedTitles: { [PAY_STATES.canceled]: "Payment closed", [PAY_STATES.closed]: "Checkout closed" },
  receiptRows: { amount: "Amount", to: "Paid to", date: "Date", transaction: "Transaction" },
  paid: "Paid",
  closeHint: "You can close this page.",
  viewTx: "View transaction",
  receiptPdf: "Download receipt",
  backTo: (host: string) => `Back to ${host}`,
  creator: "the recipient",
  overpaid: (extra: string) => `Overpaid by ${extra}`,
  late: (late: string) => `${late} arrived after the checkout closed`,
  replaced: (number: string) => `This invoice was replaced by ${number}. Pay that one instead.`,
  openReplacement: (number: string) => `Open ${number}`,
  canceledHeld: (received: string) => `${received} held for you`,
  otherOption: (amount: string, network: string) =>
    `${amount} on ${network} went to another option`,
  howToGetBack: "How to get it back",
  receipt: {
    open: "Email me a receipt",
    label: "Email me the receipt (optional)",
    placeholder: "you@example.com",
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
  helpSections: {
    check: "Check this page",
    held: "Sent too much, too late or after it closed?",
    wrong: "Sent on the wrong network or token?",
  },
  host: "You are on",
  hostHint: "Check that this is the site your link opened.",
  embeddedHost: "This checkout comes from",
  embeddedHostHint: "Open it in a new tab to see that address in your browser.",
  openInTab: "Open in a new tab",
  unverifiedName: "The name at the top is what the recipient gave. Forwend doesn't check it.",
  scam: "Forwend never asks you to pay a different address or a fee this page doesn't show.",
  heldHelp: [
    "That money is held for you. It isn't paid to the recipient.",
    "Email support to get it back. We check each case and send it to the address it came from.",
    "Paid from an exchange, an app or another network? Say so: we'll ask for an address of yours on the invoice's network and proof that you sent it.",
    "Some returns have to wait days or weeks, and support tells you when.",
    "Held amounts under 0.10 USD aren't returned. They stay held and may never come back.",
  ],
  wrongHelp:
    "Email support with your transaction link and the network you used. We'll check whether it can be returned, but we can't promise it.",
  emailSupport: "Email support",
  supportAddress: (email: string) => `Or write to ${email}`,
  copyEmail: "Copy email address",
  emailCopied: "Email address copied",
  copyEmailFailed: "Copy failed: type the address instead",
  supportMail: {
    subject: "Help with a payment",
    body: (payLink: string) => `Pay link: ${payLink}\nTransaction link:\nWhat happened:\n`,
  },
  testnet: "Testnet",
  testnetHint: "Test tokens have no monetary value.",
  paymentsBy: "Payments by",
  forwend: "Forwend",
  newTab: " (opens in a new tab)",
  crossChain: {
    pickerTitle: "Pay with any token",
    chains: "Networks",
    backToChains: "Networks",
    tokenCount: (n: number) => (n === 1 ? "1 token" : `${n} tokens`),
    tokensOn: (chain: string) => `Tokens on ${chain}`,
    noTokens: "No other token can pay this invoice right now.",
    loadingTokens: "Loading tokens",
    estimate: (amount: string) => `About ${amount}`,
    needsAtLeast: (amount: string) => `Needs at least ${amount}`,
    youSend: "You send",
    conversionFee: "Conversion and network fee",
    feeApprox: (usd: string) => `≈ ${usd} USD`,
    buffer: (percent: number) => `Price buffer of ${percent}%`,
    bufferBack: "Unused part returns to you",
    bufferUnderFee: "Less than the refund fee",
    arrivesIn: "Arrives in",
    arrives: (minutes: number) => (minutes <= 1 ? "About a minute" : `About ${minutes} minutes`),
    refundFeeRow: "Refund fee",
    gettingPrice: "Getting a price",
    feeHint: "NEAR Intents fee + network fee",
    refund: (chain: string) => `Refund address on ${chain}`,
    refundHint:
      "The unused buffer comes back here, less the refund fee. Use your own wallet, not an exchange.",
    slippageUnderFee: "The unused buffer is less than the refund fee, so it may not come back.",
    priceHeldRow: "Price held",
    refundsTo: "Refunds go to",
    expired: "This price expired",
    expiredNote:
      "Don't send to this address. Already sent? Wait here: this page updates on its own.",
    newPrice: "Get new price",
    changed: "The price changed",
    changedNote: (before: string, now: string) => `You now send ${now}, not ${before}.`,
    understood: "Understood",
    newAddress: "New address. Send only to this one.",
    unverified: "We could not check this address with NEAR Intents, so it is not shown. Try again.",
    belowMinimum: "This token needs a larger payment. Choose another token.",
    cantConvert: "NEAR Intents can't convert this token now. Choose another token.",
    unavailable: "NEAR Intents is not answering. Try again in a minute.",
    closed: "Paying with another token isn't available for this payment now. Pay directly instead.",
    refused: "NEAR Intents can't refund to this address. Check it is yours on this chain.",
    quoteRefused: "NEAR Intents refused this quote. Try again later or choose another token.",
    tooMany: "Too many prices asked for this payment. Try again later.",
    steps: {
      converting: (symbol: string) => `Converting to ${symbol}`,
      converted: (symbol: string) => `Converted to ${symbol}`,
    },
    converting: "NEAR Intents is exchanging it.",
    onChain: (symbol: string, chain: string) => `${symbol} on ${chain}`,
    arrived: (chain: string, time: string | null) =>
      time ? `arrived on ${chain} · ${time}` : `arrived on ${chain}`,
    returnedTo: (amount: string, address: string) => `${amount} returned to ${address}`,
    incomplete: (time: string) =>
      `Less than needed arrived. NEAR Intents holds it until ${time}, then returns it to your refund address.`,
    incompleteLate: "Less than needed arrived. NEAR Intents returns it to your refund address.",
    refunded: "NEAR Intents returned the money to your refund address.",
    failed: "The conversion failed. NEAR Intents returns the money to your refund address.",
    supportId: (id: string) => `Quote ID for support: ${id}`,
    paidWith: "Paid with",
    paidWithValue: (amount: string, chain: string) => `${amount} on ${chain}`,
  },
} as const;

export const LINK_PAY_COPY = {
  title: "Payment link",
  loading: "Loading the payment link",
  amount: "Amount",
  amountField: "Amount (USD)",
  amountHint: (min: string | null, max: string | null) =>
    `Min ${min ?? "1.00"} USD${max ? `, max ${max} USD` : ""}`,
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
