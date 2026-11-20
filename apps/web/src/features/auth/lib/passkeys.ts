import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { needsFreshSignIn } from "@/shared/api/fresh-sign-in";

export class PasskeyOnDevice extends Error {
  constructor() {
    super(AUTH_COPY.passkeyOnDevice);
  }
}

/** Empty when the owner gave up the confirm. */
export function addPasskeyError(error: unknown, failed: string): string {
  if (needsFreshSignIn(error)) return "";
  return error instanceof PasskeyOnDevice ? error.message : failed;
}

/** Names the passkey Privy makes and excludes the account's others; answers its ID. */
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
      // WebAuthn's answer when the authenticator holds an excluded passkey.
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

/** Two-step must turn on only a passkey the owner taps here, never one a stolen session linked. */
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

/** Best effort: asks the password manager to drop an unlinked passkey. */
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
