// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Deposit, Invoice } from "@/features/invoices/types/invoices";
import { useLastSteps } from "@/features/pay/components/pay-progress";
import { PAY_STATES } from "@/features/pay/constants/pay";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";
import { FACTORY } from "@/features/pay/constants/receive-address";
import {
  clockRuns,
  firstPaymentOption,
  overpaid,
  payerNoticeOptions,
  payFinal,
  payState,
  payToken,
  receiptDeposits,
  seenInFull,
  withOption,
} from "@/features/pay/lib/pay";

const invoice: Invoice = {
  invoiceId: `0x${"1".repeat(64)}`,
  payToken: "2".repeat(64),
  optionId: `0x${"1".repeat(64)}`,
  optionLocked: false,
  optionCount: 1,
  confirming: false,
  closed: false,
  nextCheckAt: null,
  updates: [],
  replacedBy: null,
  lines: [],
  options: [],
  number: 1,
  title: null,
  note: null,
  dueDate: null,
  supplyDate: null,
  reference: null,
  agreedValue: null,
  issuer: null,
  senderName: null,
  returnUrl: null,
  chainId: 84532,
  livemode: false,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  amount: "1000",
  networkFee: "0",
  platformFee: "0",
  feesPaidBy: "owner",
  purpose: "invoice",
  documentKind: "invoice",
  recipient: `0x${"4".repeat(40)}`,
  factory: `0x${FACTORY}`,
  receiveAddress: `0x${"2".repeat(40)}`,
  expiresAt: "2026-10-17T10:00:00Z",
  closesAt: "2026-10-17T10:00:00Z",
  settleDeadline: "2026-10-18T10:00:00Z",
  paymentStatus: "open",
  settlementStatus: "none",
  settlementTxHash: null,
  createdAt: "2026-10-10T10:00:00Z",
  paidAt: null,
  settledAt: null,
  canceledAt: null,
  deposits: [],
};
const deposit = (amount: string, extra: Partial<Deposit> = {}): Deposit => ({
  txHash: `0x${"3".repeat(64)}`,
  logIndex: 0,
  from: `0x${"5".repeat(40)}`,
  amount,
  blockNumber: 100,
  blockTime: "2026-10-10T12:00:00Z",
  status: "confirmed",
  late: false,
  paid: amount,
  blocksLeft: 0,
  blocksTotal: 0,
  secondsLeft: 0,
  ...extra,
});
const before = Date.parse("2026-10-12T10:00:00Z");
const after = Date.parse("2026-10-17T10:00:00Z");

describe("payState", () => {
  it("uses exact deposit totals when only a preview is loaded", () => {
    const preview = {
      ...invoice,
      deposits: [deposit("1", { paid: null })],
      depositSummary: { count: 200, onTimeAmount: "900", lateAmount: "40", pendingAmount: "900" },
    };
    expect(payState(preview, before)).toMatchObject({ received: 900n, remaining: 100n, late: 40n });
    const amounts = {
      receiver: "940",
      payable: "200",
      held: "40",
      settled: "0",
      refunded: "0",
      observedRefunded: "0",
      lastReturnTxHash: null,
      unreconciled: false,
    };
    expect(
      payState(
        {
          ...preview,
          amounts,
          depositSummary: { ...preview.depositSummary, pendingAmount: "700" },
        },
        before,
      ),
    ).toMatchObject({ received: 900n, remaining: 100n, late: 40n });
  });

  it("shows a delay for an old uncredited transfer without calling it paid", () => {
    const paid = deposit("1000", { paid: null, blockTime: "2026-10-12T09:50:00Z" });
    expect(payState({ ...invoice, deposits: [paid] }, before)).toMatchObject({
      state: PAY_STATES.checking,
      delayed: true,
      canSend: false,
    });
    expect(
      payState({ ...invoice, deposits: [{ ...paid, blockTime: "2026-10-12T09:59:00Z" }] }, before),
    ).toMatchObject({ state: PAY_STATES.checking, delayed: false, canSend: false });
  });
  it("keeps the clock while money is checked, even after the close, and stops it once the payment is final", () => {
    const checked = deposit("1000", { paid: null, blockTime: "2026-10-12T09:58:00Z" });
    expect(clockRuns({ ...invoice, closed: true, deposits: [checked] })).toBe(true);
    expect(clockRuns(invoice)).toBe(true);
    expect(clockRuns({ ...invoice, closed: true })).toBe(false);
    expect(clockRuns({ ...invoice, paymentStatus: "paid" })).toBe(false);
  });
  it("keeps an unpaid checkout usable while historical evidence is pending, without accepting an unverified payment", () => {
    const amounts = {
      receiver: "0",
      payable: "0",
      held: "0",
      settled: "0",
      refunded: "0",
      observedRefunded: "0",
      lastReturnTxHash: null,
      unreconciled: true,
      hasPolicyException: false,
      reconciliationStatus: "pending" as const,
    };
    expect(payState({ ...invoice, amounts }, before)).toMatchObject({
      state: PAY_STATES.waiting,
      canSend: true,
    });
    expect(
      payState({ ...invoice, amounts, deposits: [deposit("1000", { paid: null })] }, before),
    ).toMatchObject({ state: PAY_STATES.checking, canSend: false });
    expect(
      payState(
        {
          ...invoice,
          paymentStatus: "canceled",
          amounts,
          deposits: [deposit("1000", { paid: null })],
        },
        before,
      ),
    ).toMatchObject({ state: PAY_STATES.canceled, canSend: false });
    expect(
      payState({ ...invoice, amounts: { ...amounts, reconciliationStatus: "review" } }, before),
    ).toMatchObject({ state: PAY_STATES.review, canSend: false });
  });
  it("lets the payer send only while the checkout is open and money is still owed", () => {
    expect(payState(invoice, before)).toMatchObject({ state: PAY_STATES.waiting, canSend: true });
    expect(payState(invoice, after)).toMatchObject({ state: PAY_STATES.closed, canSend: false });
    const fiveMinutesBefore = Date.parse(invoice.closesAt) - 5 * 60_000;
    expect(payState(invoice, fiveMinutesBefore - 1).canSend).toBe(true);
    expect(payState(invoice, fiveMinutesBefore)).toMatchObject({
      state: PAY_STATES.closed,
      canSend: false,
    });
    const partial = { ...invoice, paymentStatus: "partially_paid", deposits: [deposit("400")] };
    expect(payState(partial, before)).toMatchObject({
      state: PAY_STATES.partial,
      canSend: true,
      received: 400n,
      remaining: 600n,
    });
    expect(payState(partial, after)).toMatchObject({
      state: PAY_STATES.closedPartial,
      canSend: false,
    });
    const full = { ...invoice, paymentStatus: "detected", deposits: [deposit("1000")] };
    expect(payState(full, before)).toMatchObject({ state: PAY_STATES.checking, canSend: false });
  });

  // R-130: the terms' expiry has passed, but the reopened checkout takes money until its new close.
  it("keeps net received money visible during the protective close before expiry is booked", () => {
    const amounts = {
      receiver: "400",
      payable: "400",
      held: "0",
      settled: "0",
      refunded: "0",
      observedRefunded: "0",
      lastReturnTxHash: null,
      unreconciled: false,
      hasPolicyException: false,
    };
    const partial = {
      ...invoice,
      paymentStatus: "partially_paid",
      deposits: [deposit("400")],
      amounts,
    };
    expect(payState(partial, Date.parse(invoice.closesAt) - 60_000)).toMatchObject({
      received: 400n,
      canSend: false,
      state: PAY_STATES.closing,
    });
    expect(payState({ ...partial, closed: true }, after)).toMatchObject({
      received: 400n,
      canSend: false,
      state: PAY_STATES.closing,
    });
    expect(
      payState(
        {
          ...partial,
          paymentStatus: "expired_partially_paid",
          amounts: { ...amounts, payable: "0", held: "400" },
        },
        after,
      ),
    ).toMatchObject({ received: 400n, canSend: false, state: PAY_STATES.closedPartial });
  });

  it("takes payments until a reopened invoice's new close", () => {
    const reopened = {
      ...invoice,
      closesAt: "2026-10-23T10:00:00Z",
      paymentStatus: "partially_paid",
      deposits: [deposit("400"), deposit("100")],
    };
    expect(payState(reopened, after)).toMatchObject({
      state: PAY_STATES.partial,
      canSend: true,
      received: 500n,
      remaining: 500n,
    });
    expect(payState(reopened, Date.parse(reopened.closesAt))).toMatchObject({
      state: PAY_STATES.closedPartial,
      canSend: false,
    });
  });

  it("confirms while a deposit is not final, and counts only the API as paid", () => {
    const seen = {
      ...invoice,
      paymentStatus: "detected",
      deposits: [deposit("1000", { status: "detected" })],
    };
    expect(payState(seen, before)).toMatchObject({ state: PAY_STATES.confirming, canSend: false });
    expect(payState({ ...seen, paymentStatus: "paid" }, before).state).toBe(PAY_STATES.paid);
    expect(
      payState({ ...seen, paymentStatus: "paid", settlementStatus: "settled" }, before).state,
    ).toBe(PAY_STATES.settled);
  });

  it("takes nothing once canceled, and holds whatever still arrives (R-79)", () => {
    const canceled = { ...invoice, paymentStatus: "canceled", canceledAt: "2026-10-10T10:05:00Z" };
    expect(payState(canceled, before)).toMatchObject({
      state: PAY_STATES.canceled,
      canSend: false,
    });
    const sent = { ...canceled, deposits: [deposit("1000")] };
    expect(payState(sent, before)).toMatchObject({
      state: PAY_STATES.canceled,
      canSend: false,
      received: 1000n,
    });
  });

  it("holds what was sent too late", () => {
    const over = {
      ...invoice,
      paymentStatus: "paid",
      deposits: [deposit("1000"), deposit("250", { logIndex: 1 }), deposit("70", { late: true })],
    };
    expect(payState(over, after)).toMatchObject({ received: 1250n, late: 70n });
  });
});

describe("payFinal", () => {
  it("stops asking once settled, or closed for good with nothing still confirming", () => {
    expect(payFinal(invoice)).toBe(false);
    expect(payFinal({ ...invoice, paymentStatus: "paid" })).toBe(false);
    expect(payFinal({ ...invoice, paymentStatus: "paid", settlementStatus: "settled" })).toBe(true);
    for (const paymentStatus of ["expired", "expired_partially_paid", "canceled"]) {
      expect(payFinal({ ...invoice, paymentStatus }), paymentStatus).toBe(true);
    }
    const expired = { ...invoice, paymentStatus: "expired" };
    expect(payFinal({ ...expired, confirming: true })).toBe(false);
    expect(
      payFinal({ ...expired, deposits: [deposit("1000", { status: "detected", late: true })] }),
    ).toBe(false);
    expect(payFinal({ ...expired, deposits: [deposit("1000", { late: true })] })).toBe(true);
    // A cross-chain payment 1Click still converts can yet arrive.
    const crossChain = (status: string) => ({ status }) as Invoice["crossChain"];
    for (const status of [
      "PENDING_DEPOSIT",
      "KNOWN_DEPOSIT_TX",
      "PROCESSING",
      "INCOMPLETE_DEPOSIT",
      "SUCCESS",
    ]) {
      expect(payFinal({ ...expired, crossChain: crossChain(status) }), status).toBe(false);
    }
    expect(payFinal({ ...expired, crossChain: crossChain("REFUNDED") })).toBe(true);
  });
});

describe("receiptDeposits", () => {
  it("names only the payments that paid the creator (R-121)", () => {
    const paid = deposit("1000");
    const over = deposit("300", { logIndex: 3, paid: "200" });
    const settled = {
      ...invoice,
      paymentStatus: "paid",
      settlementStatus: "settled",
      deposits: [
        paid,
        deposit("70", { logIndex: 1, late: true, paid: "0" }),
        deposit("5", { logIndex: 2, status: "detected", paid: null }),
        over,
        deposit("400", { logIndex: 4, paid: "0" }),
      ],
    };
    expect(receiptDeposits(settled)).toEqual([paid, over]);
  });
});

describe("withOption", () => {
  const base = {
    network: "arbitrum-sepolia",
    token: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
    symbol: "USDC",
    decimals: 6,
    amount: "1000",
    networkFee: "0",
    platformFee: "0",
    feesPaidBy: "owner" as const,
    deposits: [],
  };
  const choosing: Invoice = {
    ...invoice,
    options: [
      {
        ...base,
        optionId: invoice.invoiceId,
        chainId: 84532,
        receiveAddress: invoice.receiveAddress,
      },
      {
        ...base,
        optionId: `0x${"9".repeat(64)}`,
        chainId: 421614,
        receiveAddress: `0x${"8".repeat(40)}`,
      },
    ],
  };

  it("lets no deposit under a tenth of the amount (at most 1 USD) choose an option, and the first to reach it does", () => {
    const [main, other] = choosing.options;
    if (!main || !other) throw new Error("Missing fixture option");
    const big = { ...choosing, amount: "5000000" };
    const options = (mainDeposits: Deposit[], otherDeposits: Deposit[]) => ({
      ...big,
      options: [
        { ...main, amount: "5000000", deposits: mainDeposits },
        { ...other, amount: "5000000", deposits: otherDeposits },
      ],
    });
    const dust = deposit("10000", { blockTime: "2026-10-10T11:00:00Z" });
    expect(firstPaymentOption(options([dust], []))).toBeUndefined();
    expect(firstPaymentOption(options([dust], [deposit("5000000")]))?.optionId).toBe(
      other.optionId,
    );
    const parts = [deposit("300000"), deposit("300000", { logIndex: 1 })]; // 0.60 of 5.00: past its tenth
    expect(firstPaymentOption(options(parts, []))?.optionId).toBe(main.optionId);
    // A 1.00 USD invoice: a first part short of the whole amount already chooses its option.
    const small = {
      ...choosing,
      amount: "1000000",
      options: [
        { ...main, amount: "1000000", deposits: [] },
        { ...other, amount: "1000000", deposits: [deposit("999973")] },
      ],
    };
    expect(firstPaymentOption(small)?.optionId).toBe(other.optionId);
  });

  it("uses the selected option's totals instead of the main option's preview", () => {
    const main = choosing.options[0];
    const option = choosing.options[1];
    if (!option || !main) throw new Error("Missing fixture option");
    const summary = { count: 200, onTimeAmount: "700", lateAmount: "20", pendingAmount: "700" };
    const selected = withOption(
      {
        ...choosing,
        depositSummary: {
          count: 300,
          onTimeAmount: "1000",
          lateAmount: "0",
          pendingAmount: "1000",
        },
        options: [
          main,
          { ...option, depositSummary: summary, deposits: [deposit("1", { paid: null })] },
        ],
      },
      option.optionId,
    );
    expect(selected.depositSummary).toEqual(summary);
    expect(payState(selected, before)).toMatchObject({
      received: 700n,
      remaining: 300n,
      late: 20n,
    });
  });

  it("shows the option the link asks for while none has money", () => {
    expect(withOption(choosing, `0x${"9".repeat(64)}`)).toMatchObject({
      invoiceId: invoice.invoiceId,
      optionId: `0x${"9".repeat(64)}`,
      chainId: 421614,
      token: base.token,
      receiveAddress: `0x${"8".repeat(40)}`,
    });
  });

  it("uses each option's own effective close in both directions", () => {
    for (const shortFirst of [true, false]) {
      const closes: [string, string] = ["2026-10-11T10:00:00Z", "2026-10-17T10:00:00Z"];
      if (!shortFirst) closes.reverse();
      const current = {
        ...choosing,
        closesAt: "2026-10-17T10:00:00Z",
        options: choosing.options.map((option, i) => ({
          ...option,
          closesAt: closes[i === 0 ? 0 : 1],
        })),
      };
      current.options.forEach((option) => {
        const shown = withOption(current, option.optionId);
        expect(shown.closesAt).toBe(option.closesAt);
        expect(payState(shown, before).canSend).toBe(Date.parse(option.closesAt) > before);
      });
    }
  });

  it("waits for the canonical option before inviting a provisional partial top-up", () => {
    const provisional = {
      ...choosing,
      optionCount: 2,
      options: choosing.options.map((option, i) => ({
        ...option,
        deposits: i === 1 ? [deposit("1000", { status: "detected", paid: null })] : [],
      })),
    };
    const shown = withOption(provisional, choosing.options[0]?.optionId);
    expect(shown.optionId).toBe(provisional.options[1]?.optionId);
    // Still confirming on chain: the payer sees its blocks and time left (R-73), and can't send more yet.
    expect(payState(shown, before)).toMatchObject({ canSend: false, state: PAY_STATES.confirming });
    // Final on chain, the option not yet chosen: awaiting confirmation, no blocks left to count.
    const final = { ...shown, deposits: [deposit("1000", { paid: null })] };
    expect(payState(final, before)).toMatchObject({ canSend: false, state: PAY_STATES.checking });
    const canonical = {
      ...provisional,
      optionLocked: true,
      paymentStatus: "paid",
      deposits: [deposit("1000")],
    };
    expect(withOption(canonical, provisional.options[1]?.optionId).optionId).toBe(invoice.optionId);
    expect(payState(canonical, before)).toMatchObject({ canSend: false, state: PAY_STATES.paid });
  });

  it("keeps the API's option once one has money, or for an id it does not list", () => {
    expect(withOption({ ...choosing, optionLocked: true }, `0x${"9".repeat(64)}`).chainId).toBe(
      84532,
    );
    expect(withOption(choosing, `0x${"7".repeat(64)}`)).toBe(choosing);
    expect(withOption(choosing, undefined)).toBe(choosing);
  });
});

describe("payToken", () => {
  it("names OUSD on Tempo and refuses a token this build does not know", () => {
    const tempo = {
      ...invoice,
      chainId: 42431,
      token: "0x20C0000000000000000000006A37DA5C996874BE",
    };
    expect(payToken(tempo)).toEqual({ symbol: "OUSD", decimals: 6 });
    expect(payToken({ ...tempo, chainId: 84532 })).toBeNull();
  });
});

it("formats public return notices with build-owned token metadata and rejects unknown chain-contract pairs", () => {
  const option: Invoice["options"][number] = {
    optionId: invoice.invoiceId,
    chainId: invoice.chainId,
    token: invoice.token,
    symbol: "FAKE",
    decimals: 18,
    amount: invoice.amount,
    networkFee: "0",
    platformFee: "0",
    feesPaidBy: "owner",
    receiveAddress: invoice.receiveAddress,
    network: "base-sepolia",
    deposits: [],
  };
  const trusted = payerNoticeOptions([option]);
  expect(trusted[0]).toMatchObject({ symbol: "USDC", decimals: 6, amount: invoice.amount });
  expect(payerNoticeOptions([{ ...option, chainId: 999999 }])).toEqual([]);
});

describe("overpaid", () => {
  const booked = {
    reconciliationStatus: "verified",
    receiver: "0",
    payable: "1000",
    held: "900",
    settled: "0",
    refunded: "0",
    observedRefunded: "0",
    lastReturnTxHash: null,
    unreconciled: false,
    hasPolicyException: false,
  } as unknown as NonNullable<Invoice["amounts"]>;
  const paid = { ...invoice, deposits: [deposit("1900")] };
  it("is the extra on time, until the ledger books it", () => {
    expect(overpaid(paid)).toBe(900n);
    expect(overpaid({ ...paid, amounts: booked })).toBe(900n);
  });
  it("is nothing once the held money went back to the payer", () => {
    expect(overpaid({ ...paid, amounts: { ...booked, held: "0", refunded: "900" } })).toBe(0n);
  });
  it("leaves late money to its own line", () => {
    const late = { ...paid, deposits: [deposit("1900"), deposit("500", { late: true })] };
    expect(overpaid({ ...late, amounts: { ...booked, held: "1400" } })).toBe(900n);
    // A return of 1000 leaves 400: the late line takes it first, as payState caps late at held.
    expect(overpaid({ ...late, amounts: { ...booked, held: "400" } })).toBe(0n);
  });
});

describe("seenInFull", () => {
  it("counts only money that came on time, so held late money never reads as paid", () => {
    expect(seenInFull({ ...invoice, deposits: [deposit("1000", { paid: null })] })).toBe(true);
    expect(seenInFull({ ...invoice, deposits: [deposit("999")] })).toBe(false);
    // Part on time, the rest after the close: all of it is held, and payState counts it as received.
    const late = {
      ...invoice,
      closed: true,
      paymentStatus: "expired_partially_paid" as const,
      deposits: [
        deposit("400", { paid: "0" }),
        deposit("600", { late: true, paid: "0", logIndex: 1 }),
      ],
      amounts: {
        receiver: "1000",
        payable: "0",
        held: "1000",
        settled: "0",
        refunded: "0",
        observedRefunded: "0",
        lastReturnTxHash: null,
        unreconciled: false,
        hasPolicyException: false,
        reconciliationStatus: "verified" as const,
      },
    };
    expect(payState(late, after).remaining).toBe(0n);
    expect(seenInFull(late)).toBe(false);
  });
});

describe("the pay box's last steps", () => {
  const last = (inv: Invoice, extra: Partial<Parameters<typeof useLastSteps>[0]> = {}) =>
    renderHook(() =>
      useLastSteps({
        invoice: inv,
        network: "Base",
        payee: "Sample shop",
        readAt: null,
        arrived: true,
        counting: true,
        line: "line",
        ...extra,
      }),
    ).result.current;
  const steps = (inv: Invoice, extra: Partial<Parameters<typeof useLastSteps>[0]> = {}) =>
    last(inv, extra).steps.map(({ title, state, progress }) => ({ title, state, progress }));
  const confirming = deposit("1000", {
    status: "detected",
    paid: null,
    blocksLeft: 9,
    blocksTotal: 12,
  });

  it("fills the confirming step's ring with the blocks passed, and waits to pay", () => {
    expect(steps({ ...invoice, deposits: [confirming] })).toEqual([
      { title: "Base is confirming the transfer", state: "current", progress: 0.25 },
      { title: "Sample shop is paid", state: "upcoming", progress: undefined },
    ]);
  });

  it("shows no share before a block passes, or while the ledger books a final transfer", () => {
    const [unseen] = steps({ ...invoice, deposits: [{ ...confirming, blocksLeft: 12 }] });
    expect(unseen?.progress).toBeNull();
    const [booking] = steps(
      { ...invoice, deposits: [deposit("1000", { paid: null })] },
      { counting: false },
    );
    expect(booking).toMatchObject({ state: "current", progress: null });
  });

  it("moves to the last step once the transfer is booked, and names a part payment", () => {
    const booked = { ...invoice, deposits: [deposit("400")] };
    expect(steps(booked, { counting: false }).map((s) => [s.title, s.state])).toEqual([
      ["Base confirmed the transfer", "done"],
      ["Sample shop is paid", "current"],
    ]);
    expect(steps(booked, { counting: false, partial: true })[1]?.title).toBe("Partially paid");
  });

  it("gives the live region the line of the step in progress, and none before the money arrives", () => {
    expect(last({ ...invoice, deposits: [confirming] }).line).toBe("3\u00a0of\u00a012\u00a0blocks");
    expect(last({ ...invoice, deposits: [deposit("400")] }, { counting: false }).line).toBe("line");
    expect(last(invoice, { arrived: false }).line).toBeNull();
  });

  it("keeps both steps ahead while another chain's money has not reached the network", () => {
    expect(
      steps(invoice, { arrived: false, payee: undefined }).map((s) => [s.title, s.state]),
    ).toEqual([
      ["Base confirms the transfer", "upcoming"],
      ["The recipient is paid", "upcoming"],
    ]);
  });

  it("writes the confirming line from the parts it knows, none of them breaking in two", () => {
    const plain = (line: string) => line.replaceAll("\u00a0", " ");
    expect(plain(PAY_COPY.confirmingLine(3200, 4400, 600, "2:41 PM"))).toBe(
      "3,200 of 4,400 blocks · about 10 min left · final around 2:41 PM",
    );
    expect(PAY_COPY.confirmingLine(3, 12, 0, null)).toBe("3\u00a0of\u00a012\u00a0blocks");
    expect(plain(PAY_COPY.confirmingLine(0, 0, 30, null))).toBe("Under a minute left");
    expect(PAY_COPY.confirmingLine(0, 0, 0, null)).toBe("Confirming");
  });
});
