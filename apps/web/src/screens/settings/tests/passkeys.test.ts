import type { LinkedAccountWithMetadata } from "@privy-io/react-auth";
import { describe, expect, it } from "vitest";
import { canRemovePasskey } from "@/screens/settings/lib/passkeys";

const passkey = (id: string, added: string, extra: object = {}) =>
  ({
    type: "passkey",
    credentialId: id,
    enrolledInMfa: false,
    firstVerifiedAt: new Date(added),
    latestVerifiedAt: new Date(added),
    ...extra,
  }) as unknown as LinkedAccountWithMetadata;
const email = {
  type: "email",
  address: "owner@example.com",
  firstVerifiedAt: null,
  latestVerifiedAt: null,
} as unknown as LinkedAccountWithMetadata;
const wallet = { type: "wallet", address: "0x11" } as unknown as LinkedAccountWithMetadata;
const google = {
  type: "google_oauth",
  email: "owner@gmail.com",
} as unknown as LinkedAccountWithMetadata;

describe("passkeys", () => {
  it("keeps the last way to sign in: email and Google are ways, a wallet is not", () => {
    expect(canRemovePasskey([passkey("only", "2026-11-01T00:00:00Z"), wallet])).toBe(false);
    expect(canRemovePasskey([passkey("one", "2026-11-01T00:00:00Z"), email])).toBe(true);
    expect(canRemovePasskey([passkey("one", "2026-11-01T00:00:00Z"), google])).toBe(true);
    expect(
      canRemovePasskey([
        passkey("a", "2026-11-01T00:00:00Z"),
        passkey("b", "2026-11-02T00:00:00Z"),
      ]),
    ).toBe(true);
  });
});
