import type { Page } from "@playwright/test";

// The pay page fixture the pay and example-merchant specs share.
// ID is keccak256(PAY) (D-86). RECEIVE is factory.predict of these terms (R-15), so the page shows it
// only while every term is unchanged.
export const PAY = "7f3a9c1e5b2d4086a1c3e5f7092b4d6f8a0c2e4f6a8b0d2f4e6c8a0b2d4f6e81";
export const ID = "0x0bc3ec4e72d7b5f3cc8a059ea1a0f06cc9d24ea5e71a2acfd86fea75540e9a31";
export const RECEIVE = "0x25425f508790c1847090371590297cad428868f3";
export const NOW = new Date("2026-10-10T12:00:00Z");

export const MAIN_OPTION = {
  optionId: ID,
  chainId: 84532,
  network: "base-sepolia",
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  amount: "1250000000",
  receiveAddress: RECEIVE,
  deposits: [] as object[],
};

export const OPEN = {
  invoiceId: ID,
  payToken: PAY,
  optionId: ID,
  optionLocked: false,
  optionCount: 1,
  confirming: false,
  closed: false,
  senderName: null as string | null,
  returnUrl: null as string | null,
  nextCheckAt: null,
  updates: [],
  replacedBy: null,
  lines: [],
  options: [MAIN_OPTION],
  number: 1,
  title: "Logo design",
  note: "Thanks for the work together.",
  dueDate: "2026-11-01",
  supplyDate: null,
  reference: "PO-4500012345" as string | null,
  agreedValue: { currency: "EUR", amount: "115000", decimals: 2, date: "2026-10-09" } as
    | object
    | null,
  issuer: {
    name: "Alice Design GmbH",
    address: "Hauptstr. 1\n10115 Berlin",
    country: "DE",
    taxId: null,
    email: "billing@alice.example",
  },
  chainId: 84532,
  livemode: false,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  amount: "1250000000",
  recipient: "0x1111111111111111111111111111111111111111",
  factory: "0xece745390524e4d0b05d26f56af7f1d38fdb7546",
  receiveAddress: RECEIVE,
  expiresAt: "2026-10-17T15:00:00Z",
  closesAt: "2026-10-17T15:00:00Z",
  settleDeadline: "2026-10-18T15:00:00Z",
  paymentStatus: "open",
  settlementStatus: "none",
  refundStatus: "none",
  settlementTxHash: null,
  createdAt: "2026-10-10T11:00:00Z",
  paidAt: null as string | null,
  settledAt: null as string | null,
  canceledAt: null,
  deposits: [] as object[],
};

export async function mockInvoice(page: Page, ...bodies: object[]) {
  let call = 0;
  await page.route("**/api/v1/invoices/*", (route) =>
    route.fulfill({ json: bodies[Math.min(call++, bodies.length - 1)] }),
  );
}
