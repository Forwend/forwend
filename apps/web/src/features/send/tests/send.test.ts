import { describe, expect, it } from "vitest";
import {
  addressGroups,
  isWalletAddress,
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

  it("groups the full address in fours, leaving out nothing", () => {
    const address = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    const groups = addressGroups(address);
    expect(groups.join("")).toBe(address);
    expect(groups.slice(1).every((g) => g.length === 4)).toBe(true);
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
