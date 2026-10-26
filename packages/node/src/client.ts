import { randomUUID } from "node:crypto";
import { ForwendError } from "./errors.js";
import type {
  CreateInvoice,
  Invoice,
  ListInvoices,
  ListWebhookEvents,
  WebhookEvent,
} from "./types.js";

export interface ForwendOptions {
  /** A secret API key. Keep it on the server, never in a web page or an app. */
  apiKey: string;
  /** The profile the key was made for. */
  profileId: string;
  /** The API's origin, such as https://api.example.com. */
  baseUrl: string;
  /** Another fetch, for tests or another runtime; the global one by default. */
  fetch?: typeof fetch;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

type Query = Record<string, string | number | undefined>;

/** A client for one profile's invoices and webhook events. */
export class Forwend {
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
    const url = new URL(path, this.#options.baseUrl);
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
