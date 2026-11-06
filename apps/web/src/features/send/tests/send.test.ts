import { describe, expect, it } from "vitest";
import {
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
    } as Parameters<typeof matchesRequest>[0];
    expect(matchesRequest(send, asked, asked.to)).toBe(true);
    expect(matchesRequest({ ...send, amount: "1000" }, asked, asked.to)).toBe(false);
    expect(matchesRequest({ ...send, to: "0xcc" }, asked, asked.to)).toBe(false);
    expect(matchesRequest({ ...send, chainId: 421614 }, asked, asked.to)).toBe(false);
    expect(matchesRequest({ ...send, token: "0xdd" }, asked, asked.to)).toBe(false);
  });
});
