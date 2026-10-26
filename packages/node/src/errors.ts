/**
 * An error answer from the API: its HTTP status and the API's error code, such as idempotency_conflict. The client
 * sets the code to unknown for an error answer that is not JSON, and invalid_response for such a success answer.
 */
export class ForwendError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ForwendError";
    this.status = status;
    this.code = code;
  }
}

/** A webhook that did not verify: its signature, its timestamp or its headers. */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
