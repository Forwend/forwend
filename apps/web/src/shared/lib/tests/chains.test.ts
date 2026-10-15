import { describe, expect, it } from "vitest";
import { addressLink, lookalikeOf, txLink } from "@/shared/lib/chains";

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

describe("addressLink", () => {
  it("links an address to its page on the chain's explorer", () => {
    const address = `0x${"ab".repeat(20)}`;
    expect(addressLink(84532, address)).toEqual({
      name: "Basescan",
      href: `https://sepolia.basescan.org/address/${address}`,
    });
  });
  it("gives nothing for a chain without an explorer or a value that is not an address", () => {
    expect(addressLink(1, `0x${"ab".repeat(20)}`)).toBeNull();
    expect(addressLink(84532, "0x1234")).toBeNull();
  });
});

describe("lookalikeOf", () => {
  it("names the bridged token that looks like the real one, only where there is one (R-78)", () => {
    expect(lookalikeOf(421614, "USDC")).toBe("USDC.e");
    expect(lookalikeOf(84532, "USDC")).toBeUndefined();
    expect(lookalikeOf(421614, "USDT")).toBeUndefined();
  });
});
