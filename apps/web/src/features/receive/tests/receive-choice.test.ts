import { describe, expect, it } from "vitest";
import { addressFor } from "@/features/receive/lib/receive-choice";

const BASE = { symbol: "USDC", network: "84532", family: "evm" };
const ARBITRUM = { symbol: "USDC", network: "421614", family: "evm" };
const TEMPO = { symbol: "OUSD", network: "42431", family: "evm" };
// A family this app does not have yet: the choice and the address lookup take it as they are.
const SOLANA = { symbol: "USDC", network: "solana-devnet", family: "solana" };
const _OPTIONS = [BASE, ARBITRUM, TEMPO, SOLANA];
const ADDRESSES = { evm: "0xabc", solana: "So1ana" };

describe("addressFor", () => {
  it("gives each chain family its own address", () => {
    expect(addressFor(BASE, ADDRESSES)).toBe("0xabc");
    expect(addressFor(ARBITRUM, ADDRESSES)).toBe("0xabc");
    expect(addressFor(SOLANA, ADDRESSES)).toBe("So1ana");
    expect(addressFor(SOLANA, { evm: "0xabc" })).toBeNull();
  });
});
