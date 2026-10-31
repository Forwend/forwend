import { Forwend } from "forwend";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: copy .env.example to .env`);
  return value;
}

let client: Forwend | undefined;

/** The API client. Its key stays on this server, never in a page. */
export function forwend(): Forwend {
  client ??= new Forwend({
    apiKey: env("FORWEND_API_KEY"),
    profileId: env("FORWEND_PROFILE_ID"),
    baseUrl: env("FORWEND_API_URL"),
  });
  return client;
}

export const storeId = () => env("FORWEND_STORE_ID");
export const webhookSecret = () => env("FORWEND_WEBHOOK_SECRET");
/** Forwend's web app, which the embeds frame. */
export const forwendUrl = () => env("FORWEND_URL");
