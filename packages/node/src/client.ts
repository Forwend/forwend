import { randomUUID } from "node:crypto";
import { ForwendError } from "./errors.js";
import type {
  CheckoutSession,
  CreateCheckoutSession,
  CreateInvoice,
  Invoice,
  InvoiceDetails,
  ListCheckoutSessions,
  ListInvoices,
  ListPayments,
  ListWebhookEvents,
  Payment,
  PaymentDetails,
  Store,
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
  /** How long one try may take, in milliseconds; 30000 by default. */
  timeoutMs?: number;
  /** Tries again after a rate limit, and after a lost or failed answer when that is safe; 2 by default. */
  maxRetries?: number;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

type Query = Record<string, string | number | undefined>;

// API ids are hex or UUIDs. Anything else, like "..", would change the path it goes into.
const ID = /^[0-9A-Za-z_-]+$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
// A gateway error may come after the API acted, so these are tried again only for a read or a keyed request.
const RETRY_STATUSES = new Set([502, 503, 504]);
// A longer wait, like a day until the next send, is the caller's to decide: it gets the error at once.
const MAX_WAIT_SECONDS = 60;

function id(value: string): string {
  if (!ID.test(value)) throw new TypeError(`not an API id: ${JSON.stringify(value)}`);
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Server operations for one profile, restricted by its API key's store, mode and scopes. */
export class Forwend {
  readonly checkoutSessions: {
    create(
      body: CreateCheckoutSession,
      options?: { idempotencyKey?: string },
    ): Promise<CheckoutSession>;
    get(sessionId: string): Promise<CheckoutSession>;
    list(params?: ListCheckoutSessions): AsyncGenerator<CheckoutSession>;
    /** Refuses expiration once any payment has been seen. Repeated expiration is safe. */
    expire(sessionId: string): Promise<CheckoutSession>;
  };
  readonly payments: {
    get(paymentId: string): Promise<PaymentDetails>;
    list(params?: ListPayments): AsyncGenerator<Payment>;
  };
  readonly invoices: {
    /** Creates an invoice. The same idempotencyKey and body return the same invoice; one is made when none is given. */
    create(body: CreateInvoice, options?: { idempotencyKey?: string }): Promise<InvoiceDetails>;
    get(invoiceId: string): Promise<InvoiceDetails>;
    /** Every invoice, newest first, page after page through nextCursor. */
    list(params?: ListInvoices): AsyncGenerator<Invoice>;
    /** Cancels an invoice before any money arrives. */
    cancel(invoiceId: string): Promise<InvoiceDetails>;
    /** Reopens an invoice that closed partly paid. */
    reopen(invoiceId: string): Promise<InvoiceDetails>;
    /** Emails the invoice to its client, once a day at most. The same idempotencyKey sends nothing more. */
    send(invoiceId: string, options?: { idempotencyKey?: string }): Promise<InvoiceDetails>;
  };
  readonly stores: {
    /** The profile's stores, the first one first. */
    list(): Promise<Store[]>;
    get(storeId: string): Promise<Store>;
  };
  readonly webhookEvents: {
    /** The last 30 days of events, newest first, page after page through nextCursor. */
    list(params?: ListWebhookEvents): AsyncGenerator<WebhookEvent>;
  };

  readonly #options: ForwendOptions;

  constructor(options: ForwendOptions) {
    if (!options.apiKey) throw new TypeError("apiKey is empty");
    const base = new URL(options.baseUrl);
    // The key is a bearer secret: plain http only to this machine, for a local API.
    if (base.protocol !== "https:" && !(base.protocol === "http:" && LOOPBACK.has(base.hostname))) {
      throw new TypeError("baseUrl must be https, or http on localhost");
    }
    this.#options = options;
    const profile = `/v1/profiles/${id(options.profileId)}`;
    this.checkoutSessions = {
      create: (body, { idempotencyKey = randomUUID() } = {}) =>
        this.#request("POST", `${profile}/checkout-sessions`, {}, body, {
          "Idempotency-Key": idempotencyKey,
        }),
      get: (sessionId) => this.#request("GET", `${profile}/checkout-sessions/${id(sessionId)}`),
      list: (params = {}) => this.#pages(`${profile}/checkout-sessions`, { ...params }),
      expire: (sessionId) =>
        this.#request("POST", `${profile}/checkout-sessions/${id(sessionId)}/expire`),
    };
    this.payments = {
      get: (paymentId) => this.#request("GET", `${profile}/payments/${id(paymentId)}`),
      list: (params = {}) => this.#pages(`${profile}/payments`, { ...params }),
    };
    this.invoices = {
      create: (body, { idempotencyKey = randomUUID() } = {}) =>
        this.#request("POST", `${profile}/invoices`, {}, body, {
          "Idempotency-Key": idempotencyKey,
        }),
      get: (invoiceId) => this.#request("GET", `${profile}/invoices/${id(invoiceId)}`),
      list: (params = {}) => this.#pages(`${profile}/invoices`, { ...params }),
      cancel: (invoiceId) => this.#request("POST", `${profile}/invoices/${id(invoiceId)}/cancel`),
      reopen: (invoiceId) => this.#request("POST", `${profile}/invoices/${id(invoiceId)}/reopen`),
      send: (invoiceId, { idempotencyKey = randomUUID() } = {}) =>
        this.#request("POST", `${profile}/invoices/${id(invoiceId)}/send`, {}, undefined, {
          "Idempotency-Key": idempotencyKey,
        }),
    };
    this.stores = {
      list: async () =>
        (await this.#request<{ stores: Store[] }>("GET", `${profile}/stores`)).stores,
      get: (storeId) => this.#request("GET", `${profile}/stores/${id(storeId)}`),
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
    // A generated idempotency key stays the same on each try, so a lost answer never makes a second invoice.
    const safe = method === "GET" || "Idempotency-Key" in headers;
    const tries = (this.#options.maxRetries ?? 2) + 1;
    let response: Response;
    for (let attempt = 1; ; attempt++) {
      try {
        response = await (this.#options.fetch ?? fetch)(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.#options.apiKey}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          // A redirect would carry the key somewhere else.
          redirect: "error",
          signal: AbortSignal.timeout(this.#options.timeoutMs ?? 30_000),
        });
      } catch (error) {
        if (!safe || attempt >= tries) throw error;
        await sleep(backoff(attempt, null));
        continue;
      }
      // A rate limit refuses before the API acts, so any request may try again.
      const retryable = response.status === 429 || (safe && RETRY_STATUSES.has(response.status));
      const wait = retryAfter(response);
      if (!retryable || attempt >= tries || (wait !== null && wait > MAX_WAIT_SECONDS)) break;
      await response.body?.cancel();
      await sleep(backoff(attempt, wait));
    }
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
        retryAfter(response),
      );
    }
    return json as T;
  }
}

/** Retry-After in seconds, as the API sends it with 429 rate_limited; null without one. */
function retryAfter(response: Response): number | null {
  const value = response.headers.get("Retry-After");
  return value !== null && /^\d+$/.test(value) ? Number(value) : null;
}

function backoff(attempt: number, retryAfterSeconds: number | null): number {
  return retryAfterSeconds !== null ? retryAfterSeconds * 1000 : 500 * 2 ** (attempt - 1);
}
