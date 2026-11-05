import { describe, expect, it } from "vitest";
import {
  feeLabel,
  feeShown,
  isWalletAddress,
  matchesRequest,
  maxAmount,
  sendOptions,
  transferCalldata,
} from "@/features/send/lib/send";

const token = (wallet: string | null, sendable: boolean, chainId = 84532) => ({
  chainId,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  wallet,
  finalizedBlock: 1,
  pending: "0",
  held: "0",
  sendable,
});

describe("send", () => {
  it("encodes the exact transfer the owner reviewed", () => {
    expect(transferCalldata("0x00000000000000000000000000000000000000CC", 2_500_000n)).toBe(
      `0xa9059cbb${"0".repeat(62)}cc${"0".repeat(58)}2625a0`,
    );
  });

  it("takes only a whole 0x address", () => {
    expect(isWalletAddress(" 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed ")).toBe(true);
    expect(isWalletAddress("5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(false);
    expect(isWalletAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe")).toBe(false);
  });

  it("offers only money the wallet holds, sendable networks first", () => {
    const options = sendOptions({
      tokens: [
        token("5", false, 5042002),
        token("0", true),
        token(null, true),
        token("7", true, 421614),
      ],
      estimatedUsdTotal: null,
    });
    expect(options.map((o) => [o.chainId, o.balance, o.sendable])).toEqual([
      [421614, 7n, true],
      [5042002, 5n, false],
    ]);
  });
});

describe("max and the server's answer", () => {
  it("fills Max with the exact balance, whatever the decimals", () => {
    expect(maxAmount(26_250_000n, 6)).toBe("26.25");
    expect(maxAmount(100n, 0)).toBe("100");
    expect(maxAmount(1n, 18)).toBe(`0.${"0".repeat(17)}1`);
    expect(maxAmount(5_000_000n, 6)).toBe("5");
  });

  it("refuses a prepared send that isn't the one asked for", () => {
    const asked = { chainId: 84532, token: "0xAA", amount: "100", to: "0xBb" };
    const send = {
      chainId: 84532,
      token: "0xaa",
      amount: "100",
      to: "0xbb",
      decimals: 6,
      networkFee: { amount: "0", paidBy: "forwend" },
      gas: null,
    } as Parameters<typeof matchesRequest>[0];
    expect(matchesRequest(send, asked, asked.to)).toBe(true);
    expect(matchesRequest({ ...send, amount: "1000" }, asked, asked.to)).toBe(false);
    expect(matchesRequest({ ...send, to: "0xcc" }, asked, asked.to)).toBe(false);
    expect(matchesRequest({ ...send, chainId: 421614 }, asked, asked.to)).toBe(false);
    expect(matchesRequest({ ...send, token: "0xdd" }, asked, asked.to)).toBe(false);
  });
});

describe("a wallet-paid send", () => {
  const asked = { chainId: 5042002, token: "0x36", amount: "10000", to: "0xbb" };
  // 90,000 gas at 40 gwei is 0.0036 of an 18-decimal coin: 3,600 base units of a 6-decimal token.
  const gas = { limit: "90000", maxFeePerGas: "40000000000", maxPriorityFeePerGas: "1000000000" };
  const send = {
    ...asked,
    decimals: 6,
    networkFee: { amount: "3600", paidBy: "wallet" },
    gas,
  } as Parameters<typeof matchesRequest>[0];

  it("is signed only when its gas caps cost at most the fee shown", () => {
    expect(matchesRequest(send, asked, asked.to)).toBe(true);
    const over = { ...send, gas: { ...gas, maxFeePerGas: "40000000001" } };
    expect(matchesRequest(over, asked, asked.to)).toBe(false);
    const tipAboveCap = { ...send, gas: { ...gas, maxPriorityFeePerGas: "50000000000" } };
    expect(matchesRequest(tipAboveCap, asked, asked.to)).toBe(false);
    expect(matchesRequest({ ...send, gas: null }, asked, asked.to)).toBe(false);
    expect(
      matchesRequest({ ...send, networkFee: { amount: "0", paidBy: "wallet" } }, asked, asked.to),
    ).toBe(false);
  });
});

describe("the fee shown", () => {
  it("rounds an estimate up to 4 decimals, never below what the wallet can pay", () => {
    expect(feeShown(2_067n, 6)).toBe(2_100n);
    expect(feeShown(2_100n, 6)).toBe(2_100n);
    expect(feeShown(1n, 6)).toBe(100n);
  });

  it("reads Free where Forwend pays, else ≈ the estimate", () => {
    const usdc = { decimals: 6, symbol: "USDC" };
    expect(feeLabel(0n, usdc)).toBe("Free");
    expect(feeLabel(2_067n, usdc)).toBe("≈ 0.0021 USDC");
  });
});
