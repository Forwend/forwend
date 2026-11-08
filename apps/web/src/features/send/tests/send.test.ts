import { describe, expect, it } from "vitest";
import {
  feeLabel,
  feeShown,
  isWalletAddress,
  matchesPrivyRequest,
  matchesRequest,
  maxAmount,
  roomForFee,
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
    // EIP-55: one case is fine; mixed case must carry the checksum.
    expect(isWalletAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed")).toBe(true);
    expect(isWalletAddress("0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359")).toBe(true);
    expect(isWalletAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD")).toBe(false);
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
  it("keeps room for the fee in Max, and offers none until the fee is known (R-216)", () => {
    expect(roomForFee(1_000_000n, 3_600n)).toBe(996_400n);
    expect(roomForFee(2_000n, 3_600n)).toBe(0n);
    expect(roomForFee(1_000_000n, 0n)).toBe(1_000_000n);
    expect(roomForFee(1_000_000n, null)).toBeNull();
  });

  it("fills Max with the exact balance, whatever the decimals", () => {
    expect(maxAmount(26_250_000n, 6)).toBe("26.25");
    expect(maxAmount(100n, 0)).toBe("100");
    expect(maxAmount(1n, 18)).toBe(`0.${"0".repeat(17)}1`);
    expect(maxAmount(5_000_000n, 6)).toBe("5");
  });

  it("refuses a prepared send that isn't the one asked for", () => {
    const asked = { chainId: 84532, token: "0xAA", amount: "100", to: "0xBb" };
    const expected = { to: asked.to, from: "0xWa", decimals: 6 };
    const send = {
      chainId: 84532,
      token: "0xaa",
      amount: "100",
      to: "0xbb",
      from: "0xwa",
      decimals: 6,
      networkFee: { amount: "0", paidBy: "forwend" },
      gas: null,
    } as Parameters<typeof matchesRequest>[0];
    expect(matchesRequest(send, asked, expected)).toBe(true);
    expect(matchesRequest({ ...send, amount: "1000" }, asked, expected)).toBe(false);
    expect(matchesRequest({ ...send, to: "0xcc" }, asked, expected)).toBe(false);
    expect(matchesRequest({ ...send, chainId: 421614 }, asked, expected)).toBe(false);
    expect(matchesRequest({ ...send, token: "0xdd" }, asked, expected)).toBe(false);
    // Privy signs from the wallet the send names, in the units the amount step used.
    expect(matchesRequest({ ...send, from: "0xee" }, asked, expected)).toBe(false);
    expect(matchesRequest({ ...send, decimals: 18 }, asked, expected)).toBe(false);
  });
});

describe("a wallet-paid send", () => {
  const asked = { chainId: 5042002, token: "0x36", amount: "10000", to: "0xbb" };
  const expected = { to: asked.to, from: "0xwa", decimals: 6 };
  // 90,000 gas at 40 gwei is 0.0036 of an 18-decimal coin: 3,600 base units of a 6-decimal token.
  const gas = { limit: "90000", maxFeePerGas: "40000000000", maxPriorityFeePerGas: "1000000000" };
  const send = {
    ...asked,
    from: "0xwa",
    decimals: 6,
    networkFee: { amount: "3600", paidBy: "wallet" },
    gas,
  } as Parameters<typeof matchesRequest>[0];

  it("is signed only when its gas caps cost at most the fee shown", () => {
    expect(matchesRequest(send, asked, expected)).toBe(true);
    const over = { ...send, gas: { ...gas, maxFeePerGas: "40000000001" } };
    expect(matchesRequest(over, asked, expected)).toBe(false);
    const tipAboveCap = { ...send, gas: { ...gas, maxPriorityFeePerGas: "50000000000" } };
    expect(matchesRequest(tipAboveCap, asked, expected)).toBe(false);
    expect(matchesRequest({ ...send, gas: null }, asked, expected)).toBe(false);
    expect(
      matchesRequest({ ...send, networkFee: { amount: "0", paidBy: "wallet" } }, asked, expected),
    ).toBe(false);
  });
});

describe("a paymaster send", () => {
  const asked = {
    chainId: 8453,
    token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amount: "2500000",
    to: "0x" + "bb".repeat(20),
  };
  const expected = { to: asked.to, from: "0x" + "aa".repeat(20), decimals: 6 };
  const send = {
    ...asked,
    sendId: "send-1",
    symbol: "USDC",
    from: expected.from,
    decimals: 6,
    networkFee: { amount: "12000", paidBy: "paymaster" },
    gas: null,
  } as Parameters<typeof matchesRequest>[0];
  const request = {
    url: "https://api.privy.io/v1/wallets/w1/rpc",
    headers: {
      "privy-app-id": "app",
      "privy-idempotency-key": "send-1",
      "privy-request-expiry": String(1_000_000 + 120_000),
    },
    body: {
      method: "eth_sendTransaction",
      caip2: "eip155:8453",
      chain_type: "ethereum",
      sponsor: true,
      sponsor_options: { asset: "usdc" },
      reference_id: "send-1",
      params: {
        transaction: {
          from: send.from,
          to: send.token,
          data: transferCalldata(send.to, 2_500_000n),
          value: "0x0",
          chain_id: "0x2105",
        },
      },
    },
  };
  const tx = request.body.params.transaction;
  const withTx = (change: Record<string, unknown>) => ({
    ...request,
    body: { ...request.body, params: { transaction: { ...tx, ...change } } },
  });

  it("has an estimated fee and no gas caps", () => {
    expect(matchesRequest(send, asked, expected)).toBe(true);
    expect(
      matchesRequest(
        { ...send, networkFee: { amount: "0", paidBy: "paymaster" } },
        asked,
        expected,
      ),
    ).toBe(false);
    const gas = { limit: "1", maxFeePerGas: "1", maxPriorityFeePerGas: "1" };
    expect(matchesRequest({ ...send, gas }, asked, expected)).toBe(false);
  });

  it("signs only a Privy request that moves what the review showed", () => {
    const now = 1_000_000;
    const matches = (s: typeof send, r: typeof request) => matchesPrivyRequest(s, r, now);
    expect(matches(send, request)).toBe(true);
    const headers = (change: Record<string, string>) => ({
      ...request,
      headers: { ...request.headers, ...change },
    });
    // Sent once, soon: a far expiry could be sent again after Privy's idempotency window.
    expect(matches(send, headers({ "privy-idempotency-key": "send-2" }))).toBe(false);
    expect(matches(send, headers({ "privy-request-expiry": String(now + 24 * 3_600_000) }))).toBe(
      false,
    );
    // A device clock a few minutes fast still signs; Privy refuses an expired request itself.
    expect(matches(send, headers({ "privy-request-expiry": String(now - 180_000) }))).toBe(true);
    expect(matches(send, headers({ "privy-extra": "1" }))).toBe(false);
    expect(matches(send, { ...request, body: { ...request.body, reference_id: "send-2" } })).toBe(
      false,
    );
    expect(matches(send, { ...request, body: { ...request.body, chain_type: "solana" } })).toBe(
      false,
    );
    expect(
      matches(send, {
        ...request,
        body: { ...request.body, sponsor_options: { asset: "usdc", extra: 1 } },
      } as unknown as typeof request),
    ).toBe(false);
    expect(
      matches(send, {
        ...request,
        body: { ...request.body, params: { transaction: tx, other: 1 } },
      } as unknown as typeof request),
    ).toBe(false);
    expect(
      matches(send, { ...request, body: { ...request.body, sponsor_options: { asset: "usdt" } } }),
    ).toBe(false);
    expect(matches(send, withTx({ data: transferCalldata(send.to, 2_500_001n) }))).toBe(false);
    expect(matches(send, withTx({ to: "0x" + "cc".repeat(20) }))).toBe(false);
    expect(matches(send, withTx({ from: "0x" + "dd".repeat(20) }))).toBe(false);
    expect(matches(send, withTx({ value: "0x1" }))).toBe(false);
    expect(matches(send, withTx({ gas: "0x1" }))).toBe(false);
    expect(
      matchesPrivyRequest(send, { ...request, body: { ...request.body, caip2: "eip155:42161" } }),
    ).toBe(false);
    expect(
      matchesPrivyRequest(send, {
        ...request,
        body: { ...request.body, method: "eth_signTransaction" },
      }),
    ).toBe(false);
    expect(
      matchesPrivyRequest(send, { ...request, body: { ...request.body, wallet_id: "other" } }),
    ).toBe(false);
    expect(
      matchesPrivyRequest(send, { ...request, url: "https://example.com/v1/wallets/w1/rpc" }),
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
