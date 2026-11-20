import type {
  createInvoiceBodySchema,
  feeQuoteSchema,
  invoiceEventsSchema,
  invoiceSchema,
  invoicesPageSchema,
  owedListSchema,
  payerEmailSchema,
  recheckSchema,
  stoppedRemindersSchema,
} from "@/features/invoices/schemas/invoices";
import type { Accepts, ApiAnswer, ApiBody, Check, Sends } from "@/shared/types/api-contract";

export type InvoicesSchemasMatchTheSpec = [
  Check<Accepts<typeof invoicesPageSchema, ApiAnswer<"/v1/profiles/{profileId}/invoices", "get">>>,
  Check<Accepts<typeof invoiceSchema, ApiAnswer<"/v1/invoices/{payToken}", "get">>>,
  Check<
    Accepts<typeof invoiceSchema, ApiAnswer<"/v1/profiles/{profileId}/invoices/{invoiceId}", "get">>
  >,
  Check<Accepts<typeof invoiceEventsSchema, ApiAnswer<"/v1/profiles/{profileId}/events", "get">>>,
  Check<Accepts<typeof feeQuoteSchema, ApiAnswer<"/v1/profiles/{profileId}/fees", "get">>>,
  Check<Accepts<typeof owedListSchema, ApiAnswer<"/v1/profiles/{profileId}/owed", "get">>>,
  Check<
    Accepts<
      typeof invoiceSchema,
      ApiAnswer<"/v1/profiles/{profileId}/invoices/{invoiceId}/cancel", "post">
    >
  >,
  Check<
    Accepts<
      typeof invoiceSchema,
      ApiAnswer<"/v1/profiles/{profileId}/invoices/{invoiceId}/reopen", "post">
    >
  >,
  Check<
    Accepts<
      typeof invoiceSchema,
      ApiAnswer<"/v1/profiles/{profileId}/invoices/{invoiceId}/send", "post">
    >
  >,
  Check<
    Accepts<
      typeof invoiceSchema,
      ApiAnswer<"/v1/profiles/{profileId}/invoices/{invoiceId}/reminders", "put">
    >
  >,
  Check<
    Accepts<
      typeof invoiceSchema,
      ApiAnswer<"/v1/profiles/{profileId}/invoices/{invoiceId}/details", "put">
    >
  >,
  Check<
    Accepts<
      typeof invoiceSchema,
      ApiAnswer<"/v1/profiles/{profileId}/invoices/{invoiceId}/repeat/stop", "post">
    >
  >,
  Check<Accepts<typeof stoppedRemindersSchema, ApiAnswer<"/v1/reminders/{token}/stop", "post">>>,
  Check<Accepts<typeof recheckSchema, ApiAnswer<"/v1/invoices/{payToken}/recheck", "post">>>,
  Check<Accepts<typeof payerEmailSchema, ApiAnswer<"/v1/invoices/{payToken}/payer-email", "put">>>,
  Check<Accepts<typeof invoiceSchema, ApiAnswer<"/v1/profiles/{profileId}/invoices", "post">>>,
  Check<
    Sends<typeof createInvoiceBodySchema, ApiBody<"/v1/profiles/{profileId}/invoices", "post">>
  >,
];
