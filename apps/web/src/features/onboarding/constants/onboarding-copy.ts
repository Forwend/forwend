import { CHECKLIST_STEPS, ONBOARDING_CHOICES } from "@/features/onboarding/constants/onboarding";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";

export const FIRST_RUN_COPY = {
  pageTitle: "Get started",
  title: "What do you want to do?",
  intro:
    "Pick all that fit. Each business use gets its own profile and wallet; you can add profiles later.",
  legend: "Uses",
  choices: {
    [ONBOARDING_CHOICES.receiveAndSend]: {
      title: "Receive and send",
      hint: "Hold stablecoins, send them on and request money from people you know.",
      result: "Your personal profile",
    },
    [ONBOARDING_CHOICES.getPaidByClients]: {
      title: "Get paid by clients",
      hint: "Send invoices with your business details and a link to pay.",
      result: "Adds a freelancer profile",
    },
    [ONBOARDING_CHOICES.acceptBusinessPayments]: {
      title: "Accept payments for my business",
      hint: "Take customer payments with a pay link per order.",
      result: "Adds a merchant profile",
    },
    [ONBOARDING_CHOICES.buildIntegration]: {
      title: "Build a payment integration",
      hint: "Connect checkout to your own site or app. The API comes later.",
      result: "Adds a merchant profile",
    },
  },
  continue: "Continue",
  skip: "Skip for now",
  failed: "We could not save your choice. Try again.",
} as const;

export const CHECKLIST_COPY = {
  title: "Get started",
  progress: (done: number, all: number) => `${done} of ${all} done`,
  close: "Close checklist",
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
