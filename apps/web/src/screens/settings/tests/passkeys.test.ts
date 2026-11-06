import type { LinkedAccountWithMetadata } from "@privy-io/react-auth";
import { describe, expect, it } from "vitest";
import { canRemovePasskey, passkeysOf } from "@/screens/settings/lib/passkeys";

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

describe("passkeys (R-217)", () => {
  it("lists each passkey newest first, with where it was made", () => {
    const rows = passkeysOf([
      email,
      passkey("old", "2026-10-01T00:00:00Z", {
        createdWithBrowser: "Chrome",
        createdWithOs: "macOS",
      }),
      passkey("new", "2026-11-01T00:00:00Z", { authenticatorName: "iCloud Keychain" }),
    ]);
    expect(rows.map((r) => [r.credentialId, r.name, r.madeOn])).toEqual([
      ["new", "iCloud Keychain", null],
      ["old", null, "Chrome, macOS"],
    ]);
  });

  it("keeps the last way to sign in: a wallet is not one", () => {
    expect(canRemovePasskey([passkey("only", "2026-11-01T00:00:00Z"), wallet])).toBe(false);
    expect(canRemovePasskey([passkey("one", "2026-11-01T00:00:00Z"), email])).toBe(true);
    expect(
      canRemovePasskey([
        passkey("a", "2026-11-01T00:00:00Z"),
        passkey("b", "2026-11-02T00:00:00Z"),
      ]),
    ).toBe(true);
  });
});
