import { describe, expect, it } from "vitest";
import { addressFor, receiveChoice } from "@/features/receive/receive-choice";

const BASE = { symbol: "USDC", network: "84532", family: "evm" };
const ARBITRUM = { symbol: "USDC", network: "421614", family: "evm" };
const TEMPO = { symbol: "OUSD", network: "42431", family: "evm" };
// A family this app does not have yet: the choice and the address lookup take it as they are.
const SOLANA = { symbol: "USDC", network: "solana-devnet", family: "solana" };
const OPTIONS = [BASE, ARBITRUM, TEMPO, SOLANA];
const ADDRESSES = { evm: "0xabc", solana: "So1ana" };

describe("receiveChoice", () => {
  it("asks for the token first, then the network", () => {
    expect(receiveChoice(OPTIONS, null, null)).toEqual({
      symbols: ["USDC", "OUSD"],
      symbol: null,
      networks: [],
      option: null,
    });
    const usdc = receiveChoice(OPTIONS, "USDC", null);
    expect(usdc.networks.map((o) => o.network)).toEqual(["84532", "421614", "solana-devnet"]);
    expect(usdc.option).toBeNull();
    expect(receiveChoice(OPTIONS, "USDC", "solana-devnet").option).toBe(SOLANA);
  });

  it("picks what has only one choice", () => {
    expect(receiveChoice(OPTIONS, "OUSD", null).option).toBe(TEMPO);
    expect(receiveChoice([SOLANA], null, null)).toMatchObject({
      symbol: "USDC",
      option: SOLANA,
    });
  });

  it("drops a network that does not carry the token", () => {
    expect(receiveChoice(OPTIONS, "OUSD", "84532").option).toBe(TEMPO);
    expect(receiveChoice(OPTIONS, "USDC", "42431").option).toBeNull();
  });
});

describe("addressFor", () => {
  it("gives each chain family its own address", () => {
    expect(addressFor(BASE, ADDRESSES)).toBe("0xabc");
    expect(addressFor(ARBITRUM, ADDRESSES)).toBe("0xabc");
    expect(addressFor(SOLANA, ADDRESSES)).toBe("So1ana");
    expect(addressFor(SOLANA, { evm: "0xabc" })).toBeNull();
  });
});
