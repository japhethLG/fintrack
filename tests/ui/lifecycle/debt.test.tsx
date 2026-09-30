import { describe, expect, it } from "vitest";
import {
  screen,
  within,
  knownDefect,
  makeCreditRule,
  makeInstallmentRule,
  makeLoanRule,
} from "../harness";
import {
  amortize,
  balanceOf,
  calendarPrevMonth,
  completeTx,
  displayedBalance,
  expectInvariants,
  merged,
  mountAll,
  mountTx,
  nth,
  openTx,
  paymentNo,
  revertTx,
  rowMoney,
  skipTx,
  storedRule,
  storedTxs,
  type App,
} from "./kit";
import type { ExpenseRule } from "@/lib/types";

/**
 * Loans, credit cards and installments: what completing / skipping / reverting a payment does to
 * the rule's own progress (paymentsMade, loan currentBalance, card currentBalance,
 * installmentsPaid) and to the payments that are projected afterwards.
 *
 * All expected numbers come from `amortize()` (an independent PMT implementation) or hand arithmetic
 * written next to the assertion. Today = 2026-01-15, so the default projection window is
 * 2025-11-01 .. 2026-04-30.
 *
 * LOAN FIXTURE: 4,000 at 12% APR over 4 months, first payment 2026-01-10.
 *   r = 1%/month, PMT = 4000*0.01*1.01^4 / (1.01^4 - 1) = 41.6241604 / 0.04060401 = 1,025.1244 -> 1,025.12
 *   payment 1: interest 40.00, principal 985.12, balance 3,014.88
 * Payments fall on Jan 10, Feb 10, Mar 10, Apr 10 (all inside the window).
 */

const T = 90_000;
const LOAN = amortize(4_000, 12, 4);

const loanRule = (over: Partial<ExpenseRule> = {}, cfg: Record<string, number | string> = {}) =>
  makeLoanRule(
    { id: "loan", name: "Car Loan", startDate: "2026-01-10", amount: 1_025.12, ...over },
    {
      principalAmount: 4_000,
      currentBalance: 4_000,
      interestRate: 12,
      termMonths: 4,
      monthlyPayment: 1_025.12,
      paymentsMade: 0,
      loanStartDate: "2026-01-10",
      firstPaymentDate: "2026-01-10",
      ...cfg,
    }
  );

const loanRows = (app: App) => merged(app).filter((t) => t.sourceId === "loan");
const near = (actual: number, expected: number, tol = 0.011) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

describe("cash loan: the scheduled payments (precondition for everything below)", () => {
  it("projects four level payments that match an independent PMT (1,025.12)", async () => {
    const app = await mountTx({ expenseRules: [loanRule()] });
    const rows = loanRows(app);
    expect(rows.map((r) => r.scheduledDate)).toEqual([
      "2026-01-10",
      "2026-02-10",
      "2026-03-10",
      "2026-04-10",
    ]);
    near(LOAN.pmt, 1_025.1244, 0.001);
    rows.slice(0, 3).forEach((r) => near(r.projectedAmount, LOAN.pmt));
    // the on-screen rows print the same amounts
    rows.slice(0, 3).forEach((r) => near(-rowMoney(app, r.id)[0], LOAN.pmt, 0.006));
    expect(rows.map((r) => paymentNo(app, r.id))).toEqual([1, 2, 3, 4]);
  }, T);
});

describe("cash loan: completing a payment", () => {
  it("debits the balance by the ACTUAL amount and stores a completed row linked to the occurrence", async () => {
    // 10,000 - 1,025.12 = 8,974.88
    const app = await mountTx({ expenseRules: [loanRule()] });
    await completeTx(app, nth(app, "Car Loan", 0).id, { amount: 1_025.12 });
    expect(storedTxs(app)).toHaveLength(1);
    expect(storedTxs(app)[0]).toMatchObject({
      sourceId: "loan",
      occurrenceId: "loan_2026-01",
      status: "completed",
      actualAmount: 1_025.12,
    });
    expect(balanceOf(app)).toBeCloseTo(8_974.88, 2);
    expect(displayedBalance()).toBeCloseTo(8_974.88, 2);
    expect(storedRule(app, "loan").loanConfig!.paymentsMade).toBe(1);
    expectInvariants(app, ["complete loan #1"]);
  }, T);

  it(
    "UI-LIFE-10 — completing a loan payment never reduces loanConfig.currentBalance (principal stays 4,000)",
    async () => {
      // observed: paymentsMade 1 but currentBalance 4000. Correct: 4,000 - principal(985.12) = 3,014.88.
      const app = await mountTx({ expenseRules: [loanRule()] });
      await completeTx(app, nth(app, "Car Loan", 0).id);
      expect(storedRule(app, "loan").loanConfig!.paymentsMade).toBe(1); // precondition: counter moved
      near(storedRule(app, "loan").loanConfig!.currentBalance, 4_000 - LOAN.rows[0].principal);
    },
    T
  );

  it(
    "UI-LIFE-10b — an EXTRA payment (1,500 instead of 1,025.12) reduces the loan principal by 1,500 - interest 40 = 1,460 (-> 2,540)",
    async () => {
      // observed: currentBalance unchanged at 4000.
      const app = await mountTx({ expenseRules: [loanRule()] });
      await completeTx(app, nth(app, "Car Loan", 0).id, { amount: 1_500 });
      expect(balanceOf(app)).toBe(8_500);
      near(storedRule(app, "loan").loanConfig!.currentBalance, 4_000 - (1_500 - 40));
    },
    T
  );

  it("UI-LIFE-11 — after paying #1 the remaining EMIs INFLATE (1,360.09 instead of the unchanged 1,025.12)",
    async () => {
      // observed: schedule is rebuilt from the UNREDUCED 4,000 over 3 remaining payments:
      //   PMT(4000, 3) = 41.21204 / 0.030301 = 1,360.09 for Feb and Mar.
      // Correct: the loan is level; Feb/Mar/Apr stay 1,025.12.
      const app = await mountTx({ expenseRules: [loanRule()] });
      await completeTx(app, nth(app, "Car Loan", 0).id);
      const projected = loanRows(app).filter((t) => t.status === "projected");
      expect(projected.length).toBeGreaterThanOrEqual(2); // precondition: there are later payments
      near(-rowMoney(app, projected[0].id)[0], LOAN.pmt);
    },
    T
  );

  it("UI-LIFE-12 — after paying #1 a scheduled payment VANISHES: the 4-month loan shows only 2 future payments instead of 3",
    async () => {
      // observed: Jan(completed) + Feb + Mar; the April payment is gone (term shrinks by one
      // while the schedule restarts from the start date). Correct: Feb, Mar, Apr still projected.
      const app = await mountTx({ expenseRules: [loanRule()] });
      await completeTx(app, nth(app, "Car Loan", 0).id);
      expect(loanRows(app).filter((t) => t.status === "completed")).toHaveLength(1);
      expect(loanRows(app).filter((t) => t.status === "projected").map((t) => t.scheduledDate)).toEqual([
        "2026-02-10",
        "2026-03-10",
        "2026-04-10",
      ]);
    },
    T
  );

  it(
    "UI-LIFE-13 — a completed loan row loses its payment number: '(#1)' disappears once paid",
    async () => {
      // observed: no paymentBreakdown is stored on completion, so the row prints no '(#n)'.
      const app = await mountTx({ expenseRules: [loanRule()] });
      const first = nth(app, "Car Loan", 0);
      expect(paymentNo(app, first.id)).toBe(1); // precondition: projected row shows #1
      await completeTx(app, first.id);
      const done = loanRows(app).find((t) => t.status === "completed")!;
      expect(paymentNo(app, done.id)).toBe(1);
    },
    T
  );

  it(
    "UI-LIFE-14 — the stored projectedAmount is the rule's flat amount, not the amortized payment the row showed",
    async () => {
      // rule.amount = 1,000 (user-entered) but the schedule row shows 1,025.12.
      // observed: stored projectedAmount 1000, so re-opening the paid row says 'Expected -$1,000.00'.
      const app = await mountTx({ expenseRules: [loanRule({ amount: 1_000 })] });
      const first = nth(app, "Car Loan", 0);
      near(-rowMoney(app, first.id)[0], LOAN.pmt); // precondition: the schedule shows 1,025.12
      await completeTx(app, first.id);
      near(storedTxs(app)[0].projectedAmount, LOAN.pmt);
    },
    T
  );

  it(
    "UI-LIFE-15 — completing a loan payment never stores `variance` (paid 1,100 vs scheduled 1,025.12 shows no variance)",
    async () => {
      // observed: stored doc has no variance field; the row prints only the amount.
      const app = await mountTx({ expenseRules: [loanRule()] });
      await completeTx(app, nth(app, "Car Loan", 0).id, { amount: 1_100 });
      expect(storedTxs(app)[0].actualAmount).toBe(1_100);
      expect(storedTxs(app)[0].variance).toBeDefined();
    },
    T
  );
});

describe("cash loan: payment number depends on the viewport", () => {
  /** A loan that started before the projection window: first payment Oct 10 2025, 6 terms. */
  const oldLoan = () =>
    loanRule(
      { startDate: "2025-10-10", amount: 690.19 },
      { termMonths: 6, principalAmount: 4_000, currentBalance: 4_000, loanStartDate: "2025-10-10", firstPaymentDate: "2025-10-10" }
    );

  it("UI-LIFE-16 — the first visible payment is numbered #1 even though an earlier scheduled payment (Oct 10) precedes the window",
    async () => {
      // Payments: Oct 10 = #1, Nov 10 = #2, Dec 10 = #3 ... The window starts 2025-11-01 so the
      // first row shown is Nov 10. observed: it prints (#1) because numbering restarts inside the window.
      const app = await mountTx({ expenseRules: [oldLoan()] });
      const nov = loanRows(app).find((t) => t.scheduledDate === "2025-11-10")!;
      expect(nov).toBeTruthy(); // precondition: the Nov row exists
      expect(loanRows(app).some((t) => t.scheduledDate === "2025-10-10")).toBe(false); // Oct is outside the window
      expect(paymentNo(app, nov.id)).toBe(2);
    },
    T
  );

  it("UI-LIFE-17 — a payment's number changes when the user pages the Calendar back a few months (viewport-dependent)",
    async () => {
      // observed: Nov 10 prints (#1) at first and (#2) after the calendar widens the window to Oct.
      const app = await mountAll({ expenseRules: [oldLoan()] });
      const nov = loanRows(app).find((t) => t.scheduledDate === "2025-11-10")!;
      const before = paymentNo(app, nov.id);
      expect(before).not.toBeNull();
      await calendarPrevMonth(app, 3); // Jan -> Dec -> Nov -> Oct
      const novAfter = loanRows(app).find((t) => t.scheduledDate === "2025-11-10")!;
      expect(loanRows(app).some((t) => t.scheduledDate === "2025-10-10")).toBe(true); // window really widened
      expect(paymentNo(app, novAfter.id)).toBe(before);
    },
    T
  );
});

describe("cash loan: paymentsMade counter under skip / revert cycles", () => {
  it("complete -> revert -> complete is idempotent: paymentsMade 1 -> 0 -> 1, balance 8,974.88 -> 10,000 -> 8,974.88", async () => {
    const app = await mountTx({ expenseRules: [loanRule()] });
    const id0 = () => loanRows(app)[0].id;
    await completeTx(app, id0(), { amount: 1_025.12 });
    expect(storedRule(app, "loan").loanConfig!.paymentsMade).toBe(1);
    await revertTx(app, id0());
    expect(storedRule(app, "loan").loanConfig!.paymentsMade).toBe(0);
    expect(balanceOf(app)).toBeCloseTo(10_000, 2);
    expect(storedTxs(app)).toHaveLength(0);
    expect(loanRows(app).map((t) => t.status)).toEqual(["projected", "projected", "projected", "projected"]);
    await completeTx(app, id0(), { amount: 1_025.12 });
    expect(storedRule(app, "loan").loanConfig!.paymentsMade).toBe(1);
    expect(balanceOf(app)).toBeCloseTo(8_974.88, 2);
    expect(storedTxs(app)).toHaveLength(1);
    expectInvariants(app, ["complete", "revert", "complete"]);
  }, T);

  it(
    "UI-LIFE-18 — skipping a COMPLETED loan payment reverses the cash but leaves paymentsMade at 1",
    async () => {
      // observed: balance back to 10,000, paymentsMade still 1 => the plan believes a payment was made.
      const app = await mountTx({ expenseRules: [loanRule()] });
      await completeTx(app, loanRows(app)[0].id);
      await skipTx(app, loanRows(app)[0].id);
      expect(balanceOf(app)).toBeCloseTo(10_000, 2); // precondition: the cash was reversed
      expect(storedTxs(app)[0].status).toBe("skipped");
      expect(storedRule(app, "loan").loanConfig!.paymentsMade).toBe(0);
    },
    T
  );

  it(
    "UI-LIFE-19 — paying a previously SKIPPED loan payment does not count it: paymentsMade stays 1 after two payments",
    async () => {
      // pay #1, skip #2, then change your mind and pay #2 (stored-row path). observed: 1, not 2.
      const app = await mountTx({ expenseRules: [loanRule()] });
      await completeTx(app, loanRows(app)[0].id);
      const feb = () => loanRows(app).find((t) => t.scheduledDate === "2026-02-10")!;
      await skipTx(app, feb().id);
      expect(feb().status).toBe("skipped");
      await completeTx(app, feb().id, { amount: 1_025.12 });
      expect(loanRows(app).filter((t) => t.status === "completed")).toHaveLength(2);
      expect(storedRule(app, "loan").loanConfig!.paymentsMade).toBe(2);
    },
    T
  );
});

// ---------------------------------------------------------------------------
// Credit card
// ---------------------------------------------------------------------------

/**
 * CARD FIXTURE: balance 5,000, APR 12%, minimum = 2% of balance (floor 25), due on the 15th.
 *   month 1 (Jan 15, today): interest 5000*0.12/12 = 50, minimum max(25, 2%*5000) = 100,
 *                            principal 50, balance 4,950
 *   month 2 (Feb 15): minimum 2% * 4,950 = 99
 * Pay 500 on Jan 15: 5,000 + 50 interest - 500 = 4,550 owed.
 */
const cardRule = (over: Partial<ExpenseRule> = {}, cfg: Record<string, number | string> = {}) =>
  makeCreditRule(
    { id: "card", name: "Visa", startDate: "2026-01-01", amount: 100, ...over },
    {
      creditLimit: 10_000,
      currentBalance: 5_000,
      apr: 12,
      minimumPaymentPercent: 2,
      minimumPaymentFloor: 25,
      minimumPaymentMethod: "percent_only",
      dueDate: 15,
      paymentStrategy: "minimum",
      ...cfg,
    }
  );
const cardRows = (app: App) => merged(app).filter((t) => t.sourceId === "card");

describe("credit card payments", () => {
  it("schedules the minimum payments from the balance: Jan 15 = 100.00 (today, not overdue), Feb 15 = 99.00", async () => {
    const app = await mountTx({ expenseRules: [cardRule()] });
    const rows = cardRows(app);
    expect(rows.slice(0, 2).map((r) => r.scheduledDate)).toEqual(["2026-01-15", "2026-02-15"]);
    expect(-rowMoney(app, rows[0].id)[0]).toBeCloseTo(100, 2);
    expect(-rowMoney(app, rows[1].id)[0]).toBeCloseTo(99, 2);
  }, T);

  it("paying the card debits the cash balance by the actual amount (10,000 - 500)", async () => {
    const app = await mountTx({ expenseRules: [cardRule()] });
    await completeTx(app, cardRows(app)[0].id, { amount: 500 });
    expect(balanceOf(app)).toBe(9_500);
    expect(displayedBalance()).toBe(9_500);
    expect(storedTxs(app)[0]).toMatchObject({ sourceId: "card", status: "completed", actualAmount: 500 });
    expectInvariants(app, ["pay card 500"]);
  }, T);

  it(
    "UI-LIFE-20 — paying 500 on a 5,000 card leaves creditConfig.currentBalance at 5,000",
    async () => {
      // observed: 5000 (updateCreditBalance is never called). Correct: between 4,500 (payment
      // fully applied) and 4,550 (one month's 50 interest accrued first).
      const app = await mountTx({ expenseRules: [cardRule()] });
      await completeTx(app, cardRows(app)[0].id, { amount: 500 });
      expect(balanceOf(app)).toBe(9_500); // precondition: the payment happened
      const owed = storedRule(app, "card").creditConfig!.currentBalance;
      expect(owed).toBeLessThanOrEqual(4_550.01);
      expect(owed).toBeGreaterThanOrEqual(4_500);
    },
    T
  );

  it(
    "UI-LIFE-21 — after a 500 payment the NEXT minimum is still computed from the old balance (99.00 instead of <= 91.00)",
    async () => {
      // 2% minimum can never exceed 2% * 4,550 = 91.00 once 500 has been paid.
      // observed: Feb 15 still prints 99.00 (the schedule assumes the planned 100 was paid).
      const app = await mountTx({ expenseRules: [cardRule()] });
      await completeTx(app, cardRows(app)[0].id, { amount: 500 });
      const feb = cardRows(app).find((t) => t.scheduledDate === "2026-02-15")!;
      expect(feb.status).toBe("projected");
      expect(-rowMoney(app, feb.id)[0]).toBeLessThanOrEqual(91.0);
    },
    T
  );

  it("complete -> revert leaves the card balance exactly where it started (5,000) and restores the cash", async () => {
    const app = await mountTx({ expenseRules: [cardRule()] });
    await completeTx(app, cardRows(app)[0].id, { amount: 500 });
    await revertTx(app, cardRows(app)[0].id);
    expect(storedRule(app, "card").creditConfig!.currentBalance).toBe(5_000);
    expect(balanceOf(app)).toBe(10_000);
    expect(storedTxs(app)).toHaveLength(0);
    expectInvariants(app, ["pay", "revert"]);
  }, T);

  it("card payment numbers do NOT depend on the window (Nov 15 is #2 for a card that started in October)", async () => {
    const app = await mountTx({ expenseRules: [cardRule({ startDate: "2025-10-01" })] });
    const nov = cardRows(app).find((t) => t.scheduledDate === "2025-11-15")!;
    expect(nov).toBeTruthy();
    expect(paymentNo(app, nov.id)).toBe(2);
  }, T);
});

// ---------------------------------------------------------------------------
// Installments
// ---------------------------------------------------------------------------

/** 6 x 200 (0% BNPL), first instalment 2026-01-10. */
const instRule = (over: Partial<ExpenseRule> = {}, cfg: Record<string, number> = {}) =>
  makeInstallmentRule(
    { id: "inst", name: "Laptop BNPL", startDate: "2026-01-10", amount: 200, ...over },
    { totalAmount: 1_200, installmentCount: 6, installmentAmount: 200, installmentsPaid: 0, ...cfg }
  );
const instRows = (app: App) => merged(app).filter((t) => t.sourceId === "inst");
const paid = (app: App) => storedRule(app, "inst").installmentConfig!.installmentsPaid;

describe("installments", () => {
  it("projects Jan..Apr as #1..#4 of 6 at 200 each", async () => {
    const app = await mountTx({ expenseRules: [instRule()] });
    expect(instRows(app).map((t) => [t.scheduledDate, paymentNo(app, t.id)])).toEqual([
      ["2026-01-10", 1],
      ["2026-02-10", 2],
      ["2026-03-10", 3],
      ["2026-04-10", 4],
    ]);
    instRows(app).forEach((t) => expect(-rowMoney(app, t.id)[0]).toBe(200));
  }, T);

  it("installment numbering does NOT depend on the window (Nov 10 is #2 for a plan that started in October)", async () => {
    const app = await mountTx({ expenseRules: [instRule({ startDate: "2025-10-10" })] });
    const nov = instRows(app).find((t) => t.scheduledDate === "2025-11-10")!;
    expect(nov).toBeTruthy();
    expect(paymentNo(app, nov.id)).toBe(2);
  }, T);

  it("paying #1 counts once, debits 200, and #2..#4 stay projected", async () => {
    const app = await mountTx({ expenseRules: [instRule()] });
    await completeTx(app, instRows(app)[0].id);
    expect(paid(app)).toBe(1);
    expect(balanceOf(app)).toBe(9_800);
    const future = instRows(app).filter((t) => t.status === "projected");
    expect(future.map((t) => t.scheduledDate)).toEqual(["2026-02-10", "2026-03-10", "2026-04-10"]);
    expect(future.map((t) => paymentNo(app, t.id))).toEqual([2, 3, 4]);
    expectInvariants(app, ["pay #1"]);
  }, T);

  it("complete -> revert -> complete is idempotent: installmentsPaid 1 -> 0 -> 1 and the cash follows", async () => {
    const app = await mountTx({ expenseRules: [instRule()] });
    await completeTx(app, instRows(app)[0].id);
    const done = () => instRows(app).find((t) => t.status === "completed")!;
    await revertTx(app, done().id);
    expect(paid(app)).toBe(0);
    expect(balanceOf(app)).toBe(10_000);
    expect(instRows(app).map((t) => t.status)).toEqual(["projected", "projected", "projected", "projected"]);
    await completeTx(app, instRows(app)[0].id);
    expect(paid(app)).toBe(1);
    expect(balanceOf(app)).toBe(9_800);
    expectInvariants(app, ["pay", "revert", "pay"]);
  }, T);

  it(
    "UI-LIFE-22 — re-completing an already completed installment increments installmentsPaid again (and swallows the next payment)",
    async () => {
      // pay #1 for 200, then reopen it and resubmit 210. observed: installmentsPaid 2 and the Feb 10
      // payment disappears from the projections. Correct: still 1 payment made.
      const app = await mountTx({ expenseRules: [instRule()] });
      await completeTx(app, instRows(app)[0].id);
      expect(paid(app)).toBe(1); // precondition: first completion counted once
      const done = instRows(app).find((t) => t.status === "completed")!;
      await completeTx(app, done.id, { amount: 210 });
      expect(balanceOf(app)).toBe(9_790); // precondition: cash reversed and re-applied
      expect(paid(app)).toBe(1);
    },
    T
  );

  it(
    "UI-LIFE-22b — ...and the Feb 10 instalment must still be projected after re-completing #1",
    async () => {
      const app = await mountTx({ expenseRules: [instRule()] });
      await completeTx(app, instRows(app)[0].id);
      const done = instRows(app).find((t) => t.status === "completed")!;
      await completeTx(app, done.id, { amount: 210 });
      expect(instRows(app).some((t) => t.scheduledDate === "2026-02-10" && t.status === "projected")).toBe(true);
    },
    T
  );

  it(
    "UI-LIFE-23 — skipping a COMPLETED installment reverses the cash but leaves installmentsPaid at 1",
    async () => {
      const app = await mountTx({ expenseRules: [instRule()] });
      await completeTx(app, instRows(app)[0].id);
      await skipTx(app, instRows(app).find((t) => t.status === "completed")!.id);
      expect(balanceOf(app)).toBe(10_000); // precondition
      expect(storedTxs(app)[0].status).toBe("skipped");
      expect(paid(app)).toBe(0);
    },
    T
  );

  it("paying a previously skipped installment counts it once and revert takes it back", async () => {
    const app = await mountTx({ expenseRules: [instRule()] });
    await skipTx(app, instRows(app)[0].id);
    expect(paid(app)).toBe(0);
    await completeTx(app, instRows(app)[0].id);
    expect(paid(app)).toBe(1);
    expect(balanceOf(app)).toBe(9_800);
    await revertTx(app, instRows(app)[0].id);
    expect(paid(app)).toBe(0);
    expect(balanceOf(app)).toBe(10_000);
    expectInvariants(app, ["skip", "pay", "revert"]);
  }, T);

  it(
    "UI-LIFE-24 — reverting the LAST instalment (after it was paid from Skipped) makes it vanish: the plan is deactivated and never re-projects it",
    async () => {
      // 2 x 200 plan. pay #1, skip #2, pay #2 (stored-row path -> rule flips isActive=false because
      // paid >= count), then Revert #2. observed: no projected row for #2 (rule inactive), so a
      // real, unpaid 200 instalment is no longer shown anywhere. Correct: it is projected again.
      const app = await mountTx({
        expenseRules: [instRule({}, { installmentCount: 2, totalAmount: 400 })],
      });
      await completeTx(app, instRows(app)[0].id);
      const second = () => instRows(app).find((t) => t.scheduledDate === "2026-02-10")!;
      await skipTx(app, second().id);
      await completeTx(app, second().id);
      expect(balanceOf(app)).toBe(9_600); // precondition: both instalments paid
      await revertTx(app, second().id);
      expect(balanceOf(app)).toBe(9_800); // precondition: only #1 remains paid
      expect(instRows(app).find((t) => t.scheduledDate === "2026-02-10")?.status).toBe("projected");
    },
    T
  );

  it("the last instalment paid straight from the projection keeps the plan active (so revert works)", async () => {
    const app = await mountTx({
      expenseRules: [instRule({}, { installmentCount: 2, totalAmount: 400 })],
    });
    await completeTx(app, instRows(app)[0].id);
    await completeTx(app, instRows(app).find((t) => t.status === "projected")!.id);
    expect(paid(app)).toBe(2);
    await revertTx(app, instRows(app).find((t) => t.scheduledDate === "2026-02-10")!.id);
    expect(instRows(app).find((t) => t.scheduledDate === "2026-02-10")?.status).toBe("projected");
    expect(balanceOf(app)).toBe(9_800);
  }, T);
});

describe("debt progress: things that stay undecided", () => {
  it.todo("DECISION: does skipping an instalment/loan payment defer it (extend the plan by one month) or forgive it?");
  it.todo("DECISION: is a loan's currentBalance the principal owed BEFORE or AFTER this month's payment once it is completed early?");
  it.todo("DECISION: should completing a loan payment on a date other than its due date shift the remaining schedule?");
});

// keep the screen import used (row queries elsewhere use it indirectly)
void screen;
void within;
void openTx;
