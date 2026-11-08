import { CHECKLIST_STEPS, ONBOARDING_CHOICES } from "@/features/onboarding/constants/onboarding";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";

export const FIRST_RUN_COPY = {
  pageTitle: "Get started",
  stepCount: (at: number, all: number) => `Step ${at} of ${all}`,
  steps: "Setup steps",
  signOut: "Sign out",
  back: "Back",
  continue: "Continue",
  skipStep: "Skip for now",
  failed: "We could not save that. Try again.",
  use: {
    title: "What will you use Forwend for?",
    intro: "Pick all that fit. We set up a profile for each, and you can add more later.",
    legend: "Uses",
    skip: "Skip setup",
    pickOne: "Pick at least one, or skip setup.",
    choices: {
      [ONBOARDING_CHOICES.receiveAndSend]: {
        title: "Send and receive",
        hint: "Hold stablecoins, pay people back and request money.",
        result: "Personal profile",
      },
      [ONBOARDING_CHOICES.getPaidByClients]: {
        title: "Invoice clients",
        hint: "Bill for your work with your details and a link to pay.",
        result: "Freelancer profile",
      },
      [ONBOARDING_CHOICES.acceptBusinessPayments]: {
        title: "Take payments for my business",
        hint: "Payment links and checkout for each order.",
        result: "Business profile",
      },
      [ONBOARDING_CHOICES.buildIntegration]: {
        title: "Build with the API",
        hint: "Create checkouts from your server, with test keys today.",
        result: "Business profile",
      },
    },
  },
  details: {
    [PROFILE_KINDS.freelancer]: {
      title: "How should clients see you?",
      intro: "This goes on your invoices and pay pages. You can change it any time.",
      name: "Name on invoices",
      previewName: "Your name",
    },
    [PROFILE_KINDS.merchant]: {
      title: "Tell customers who you are",
      intro: "Your business name and details go on invoices, payment links and checkout.",
      name: "Business name",
      previewName: "Your business",
    },
    email: "Contact email",
    address: "Address",
    country: "Country",
    countryPlaceholder: "Choose a country",
    searchCountries: "Search countries",
    website: "Website for checkout (optional)",
    websitePlaceholder: "https://shop.example",
    websiteInvalid: "Use an address like https://shop.example, with nothing after the domain.",
    preview: "How it looks on an invoice",
    previewLabel: "Preview of an invoice with these details",
    sampleNote: "The client and items are an example.",
    sample: {
      number: "INV-0001",
      client: { name: "Northwind Studio GmbH", lines: ["Torstraße 12", "10119 Berlin", "Germany"] },
      title: "Website redesign, first phase",
      lines: [
        {
          description: "Design system and components",
          quantity: "1",
          unitPrice: "1,800.00 USDC",
          amount: "1,800.00 USDC",
        },
        {
          description: "Landing page",
          quantity: "2",
          unitPrice: "450.00 USDC",
          amount: "900.00 USDC",
        },
      ],
      total: "2,700.00 USDC",
    },
  },
  tokens: {
    title: "Where you get paid",
    intro: "Paid invoices settle into the profile's wallet. Payers can use only what you accept.",
    testnet: "Test money only.",
    testnetDetail: "These are test networks; the tokens have no value.",
    faucet: "Get free test USDC",
    faucetLabel: "Get free test USDC from Circle's faucet (opens a new tab)",
    label: "Accept",
    lastOn: "Keep at least one token on.",
    loading: "Loading tokens",
    failed: "We could not load the tokens. Try again.",
    retry: "Try again",
  },
  passkey: {
    title: "Sign in faster next time",
    intro:
      "Add a passkey: your fingerprint, face or screen lock instead of an email code. It stays on your device.",
    points: ["No code to wait for", "Can't be phished like a code", "Email sign-in keeps working"],
    add: "Add a passkey",
    notNow: "Not now",
    failed: "The passkey was not added. Try again, or skip for now.",
  },
  ready: {
    title: {
      [PROFILE_KINDS.freelancer]: "Your freelancer profile is ready",
      [PROFILE_KINDS.merchant]: "Your business profile is ready",
      [PROFILE_KINDS.personal]: "Your account is ready",
    },
    actions: {
      [PROFILE_KINDS.freelancer]: {
        title: "Create your first invoice",
        hint: "Your details are already on it. Send the link to a client, or pay it yourself to try it.",
      },
      [PROFILE_KINDS.merchant]: {
        title: "Create a payment link",
        hint: "Share it with a customer, or open it and pay it yourself to try it.",
      },
      developer: {
        title: "Create an API key",
        hint: "Then start a checkout from your server.",
      },
      [PROFILE_KINDS.personal]: {
        title: "Open your wallet",
        hint: "Receive shows your address and the networks it takes.",
      },
    },
    faucet: "Get free test USDC",
    faucetHint: "From Circle's faucet, on the networks you accept.",
    newTab: "(opens a new tab)",
    guide: "Your first test payment",
    guideHint: "A 5-minute guide in the docs.",
    later: "Tax ID and the rest wait in your setup guide.",
    overview: "Go to overview",
    done: "Set up",
  },
} as const;

export const CHECKLIST_COPY = {
  title: "Get started",
  progress: (done: number, all: number) => `${done} of ${all} done`,
  skip: "Skip",
  skipStep: (title: string) => `Skip: ${title}`,
  done: "Done",
  notDone: "Not done",
  passkeyFailed: "The passkey was not added. Try again.",
  steps: {
    [CHECKLIST_STEPS.passkey]: {
      title: "Add a passkey",
      hint: "Your fingerprint, face or screen lock instead of an email code.",
      action: "Add passkey",
    },
    [CHECKLIST_STEPS.billingDetails]: {
      title: "Add billing details",
      hint: "Your name and address on every invoice and PDF.",
      action: "Add details",
    },
    [CHECKLIST_STEPS.firstInvoice]: {
      [PROFILE_KINDS.freelancer]: {
        title: "Send your first invoice",
        hint: "Create an invoice and send its pay link to your client.",
        action: "New invoice",
      },
      [PROFILE_KINDS.personal]: {
        title: "Request money",
        hint: "Create a request and send its link.",
        action: "Request",
      },
    },
    [CHECKLIST_STEPS.firstPaid]: {
      [PROFILE_KINDS.freelancer]: {
        title: "Get an invoice paid",
        hint: "Paid in full on the network it asks for.",
        action: "View invoices",
      },
      [PROFILE_KINDS.personal]: {
        title: "Get a request paid",
        hint: "Paid in full on the network it asks for.",
        action: "View requests",
      },
    },
    [CHECKLIST_STEPS.firstMoney]: {
      title: "Receive money",
      hint: "Money in this profile's wallet, final on its network.",
      action: "Receive",
    },
  },
} as const;
