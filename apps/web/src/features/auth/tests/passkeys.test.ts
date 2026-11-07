// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { PasskeyOnDevice, registering } from "@/features/auth/lib/passkeys";

const create = vi.fn(async (_?: CredentialCreationOptions): Promise<Credential | null> => null);
Object.defineProperty(navigator, "credentials", { value: { create }, configurable: true });

afterEach(() => vi.clearAllMocks());

// What Privy's create call carries, as @simplewebauthn/browser passes it on.
const privyMakesOne = () =>
  navigator.credentials.create({
    publicKey: {
      user: { id: new Uint8Array([1]), name: "Forwend", displayName: "Forwend" },
    } as unknown as PublicKeyCredentialCreationOptions,
  });

// R-217: several Forwend accounts in one password manager read apart by the email in the passkey's name.
it("names the passkey Privy makes after the account, then leaves the browser's create as it was", async () => {
  await registering("Forwend (alice@example.com)", [], privyMakesOne);
  expect(create.mock.calls[0]?.[0]?.publicKey?.user).toMatchObject({
    name: "Forwend (alice@example.com)",
    displayName: "Forwend (alice@example.com)",
  });
  expect(navigator.credentials.create).toBe(create);
});

// R-217: one passkey per account in a device or password manager; the browser refuses a second.
it("lists the account's passkeys for the browser to refuse, and says so when it does", async () => {
  create.mockRejectedValueOnce(new DOMException("already registered", "InvalidStateError"));
  await expect(registering("Forwend", ["AQID"], privyMakesOne)).rejects.toBeInstanceOf(
    PasskeyOnDevice,
  );
  const excluded = create.mock.calls[0]?.[0]?.publicKey?.excludeCredentials ?? [];
  expect(excluded.map((c) => [c.type, [...new Uint8Array(c.id as ArrayBuffer)]])).toEqual([
    ["public-key", [1, 2, 3]],
  ]);
  expect(navigator.credentials.create).toBe(create);
});
