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
  // R-228: the client pays the fees on top of the price.
  withFees: (price: string, fees: readonly string[]) => `${price} plus ${fees.join(" and ")}`,
  networkFee: (amount: string) => `${amount} network fee`,
  platformFee: (amount: string) => `${amount} platform fee`,
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
  foundNote: (amount: string) => `Found ${amount}. Recording it now. Don't pay again.`,
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
  // Who asked for the money: the name on the invoice, never "the sender", who could be read as the payer.
  creator: "the recipient",
  // Held money gets one short line; Need help, behind How to get it back, explains the rest.
  overpaid: (extra: string) => `Overpaid by ${extra}`,
  late: (late: string) => `${late} arrived after the checkout closed`,
  // R-129.
  replaced: (number: string) => `This invoice was replaced by ${number}. Pay that one instead.`,
  openReplacement: (number: string) => `Open ${number}`,
  canceledHeld: (received: string) => `${received} held for you`,
  otherOption: (amount: string, network: string) =>
    `${amount} on ${network} went to another option`,
  howToGetBack: "How to get it back",
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
  // PLAN 11.10: support returns held money by hand for now, and never promises it.
  heldHelp: [
    "That money is held for you. It isn't paid to the recipient.",
    "Email support to get it back. We check each case and send it to the address it came from.",
    "Paid from an exchange or an app? Say so: we'll ask for an address of yours and proof that you sent it.",
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
  // D-123: paying from another chain and token through NEAR Intents, which delivers USDC on Base.
  crossChain: {
    other: "Pay with another token",
    otherHint: "From any chain, converted to USDC on Base by NEAR Intents",
    pickerTitle: "Pay with another token",
    chains: "Chains",
    searchChains: "Search chains",
    searchTokens: "Search tokens",
    tokensOn: (chain: string) => `Tokens on ${chain}`,
    noMatch: "No match",
    noTokens: "No other token can pay this invoice right now.",
    loadingTokens: "Loading tokens",
    choose: "Choose a token",
    change: "Change",
    direct: "Pay directly instead",
    estimate: (amount: string) => `About ${amount}`,
    // D-126: a token whose minimum is above what is due can't be picked.
    needsAtLeast: (amount: string) => `Needs at least ${amount}`,
    tooSmall: (due: string) =>
      `Greyed tokens need more than this payment of ${due}. NEAR Intents sets the minimum for each.`,
    youSend: "You send",
    gettingPrice: "Getting a price",
    fee: "Fee",
    feeHint: "NEAR Intents fee + network fee",
    feeValue: (usd: string) => `${usd} USD`,
    // R-244: what You send adds; the refund field says where the unused part goes.
    slippage: (percent: number) => `Slippage ${percent}%`,
    time: (minutes: number) =>
      minutes <= 1 ? "Arrives in about a minute" : `Arrives in about ${minutes} minutes`,
    refund: (chain: string) => `Refund address on ${chain}`,
    refundHint: "Unused slippage is refunded here. Use your own wallet, not an exchange.",
    refundNeeded: "Enter your address on this chain.",
    showAddress: "Show address",
    sendOnly: (symbol: string, chain: string) => `Send only ${symbol} on ${chain}.`,
    sendTo: (symbol: string, chain: string) => `Send ${symbol} on ${chain} to`,
    priceHeld: (left: string) => `Price held ${left}`,
    extraBack: "Sent more? The extra goes back to your refund address.",
    refundsTo: (address: string) => `Refunds go to ${address}`,
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
    // The payee turned it off, or the invoice can't take it now: trying again won't help (R-240).
    closed: "Paying with another token isn't available for this payment now. Pay directly instead.",
    refused: "NEAR Intents can't refund to this address. Check it is yours on this chain.",
    tooMany: "Too many prices asked for this payment. Try again later.",
    steps: {
      detected: "Detected",
      converting: "Converting",
      confirming: "Confirming",
      paid: "Paid",
    },
    seenOn: (chain: string) => `Payment seen on ${chain}. Don't pay again.`,
    converting: "NEAR Intents is converting it to USDC on Base.",
    // R-243: what happened to the payer's money, once 1Click saw it.
    sent: "You sent",
    arrived: "Arrived on Base",
    returned: "Returned to you",
    onChain: (amount: string, chain: string) => `${amount} on ${chain}`,
    returnedTo: (address: string) => `To ${address}`,
    incomplete: "Less than needed arrived. NEAR Intents returns it to your refund address.",
    refunded: "NEAR Intents returned the money to your refund address.",
    failed: "The conversion failed. NEAR Intents returns the money to your refund address.",
    supportId: (id: string) => `Quote ID for support: ${id}`,
    paidWith: "Paid with",
    paidWithValue: (amount: string, chain: string) => `${amount} on ${chain}`,
  },
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
