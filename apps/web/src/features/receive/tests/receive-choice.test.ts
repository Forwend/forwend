import { describe, expect, it } from "vitest";
import { addressFor } from "@/features/receive/lib/receive-choice";

const BASE = { symbol: "USDC", network: "84532", family: "evm" };
const ARBITRUM = { symbol: "USDC", network: "421614", family: "evm" };
// A family this app does not have yet: the address lookup takes it as it is.
const SOLANA = { symbol: "USDC", network: "solana-devnet", family: "solana" };
const ADDRESSES = { evm: "0xabc", solana: "So1ana" };

describe("addressFor", () => {
  it("gives each chain family its own address", () => {
    expect(addressFor(BASE, ADDRESSES)).toBe("0xabc");
    expect(addressFor(ARBITRUM, ADDRESSES)).toBe("0xabc");
    expect(addressFor(SOLANA, ADDRESSES)).toBe("So1ana");
    expect(addressFor(SOLANA, { evm: "0xabc" })).toBeNull();
  });
});
