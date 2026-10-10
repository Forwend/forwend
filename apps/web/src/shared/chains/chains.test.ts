import { describe, expect, it } from "vitest";
import { txLink } from "@/shared/chains/chains";

const HASH = `0x${"ab".repeat(32)}`;

describe("txLink", () => {
  it("links a transaction to its chain's explorer", () => {
    expect(txLink(84532, HASH)).toEqual({
      name: "Basescan",
      href: `https://sepolia.basescan.org/tx/${HASH}`,
    });
    expect(txLink(421614, HASH)?.href).toBe(`https://sepolia.arbiscan.io/tx/${HASH}`);
  });

  it("gives no link for a chain without an explorer, an unknown chain or a value that is not a hash", () => {
    expect(txLink(31337, HASH)).toBeNull();
    expect(txLink(1, HASH)).toBeNull();
    expect(txLink(84532, "0x12/../evil")).toBeNull();
  });
});
