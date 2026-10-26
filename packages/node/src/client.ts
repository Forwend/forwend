import { randomUUID } from "node:crypto";
import { ForwendError } from "./errors.js";
import type {
  CheckoutSession,
  CreateCheckoutSession,
  CreateInvoice,
  Invoice,
  ListInvoices,
  ListPayments,
  ListWebhookEvents,
  Payment,
  WebhookEvent,
} from "./types.js";

export interface ForwendOptions {
  /** A secret API key. Keep it on the server, never in a web page or an app. */
  apiKey: string;
  /** The profile the key was made for. */
  profileId: string;
  /** The API's address, such as https://forwend.com/api; the routes' /v1/… paths go after it. */
  baseUrl: string;
  /** Another fetch, for tests or another runtime; the global one by default. */
  fetch?: typeof fetch;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

type Query = Record<string, string | number | undefined>;

/** Server operations for one profile, restricted by its API key's store, mode and scopes. */
export class Forwend {
  readonly checkoutSessions: {
    create(
      body: CreateCheckoutSession,
      options?: { idempotencyKey?: string },
    ): Promise<CheckoutSession>;
    get(sessionId: string): Promise<CheckoutSession>;
    list(params?: ListPayments): AsyncGenerator<CheckoutSession>;
    /** Refuses expiration once any payment has been seen. Repeated expiration is safe. */
    expire(sessionId: string): Promise<CheckoutSession>;
  };
  readonly payments: {
    get(paymentId: string): Promise<Payment>;
    list(params?: ListPayments): AsyncGenerator<Payment>;
  };
  readonly invoices: {
    /** Creates an invoice. The same idempotencyKey and body return the same invoice; one is made when none is given. */
    create(body: CreateInvoice, options?: { idempotencyKey?: string }): Promise<Invoice>;
    get(invoiceId: string): Promise<Invoice>;
    /** Every invoice, newest first, page after page through nextCursor. */
    list(params?: ListInvoices): AsyncGenerator<Invoice>;
  };
  readonly webhookEvents: {
    /** The last 30 days of events, newest first, page after page through nextCursor. */
    list(params?: ListWebhookEvents): AsyncGenerator<WebhookEvent>;
  };

  readonly #options: ForwendOptions;

  constructor(options: ForwendOptions) {
    this.#options = options;
    const profile = `/v1/profiles/${encodeURIComponent(options.profileId)}`;
    this.checkoutSessions = {
      create: (body, { idempotencyKey = randomUUID() } = {}) =>
        this.#request("POST", `${profile}/checkout-sessions`, {}, body, {
          "Idempotency-Key": idempotencyKey,
        }),
      get: (sessionId) =>
        this.#request("GET", `${profile}/checkout-sessions/${encodeURIComponent(sessionId)}`),
      list: (params = {}) => this.#pages(`${profile}/checkout-sessions`, { ...params }),
      expire: (sessionId) =>
        this.#request(
          "POST",
          `${profile}/checkout-sessions/${encodeURIComponent(sessionId)}/expire`,
        ),
    };
    this.payments = {
      get: (paymentId) =>
        this.#request("GET", `${profile}/payments/${encodeURIComponent(paymentId)}`),
      list: (params = {}) => this.#pages(`${profile}/payments`, { ...params }),
    };
    this.invoices = {
      create: (body, { idempotencyKey = randomUUID() } = {}) =>
        this.#request("POST", `${profile}/invoices`, {}, body, {
          "Idempotency-Key": idempotencyKey,
        }),
      get: (invoiceId) =>
        this.#request("GET", `${profile}/invoices/${encodeURIComponent(invoiceId)}`),
      list: (params = {}) => this.#pages(`${profile}/invoices`, { ...params }),
    };
    this.webhookEvents = {
      list: (params = {}) => this.#pages(`${profile}/webhook-events`, { ...params }),
    };
  }

  async *#pages<T>(path: string, query: Query): AsyncGenerator<T> {
    let cursor = query.cursor;
    do {
      const page: Page<T> = await this.#request("GET", path, { ...query, cursor });
      yield* page.items;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  async #request<T>(
    method: string,
    path: string,
    query: Query = {},
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    // Appended, not resolved: new URL("/v1/…", "https://forwend.com/api") would drop /api.
    const url = new URL(this.#options.baseUrl.replace(/\/+$/, "") + path);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    const response = await (this.#options.fetch ?? fetch)(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.#options.apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      // A proxy's error page is not JSON: the status still says what happened.
      if (response.ok) {
        throw new ForwendError(
          response.status,
          "invalid_response",
          "the API answered with a body that is not JSON",
        );
      }
    }
    if (!response.ok) {
      const error = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new ForwendError(
        response.status,
        error?.code ?? "unknown",
        error?.message ?? `the API answered ${response.status}`,
      );
    }
    return json as T;
  }
}
