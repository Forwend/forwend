import { AUTH_COPY } from "@/features/auth/constants/auth-copy";

/** The device or password manager holds a passkey for this account already; its message says so. */
export class PasskeyOnDevice extends Error {
  constructor() {
    super(AUTH_COPY.passkeyOnDevice);
  }
}

/** Privy fixes every registration option but hints, so Forwend sets two on the browser's own create call while Privy
 * makes the passkey; the server checks the passkey, never these. The name a password manager lists it under, so two
 * Forwend accounts in one manager read apart. And the account's passkeys, so the browser refuses a second one where
 * one already is (PasskeyOnDevice). Answers the new passkey's credential ID. */
export async function registering(
  name: string,
  existing: string[],
  link: () => Promise<unknown>,
): Promise<string | null> {
  const credentials = navigator.credentials;
  // Outside a secure context there are no passkeys: Privy's own error says so.
  if (!credentials) {
    await link();
    return null;
  }
  const create = credentials.create;
  let onDevice = false;
  let made = null as string | null;
  credentials.create = async (options) => {
    const key = options?.publicKey;
    if (key) {
      key.user.name = name;
      key.user.displayName = name;
      key.excludeCredentials = [
        ...(key.excludeCredentials ?? []),
        ...existing.map((id) => ({ type: "public-key" as const, id: fromBase64Url(id) })),
      ];
    }
    try {
      const credential = await create.call(credentials, options);
      made = credential?.id ?? null;
      return credential;
    } catch (e) {
      // WebAuthn's answer when the authenticator holds one of the excluded passkeys.
      onDevice = e instanceof DOMException && e.name === "InvalidStateError";
      throw e;
    }
  };
  try {
    await link();
    return made;
  } catch (e) {
    throw onDevice ? new PasskeyOnDevice() : e;
  } finally {
    credentials.create = create;
  }
}

/** Which of the account's passkeys the owner holds here, by a tap. Two-step turns on only that one: a passkey linked
 * somewhere else, by a stolen session too, would answer Privy's two-step for whoever holds it (D-49). The browser only
 * picks the passkey, so the challenge is never checked; the record behind a fresh sign-in is what Forwend trusts. */
export async function tappedPasskey(ids: string[]): Promise<string> {
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: ids.map((id) => ({ type: "public-key", id: fromBase64Url(id) })),
      userVerification: "required",
    },
  });
  if (!credential || !ids.includes(credential.id))
    throw new Error("not one of the account's passkeys");
  return credential.id;
}

type Signals = {
  signalUnknownCredential?: (credential: { rpId: string; credentialId: string }) => Promise<void>;
};

/** Tells the password manager a passkey Privy unlinked is gone, so it drops it too and sign-in stops offering it
 * (WebAuthn's signal API). A browser without it, or one that refuses, keeps the passkey until the user deletes it. */
export function forgetOnDevice(credentialId: string): void {
  const signal = (globalThis.PublicKeyCredential as Signals | undefined)?.signalUnknownCredential;
  void signal
    ?.call(globalThis.PublicKeyCredential, { rpId: location.hostname, credentialId })
    .catch(() => undefined);
}

function fromBase64Url(id: string): Uint8Array<ArrayBuffer> {
  const base64 = id
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(id.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
