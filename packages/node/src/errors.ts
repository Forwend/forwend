/** An API error answer; code is unknown, or invalid_response, when the body is not JSON. */
export class ForwendError extends Error {
  readonly status: number;
  readonly code: string;
  /** Seconds to wait before trying again, from Retry-After; null without one. */
  readonly retryAfter: number | null;

  constructor(status: number, code: string, message: string, retryAfter: number | null = null) {
    super(message);
    this.name = "ForwendError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** A webhook that did not verify: its signature, its timestamp or its headers. */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
