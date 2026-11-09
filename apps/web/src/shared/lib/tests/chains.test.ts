import { describe, expect, it } from "vitest";
import {
  addressLink,
  blockchainTxLink,
  crossChainOptionRecorded,
  lookalikeOf,
  tokenMatches,
  txLink,
} from "@/shared/lib/chains";

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

describe("tokenMatches", () => {
  it("matches every word against the symbol or the network, ignoring case", () => {
    const usdc = { symbol: "USDC", chainId: 84532 };
    expect(tokenMatches(usdc, "usdc base")).toBe(true);
    expect(tokenMatches(usdc, "  sepolia ")).toBe(true);
    expect(tokenMatches(usdc, "usdt")).toBe(false);
    expect(tokenMatches(usdc, "")).toBe(true);
  });
});

// R-239: money booked first on another option pays the payment; 1Click's USDC on Base is then held.
describe("crossChainOptionRecorded", () => {
  const base = {
    optionId: "b",
    chainId: 8453,
    token: "0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913",
  };
  const arbitrum = {
    optionId: "a",
    chainId: 42161,
    token: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  };
  const options = [base, arbitrum];

  it("counts a cross-chain deposit while nothing is recorded, or once it is on the Base USDC option", () => {
    expect(crossChainOptionRecorded({ optionLocked: false, optionId: "a", options })).toBe(true);
    expect(crossChainOptionRecorded({ optionLocked: true, optionId: "b", options })).toBe(true);
  });

  it("doesn't once money on another option was recorded first", () => {
    expect(crossChainOptionRecorded({ optionLocked: true, optionId: "a", options })).toBe(false);
  });
});

// R-243: the payer's own transaction, on a chain 1Click names.
describe("blockchainTxLink", () => {
  const solana =
    "4jBcpDL3KfBipWFqRBT5gVwZZoGogMBv5FWi6hi6a45CmPg6CcPJmD5Pr8jTxJGehtDrh3vmq8Tr7Q1UU6GLxoxj";

  it("links a known explorer, else 1Click's own https link", () => {
    expect(blockchainTxLink("sol", { hash: solana, explorerUrl: "" })).toEqual({
      name: "Solscan",
      href: `https://solscan.io/tx/${solana}`,
    });
    expect(blockchainTxLink("zec", { hash: "ab", explorerUrl: "https://x.example/tx/ab" })).toEqual(
      {
        name: "Zcash",
        href: "https://x.example/tx/ab",
      },
    );
  });

  it("links nothing for a hash or a link it can't trust", () => {
    expect(blockchainTxLink("sol", { hash: "../../evil?x=1", explorerUrl: "" })).toBeNull();
    expect(blockchainTxLink("zec", { hash: "ab", explorerUrl: "javascript:alert(1)" })).toBeNull();
  });
});
