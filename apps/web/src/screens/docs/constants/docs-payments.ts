import type { DocsArticle } from "../types/docs";

export const PAYMENT_PAGES: readonly DocsArticle[] = [
  {
    slug: "payments/direct",
    group: "Payments",
    title: "Direct payments",
    description:
      "The customer sends the token you accept, on its own network, to the payment's own address.",
    next: "payments/cross-chain",
    sections: [
      {
        id: "how",
        title: "How a direct payment works",
        points: [
          "Each token and network a payment accepts gets its own receive address, computed from the payment's terms.",
          "The customer picks the network, then the token, then presses Show address.",
          "The page shows the QR code, the address and the exact amount.",
          "The customer sends one ordinary transfer from a wallet or an exchange. No wallet connection and no Forwend account.",
          "The browser computes the address again from the terms, and shows none if they differ.",
        ],
      },
      {
        id: "tokens",
        title: "Tokens and networks",
        paragraphs: [
          "Live mode takes USDC on Base, Arbitrum and Arc, and OUSD on Tempo. A profile accepts the ones it has turned on.",
          "Developer mode uses the test networks, whose tokens have no value.",
        ],
        links: [{ label: "Networks and tokens", slug: "reference/networks" }],
      },
      {
        id: "steps",
        title: "From the transfer to your wallet",
        points: [
          "Detected: the transfer is seen on its network.",
          "Confirming: Forwend waits until its block is final. The page shows the blocks and time left.",
          "Paid: final transfers add up to the amount. Less than that is Partially paid.",
          "In your wallet: the payment's address sends the amount, less fees, to your profile wallet.",
        ],
        links: [{ label: "Payment status", slug: "integrate/payment-status" }],
      },
      {
        id: "fees",
        title: "Fees",
        paragraphs: [
          "Each network's fee covers moving the money to your wallet, rounded up to the cent. The form shows it before you save.",
          "You choose who pays it: you, or your client. When the client pays, the amount they see includes it.",
        ],
      },
      {
        id: "held",
        title: "Money that is held for the customer",
        paragraphs: [
          "This money does not pay the payment. It is kept apart from what you are owed.",
        ],
        points: [
          "Money above the amount.",
          "Money sent after the payment closes.",
          "Money sent to another token or network after one already paid the payment.",
          "The customer asks support for it, with the pay link and the transaction link.",
          "If you reopen a partly paid invoice that closed, its held money, up to the amount, becomes yours.",
          "Money sent in another token or on another network does not count. Support returns it where it can; nothing is promised.",
        ],
      },
    ],
  },
  {
    slug: "payments/cross-chain",
    group: "Payments",
    title: "Cross-chain payments",
    description:
      "The customer pays with a token on another chain. NEAR Intents converts it, and exactly the amount due arrives as USDC on Base.",
    previous: "payments/direct",
    sections: [
      {
        id: "when",
        title: "When it is offered",
        points: [
          "In live mode only: NEAR Intents has no test networks.",
          "On invoices, payment links and checkout that accept USDC on Base.",
          "While the payment stays open for at least 20 more minutes.",
          "While the profile has Accept other tokens on, in Settings, Accepted assets. It is on by default.",
        ],
      },
      {
        id: "tokens",
        title: "Which tokens",
        points: [
          "The list comes from NEAR Intents and is read again every 10 minutes. Stablecoins come first.",
          "Popular chains include Ethereum, Arbitrum, Solana, Tron, BNB Chain, Polygon, Optimism and Avalanche.",
          "Left out: Bitcoin, networks that need a memo (Stellar, XRP, TON) and tokens without a price.",
          "Tokens the payment takes directly are paid directly instead.",
          "A token whose minimum is above the amount due is greyed out and can't be picked.",
        ],
      },
      {
        id: "pay",
        title: "How the customer pays",
        points: [
          "On the pay page they choose Any token, then a chain and a token.",
          "The page shows what to send, the fee and the time before any address.",
          "They enter a refund address on the chain they pay from: their own wallet, not an exchange.",
          "The browser checks NEAR Intents' signed quote, then shows the deposit address.",
          "They send one ordinary transfer. The price holds for 15 minutes; after that the page asks for a new price.",
        ],
      },
      {
        id: "amounts",
        title: "What arrives and who pays",
        points: [
          "Exactly the amount due arrives as USDC on Base. Your invoice is paid in full.",
          "The customer pays the conversion fee and Base's network fee, shown in USD before paying.",
          "What they send includes a 1% price buffer. The unused part goes back to their refund address, less a refund fee.",
          "When the unused part is not larger than that fee, it may not come back. The page says so before they pay.",
          "Your own fees and the move to your wallet work as for a direct payment.",
        ],
      },
      {
        id: "refunds",
        title: "When money goes back",
        points: [
          "Extra money, too little money and failed conversions go back to the customer's refund address.",
          "Too little money waits until the quote's deadline, then goes back.",
          "A deposit sent after the price window still converts or goes back.",
          "Forwend holds none of this money: NEAR Intents returns it.",
          "USDC that reaches Base after another token already paid the payment is held for the customer, as for a direct payment.",
        ],
      },
      {
        id: "follow",
        title: "Following a payment",
        points: [
          "The customer sees four steps: payment received, converting to USDC, Base confirming, and paid.",
          "Your payments list tags it via NEAR Intents.",
          "Its page shows what the customer sent, the conversion and the USDC on Base, each with its transaction.",
          "Paid still comes only from the USDC that arrives on Base, and the same webhooks follow.",
        ],
        links: [{ label: "The crossChain field", slug: "integrate/payment-status" }],
      },
      {
        id: "off",
        title: "Turn it off",
        paragraphs: [
          "In Settings, Accepted assets, turn off Accept other tokens. New quotes stop; a quote already given still finishes.",
        ],
      },
    ],
  },
];
