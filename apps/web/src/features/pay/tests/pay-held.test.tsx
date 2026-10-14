// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PayInvoice } from "@/features/pay/components/pay-invoice";
import { makeStore } from "@/store/store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/pay/x",
  notFound: () => {
    throw new Error("not found");
  },
}));

const NodeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  },
);

// The sample invoice of e2e/pay.spec.ts (its RECEIVE and OPTION_RECEIVE are the factory's addresses for these terms).
const ID = "0x7f3a9c1e5b2d4086a1c3e5f7092b4d6f8a0c2e4f6a8b0d2f4e6c8a0b2d4f6e81";
const RECEIVE = "0x586134f74b654f5835860ca198ae725344670078";
const OPTION_ID = "0x80166bc7ad9374378c99215bffabc884c9fe82e8876840816d1eb4e5710a89e7";
const OPTION_RECEIVE = "0xdb27b5da140247ca45e078798de10030638c2ba3";
const deposit = (hash: string) => ({
  txHash: `0x${hash.repeat(64)}`,
  logIndex: 0,
  from: "0x8ba1f109551bd432803012645ac136ddd64dba72",
  amount: "1250000000",
  blockNumber: 100,
  blockTime: "2026-10-10T12:04:00Z",
  status: "confirmed",
  late: false,
  blocksLeft: 0,
  blocksTotal: 0,
  secondsLeft: 0,
});
const MAIN_OPTION = {
  optionId: ID,
  chainId: 84532,
  network: "base-sepolia",
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  amount: "1250000000",
  receiveAddress: RECEIVE,
  deposits: [deposit("3")],
};
const PAID_TWICE = {
  invoiceId: ID,
  optionId: ID,
  optionLocked: true,
  optionCount: 2,
  confirming: false,
  closed: false,
  senderName: null,
  returnUrl: null,
  nextCheckAt: null,
  options: [
    MAIN_OPTION,
    {
      ...MAIN_OPTION,
      optionId: OPTION_ID,
      chainId: 421614,
      network: "arbitrum-sepolia",
      token: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
      receiveAddress: OPTION_RECEIVE,
      deposits: [deposit("5")],
    },
  ],
  number: 1,
  title: "Logo design",
  note: null,
  dueDate: null,
  issuer: {
    name: "Alice Design GmbH",
    address: "Hauptstr. 1\n10115 Berlin",
    country: "DE",
    taxId: null,
    email: "billing@alice.example",
  },
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  amount: "1250000000",
  recipient: "0x1111111111111111111111111111111111111111",
  factory: "0xece745390524e4d0b05d26f56af7f1d38fdb7546",
  receiveAddress: RECEIVE,
  expiresAt: "2026-10-17T15:00:00Z",
  settleDeadline: "2026-10-18T15:00:00Z",
  paymentStatus: "paid",
  settlementStatus: "pending",
  refundStatus: "none",
  settlementTxHash: null,
  createdAt: "2026-10-10T11:00:00Z",
  paidAt: "2026-10-10T12:05:00Z",
  settledAt: null,
  deposits: [deposit("3")],
};

vi.stubGlobal(
  "fetch",
  vi.fn(async () => Response.json(PAID_TWICE)),
);

afterEach(cleanup);

describe("pay page", () => {
  it("tells the payer that money sent on the other network is held for them", async () => {
    render(
      <Provider store={makeStore({ getAccessToken: async () => null })}>
        <PayInvoice invoiceId={ID} />
      </Provider>,
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(screen.getByText("Paid", { selector: "p" })).toBeTruthy();

    expect(document.body.textContent).toMatch(/held for you/);
  });
});
