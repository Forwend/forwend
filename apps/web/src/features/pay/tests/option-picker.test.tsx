import { describe, expect, it } from "vitest";
import type { InvoiceOption } from "@/features/invoices/types/invoices";
import { onlyOptionOn } from "@/features/pay/components/option-picker";

const option = (optionId: string, chainId: number, symbol: string): InvoiceOption => ({
  optionId,
  chainId,
  network: "",
  token: `0x${"1".repeat(40)}`,
  symbol,
  decimals: 6,
  amount: "1000000",
  receiveAddress: `0x${"2".repeat(40)}`,
  deposits: [],
});
const OPTIONS = [
  option("base-usdc", 84532, "USDC"),
  option("base-eurc", 84532, "EURC"),
  option("arb-usdc", 421614, "USDC"),
];

describe("onlyOptionOn", () => {
  it("picks a network's only token, and waits for the token where there are several", () => {
    expect(onlyOptionOn(OPTIONS, 421614)).toBe("arb-usdc");
    expect(onlyOptionOn(OPTIONS, 84532)).toBeUndefined();
    expect(onlyOptionOn(OPTIONS, 1)).toBeUndefined();
  });
});
