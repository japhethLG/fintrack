import { describe, expect, it, vi } from "vitest";
import { renderApp, screen, act, knownDefect, moneyNear, moneyIn, type AppHandle } from "../harness";
import * as d from "./driver";
import type { ExpenseSpec } from "./driver";

// Cold first render (antd + radix + wizard) can exceed the 20 s default on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

/**
 * DEBT-TYPE EXPENSE RULES driven through the real wizard: cash loan, credit card, installment.
 *
 * Every expectation is written from first principles in the test:
 *   PMT   = P*r / (1 - (1+r)^-n)            (r = APR/12)                   -> d.pmt
 *   card  = max(floor, pct% x balance) [+ balance x APR/12]
 *   share = total / count
 * 2026 calendar: Jan 1 Thu, Feb 1 Sun, Feb 7 Sat, Mar 1 Sun. "Today" is Thu 2026-01-15.
 */

const TODAY = "2026-01-15";

async function widenWindow(app: AppHandle, start = "2025-01-01", end = "2032-12-31") {
  await act(async () => {
    app.financial().setViewDateRange(start, end);
  });
  await app.settle();
}

/** Rows of the loan "Payment Schedule Preview" table on the Details step. */
function amortRows() {
  return Array.from(document.querySelectorAll("tbody tr")).map((tr) => {
    const cells = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? "");
    const [principal, interest, balance] = moneyIn(tr as HTMLElement);
    return { n: cells[0], date: cells[1], principal, interest, balance };
  });
}

interface DebtRun {
  app: AppHandle;
  details: { emi?: number; totalInterest?: number; rows: ReturnType<typeof amortRows> };
  preview: string[];
  review: { amount: number; totalInterest?: number };
  doc: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Loan wizard: reads the Details-step numbers, the Schedule preview and the Review numbers, then saves. */
async function loanFlow(spec: ExpenseSpec, opts: { today?: string; timeZone?: string } = {}): Promise<DebtRun> {
  const app = await renderApp({ route: "/expenses", today: opts.today ?? TODAY, timeZone: opts.timeZone });
  await d.openExpenseForm(app);
  await app.user.click(screen.getByRole("heading", { name: "Loan" }));
  await d.next(app);
  await d.fillExpenseDetails(app, { ...spec, kind: "Loan" });
  const emiEl = screen.queryByText(/^Calculated Monthly Payment$/);
  const details = {
    emi: emiEl ? moneyNear(/^Calculated Monthly Payment$/) : undefined,
    totalInterest: emiEl ? moneyIn(screen.getByText(/^Total Interest:/))[0] : undefined,
    rows: amortRows(),
  };
  await d.next(app);
  await d.applyExpenseSchedule(app, { ...spec, kind: "Loan" });
  const preview = d.previewCards();
  await d.next(app);
  await screen.findByText("Review & Confirm");
  const review = {
    amount: moneyNear("Monthly Payment"),
    totalInterest: screen.queryByText("Total Interest") ? moneyNear("Total Interest") : undefined,
  };
  const doc = await d.finishExpense(app, spec);
  return { app, details, preview, review, doc };
}

/** Walk any wizard to its end and click Create if it lets us; return how many rules were stored. */
async function tryCreate(app: AppHandle): Promise<number> {
  for (let i = 0; i < 5 && screen.queryByRole("button", { name: "Continue" }); i++) {
    const btn = screen.getByRole("button", { name: "Continue" });
    if (btn.hasAttribute("disabled")) break;
    await app.user.click(btn);
    await app.settle();
  }
  const create = screen.queryByRole("button", { name: "Create Expense" });
  if (create && !create.hasAttribute("disabled")) {
    await app.user.click(create);
    await app.settle();
  }
  return d.ruleDocs(app).length;
}

// ===========================================================================
describe("cash loan wizard: a fresh loan (12,000 at 12% over 24 months)", () => {
  const EMI = d.pmt(12_000, 12, 24); // 564.8147...

  it("Details step, Review step, persisted amount and detail card all show the same EMI", async () => {
    const { doc, details, review, app } = await loanFlow({
      name: "Car Loan",
      principal: "12000",
      rate: "12",
      term: "24",
      start: "2026-02-10",
      weekend: "none",
    });
    expect(details.emi).toBeCloseTo(EMI, 2);
    expect(review.amount).toBeCloseTo(EMI, 2);
    expect(doc.amount).toBeCloseTo(EMI, 6);
    expect(doc.loanConfig.monthlyPayment).toBeCloseTo(EMI, 6);
    // the manager selects the new rule: its detail card is visible
    expect(moneyNear("Monthly Payment")).toBeCloseTo(EMI, 2);
    expect(app.financial().expenseRules).toHaveLength(1);
  });

  it("persists the loan configuration (blank Current Balance means a new loan) and a monthly schedule", async () => {
    const { doc } = await loanFlow({
      name: "Car Loan",
      principal: "12000",
      rate: "12",
      term: "24",
      start: "2026-02-10",
      weekend: "none",
    });
    expect(doc).toMatchObject({
      expenseType: "cash_loan",
      frequency: "monthly",
      startDate: "2026-02-10",
      isActive: true,
      loanConfig: {
        principalAmount: 12000,
        currentBalance: 12000,
        interestRate: 12,
        termMonths: 24,
        calculationType: "amortized",
        firstPaymentDate: "2026-02-10",
        loanStartDate: "2026-01-15",
        paymentsMade: 0,
      },
    });
    expect(d.nonFinitePaths(doc)).toEqual([]);
  });

  it("'Total Interest' on both wizard steps equals 24 payments minus the principal", async () => {
    const { details, review } = await loanFlow({
      principal: "12000",
      rate: "12",
      term: "24",
      start: "2026-02-10",
      weekend: "none",
    });
    const total = 24 * EMI - 12_000; // 1555.53
    expect(details.totalInterest).toBeCloseTo(total, 2);
    expect(review.totalInterest).toBeCloseTo(total, 2);
  });

  it("the amortisation preview rows follow the textbook schedule (interest 120.00 in month 1)", async () => {
    const { details } = await loanFlow({
      principal: "12000",
      rate: "12",
      term: "24",
      start: "2026-02-10",
      weekend: "none",
    });
    expect(details.rows).toHaveLength(6); // the form previews the first six payments
    let balance = 12_000;
    details.rows.forEach((row, i) => {
      const interest = balance * 0.01;
      const principal = EMI - interest;
      balance -= principal;
      expect(row.interest).toBeCloseTo(interest, 2);
      expect(row.principal).toBeCloseTo(principal, 2);
      expect(row.balance).toBeCloseTo(balance, 1); // rounded cells accumulate <= 0.01 per row
      expect(row.n).toBe(`#${i + 1}`);
    });
  });

  it("the projections pay the EMI monthly on the first payment date, 24 times, ending at a zero balance", async () => {
    const { app, doc } = await loanFlow({
      principal: "12000",
      rate: "12",
      term: "24",
      start: "2026-02-10",
      weekend: "none",
    });
    await widenWindow(app);
    const rows = d.engineRows(app, doc.id);
    expect(rows).toHaveLength(24);
    // Feb 10 2026 .. Jan 10 2028, one per month on the 10th
    expect(rows.map((r) => r.scheduledDate)).toEqual(
      Array.from({ length: 24 }, (_, i) => {
        const m0 = 1 + i; // 0-based month index counted from Jan 2026
        const y = 2026 + Math.floor(m0 / 12);
        return `${y}-${String((m0 % 12) + 1).padStart(2, "0")}-10`;
      })
    );
    rows.forEach((r) => expect(r.projectedAmount).toBeCloseTo(EMI, 6));
    expect(d.sum(rows.map((r) => r.projectedAmount))).toBeCloseTo(24 * EMI, 4);
    expect(rows[23].paymentBreakdown?.remainingBalance).toBeCloseTo(0, 6);
    expect(rows[0].paymentBreakdown?.interestPaid).toBeCloseTo(120, 6);
    expect(rows[0].paymentBreakdown?.principalPaid).toBeCloseTo(EMI - 120, 6);
  });

  it("the sum of the interest actually projected equals the 'Total Interest' shown in the wizard", async () => {
    const { app, doc, review } = await loanFlow({
      principal: "12000",
      rate: "12",
      term: "24",
      start: "2026-02-10",
      weekend: "none",
    });
    await widenWindow(app);
    const interest = d.sum(d.engineRows(app, doc.id).map((r) => r.paymentBreakdown!.interestPaid));
    expect(interest).toBeCloseTo(review.totalInterest!, 1);
  });

  it("a 0% loan divides the principal evenly (1,200 / 12 = 100.00) and shows zero interest", async () => {
    const { details, review, doc, app } = await loanFlow({
      principal: "1200",
      rate: "0",
      term: "12",
      start: "2026-02-10",
      weekend: "none",
    });
    expect(details.emi).toBe(100);
    expect(details.totalInterest).toBe(0);
    expect(review.amount).toBe(100);
    expect(doc.amount).toBe(100);
    expect(doc.loanConfig.interestRate).toBe(0);
    expect(d.engineRows(app, doc.id).map((r) => r.projectedAmount)).toEqual([100, 100, 100]); // Feb, Mar, Apr
  });

  it("selecting 'Flat Rate' is persisted but the EMI is still the amortised PMT (doc claim F20/defect 8: CONFIRMED)", async () => {
    // flat rate on 12,000 at 12% for 24 months would be 12000/24 + 12000*1% = 600.00 a month.
    const { doc, review } = await loanFlow({
      principal: "12000",
      rate: "12",
      term: "24",
      calcType: "Flat Rate",
      start: "2026-02-10",
      weekend: "none",
    });
    expect(doc.loanConfig.calculationType).toBe("flat_rate");
    expect(review.amount).toBeCloseTo(EMI, 2);
    expect(review.amount).not.toBeCloseTo(600, 0);
  });

  it.todo("DECISION: loan calculationType (amortized / flat_rate / reducing_balance) - implement the three formulas or drop the field");
});

// ===========================================================================
describe("cash loan wizard: a partially paid loan (principal 10,000, balance 5,000, 6%, 12 months)", () => {
  const spec: ExpenseSpec = {
    principal: "10000",
    currentBalance: "5000",
    rate: "6",
    term: "12",
    start: "2026-02-10",
    weekend: "none",
  };

  it("persists the balance the user entered and starts with zero payments made", async () => {
    const { doc } = await loanFlow(spec);
    expect(doc.loanConfig).toMatchObject({
      principalAmount: 10000,
      currentBalance: 5000,
      termMonths: 12,
      paymentsMade: 0,
    });
  });

  knownDefect(
    "UI-RULE-31",
    "partially-paid loan: the saved rule amount and the amount actually projected each month differ (2x)",
    async () => {
      // observed: rule amount 860.66 (PMT on the ORIGINAL 10,000) vs projected payments 430.33 (PMT on the 5,000 balance)
      const { app, doc } = await loanFlow(spec);
      const projected = d.engineRows(app, doc.id);
      expect(projected.length).toBeGreaterThan(0); // precondition
      expect(Number.isFinite(doc.amount)).toBe(true);
      expect(doc.amount).toBeCloseTo(projected[0].projectedAmount, 2);
    }
  );

  knownDefect(
    "UI-RULE-32",
    "partially-paid loan: the wizard's headline monthly payment contradicts its own amortisation preview",
    async () => {
      // observed: headline 860.66; first preview row principal 405.33 + interest 25.00 = 430.33
      const { details } = await loanFlow(spec);
      expect(details.rows.length).toBeGreaterThan(0); // precondition
      const firstRowPayment = details.rows[0].principal + details.rows[0].interest;
      expect(details.emi).toBeCloseTo(firstRowPayment, 1);
    }
  );

  knownDefect(
    "UI-RULE-33",
    "partially-paid loan: 'Total Interest' is computed from the original principal and overstates the interest that will be charged",
    async () => {
      // observed: shown 327.97 (12 x 860.66 - 10,000); the projected schedule (5,000 balance) charges 163.99
      const { app, doc, review } = await loanFlow(spec);
      await widenWindow(app);
      const rows = d.engineRows(app, doc.id);
      expect(rows).toHaveLength(12); // precondition
      const charged = d.sum(rows.map((r) => r.paymentBreakdown!.interestPaid));
      expect(review.totalInterest).toBeCloseTo(charged, 0);
    }
  );
});

// ===========================================================================
describe("cash loan wizard: schedule behaviour", () => {
  knownDefect(
    "UI-RULE-34",
    "a loan whose first payment is on the 31st skips February and drifts to the 3rd (Jan 31, Mar 3, Apr 3)",
    async () => {
      // correct: Jan 31, Feb 28, Mar 31
      const { app, doc } = await loanFlow({
        principal: "4000",
        rate: "0",
        term: "4",
        start: "2026-01-31",
        weekend: "none",
      });
      const dates = d.engineDates(app, doc.id);
      expect(dates[0]).toBe("2026-01-31"); // precondition
      expect(dates.slice(0, 3)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    }
  );

  knownDefect(
    "UI-RULE-35",
    "a loan's 'Day of Month' input is ignored by the engine, so the Schedule Preview shows different dates than are projected",
    async () => {
      // First Payment Date Feb 10 + Day of Month 20: preview shows the 20th, engine pays the 10th
      const { app, doc, preview } = await loanFlow({
        principal: "4000",
        rate: "0",
        term: "4",
        start: "2026-02-10",
        dayOfMonth: "20",
        weekend: "none",
      });
      const dates = d.engineDates(app, doc.id);
      expect(dates.length).toBeGreaterThan(0); // precondition
      expect(preview.length).toBeGreaterThan(0);
      expect(preview[0]).toBe(d.label(dates[0]));
    }
  );

  knownDefect(
    "UI-RULE-36",
    "a loan's detail card says 'On the 15th of each month' (today's date) while payments fall on the first payment date's day",
    async () => {
      // First Payment Date Feb 10, Day of Month untouched -> stored scheduleConfig.dayOfMonth = 15 (today)
      const { app, doc } = await loanFlow({
        principal: "4000",
        rate: "0",
        term: "4",
        start: "2026-02-10",
        weekend: "none",
      });
      const dates = d.engineDates(app, doc.id);
      expect(dates[0]).toBe("2026-02-10"); // precondition: pays on the 10th
      expect(screen.getByText(/of each month/).textContent).toBe("On the 10th of each month");
    }
  );

  knownDefect(
    "UI-RULE-37",
    "a loan ignores the Weekend Adjustment the wizard offers (installments honour it)",
    async () => {
      // first payment Sat 2026-02-07 with 'Pay on Monday' -> Mon 02-09. observed: 02-07 (Saturday)
      const { app, doc } = await loanFlow({
        principal: "4000",
        rate: "0",
        term: "4",
        start: "2026-02-07",
        weekend: "after",
      });
      expect(doc.weekendAdjustment).toBe("after"); // precondition: the choice was saved
      const dates = d.engineDates(app, doc.id);
      expect(dates).toHaveLength(3); // Feb, Mar, Apr (Apr 7 Tue)
      expect(dates[0]).toBe("2026-02-09");
    }
  );

  it("the loan schedule offers only Monthly and no end-date control", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, { kind: "Loan", principal: "1000", rate: "0", term: "10" });
    await app.user.click(screen.getByLabelText(/^Frequency/));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["Monthly"]);
    expect(screen.queryByRole("checkbox", { name: /Set End Date/ })).toBeNull();
  });

  knownDefect(
    "UI-RULE-38",
    "loan amortisation preview date is parsed as UTC: in America/New_York the first row shows the day BEFORE the Loan Start Date",
    async () => {
      // Loan Start Date field = 01/15/2026; observed first row "1/14/2026"
      const app = await renderApp({ route: "/expenses", today: TODAY, timeZone: "America/New_York" });
      await d.openExpenseForm(app);
      await app.user.click(screen.getByRole("heading", { name: "Loan" }));
      await d.next(app);
      await d.fillExpenseDetails(app, { kind: "Loan", principal: "1200", rate: "0", term: "12" });
      expect((screen.getByLabelText(/^Loan Start Date/) as HTMLInputElement).value).toBe("01/15/2026"); // precondition
      const rows = amortRows();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].date).toBe("1/15/2026");
    }
  );
});

// ===========================================================================
describe("cash loan wizard: validation", () => {
  it("a negative or zero principal blocks Continue", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.openExpenseForm(app);
    await app.user.click(screen.getByRole("heading", { name: "Loan" }));
    await d.next(app);
    await d.fillExpenseDetails(app, { kind: "Loan", principal: "-100", rate: "5", term: "12" });
    expect(d.nextButton()).toBeDisabled();
    await d.fill(app, /^Original Principal/, "0");
    expect(d.nextButton()).toBeDisabled();
  });

  it("an empty interest rate or term blocks Continue", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.openExpenseForm(app);
    await app.user.click(screen.getByRole("heading", { name: "Loan" }));
    await d.next(app);
    await d.fillExpenseDetails(app, { kind: "Loan", principal: "1000", rate: "", term: "12" });
    expect(d.nextButton()).toBeDisabled();
    await d.fill(app, /^Annual Interest Rate/, "5");
    await d.fill(app, /^Term \(Months\)/, "");
    expect(d.nextButton()).toBeDisabled();
  });

  knownDefect(
    "UI-RULE-39",
    "a loan term of 0 months is accepted and saved with an Infinity payment",
    async () => {
      // observed: amount = Infinity, loanConfig.monthlyPayment = Infinity, termMonths = 0
      const app = await renderApp({ route: "/expenses", today: TODAY });
      await d.fillExpenseToSchedule(app, { kind: "Loan", principal: "1000", rate: "5", term: "0", start: "2026-02-10" });
      await tryCreate(app);
      const docs = d.ruleDocs(app);
      expect(docs.flatMap((x) => d.nonFinitePaths(x))).toEqual([]);
      expect(docs).toHaveLength(0);
    }
  );

  knownDefect(
    "UI-RULE-40",
    "a negative interest rate is accepted for a loan",
    async () => {
      // observed: saved with interestRate -5 (payment below principal/term)
      const app = await renderApp({ route: "/expenses", today: TODAY });
      await d.fillExpenseToSchedule(app, { kind: "Loan", principal: "1000", rate: "-5", term: "12", start: "2026-02-10" });
      expect((screen.getByLabelText(/^First Payment Date/) as HTMLInputElement).value).toBe("02/10/2026"); // precondition: reached the schedule step
      await tryCreate(app);
      expect(d.ruleDocs(app)).toHaveLength(0);
    }
  );
});

// ===========================================================================
describe("credit card wizard", () => {
  interface CardRun {
    app: AppHandle;
    doc: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    review: number;
  }

  async function cardFlow(spec: ExpenseSpec, opts: { today?: string } = {}): Promise<CardRun> {
    const app = await renderApp({ route: "/expenses", today: opts.today ?? TODAY });
    await d.fillExpenseToSchedule(app, { ...spec, kind: "Credit Card" });
    await d.next(app);
    await screen.findByText("Review & Confirm");
    const review = moneyNear("Est. Min Payment");
    const doc = await d.finishExpense(app, spec);
    return { app, doc, review };
  }

  const base: ExpenseSpec = {
    name: "Visa",
    limit: "10000",
    balance: "5000",
    apr: "12",
    start: "2026-02-10",
    weekend: "none",
  };

  it("minimum payment = max(floor, 2% of balance) = 100.00 in the Review, the saved amount and the first projected bill", async () => {
    const { doc, app, review } = await cardFlow(base);
    expect(review).toBeCloseTo(100, 2);
    expect(doc.amount).toBeCloseTo(100, 6);
    expect(doc.creditConfig).toMatchObject({
      creditLimit: 10000,
      currentBalance: 5000,
      apr: 12,
      minimumPaymentPercent: 2,
      minimumPaymentFloor: 25,
      minimumPaymentMethod: "percent_only",
      statementDate: 5,
      dueDate: 25,
      paymentStrategy: "minimum",
    });
    expect(doc.scheduleConfig).toEqual({ dayOfMonth: 25 });
    const rows = d.engineRows(app, doc.id);
    expect(rows[0].scheduledDate).toBe("2026-02-25");
    expect(rows[0].projectedAmount).toBeCloseTo(100, 6);
  });

  it("declining minimum: month 2 pays 2% of the reduced balance (4,950 x 2% = 99.00), month 3 pays 98.01", async () => {
    // month 1: interest 5000 x 1% = 50, pay 100 -> principal 50 -> balance 4950
    // month 2: pay 99.00, interest 49.50 -> principal 49.50 -> balance 4900.50 -> month 3 pays 98.01
    const { doc, app } = await cardFlow(base);
    const rows = d.engineRows(app, doc.id);
    expect(rows.map((r) => r.scheduledDate)).toEqual(["2026-02-25", "2026-03-25", "2026-04-25"]);
    expect(rows.map((r) => r.projectedAmount)).toEqual([
      expect.closeTo(100, 6),
      expect.closeTo(99, 6),
      expect.closeTo(98.01, 6),
    ]);
  });

  it("'percentage + interest' adds one month of interest (100 + 50 = 150.00)", async () => {
    const { doc, review, app } = await cardFlow({ ...base, minMethod: "Percentage of Balance + Interest" });
    expect(doc.creditConfig.minimumPaymentMethod).toBe("percent_plus_interest");
    expect(review).toBeCloseTo(150, 2);
    expect(doc.amount).toBeCloseTo(150, 6);
    expect(d.engineRows(app, doc.id)[0].projectedAmount).toBeCloseTo(150, 6);
  });

  it("the payment floor applies to small balances (500 x 2% = 10 -> 25.00)", async () => {
    const { doc, review } = await cardFlow({ ...base, balance: "500" });
    expect(review).toBeCloseTo(25, 2);
    expect(doc.amount).toBeCloseTo(25, 6);
  });

  it("'Fixed Amount' strategy: saved amount, fixedPaymentAmount and every projected bill are 300.00", async () => {
    const { doc, app } = await cardFlow({ ...base, strategy: "Fixed Amount", fixedPayment: "300" });
    expect(doc.amount).toBe(300);
    expect(doc.creditConfig).toMatchObject({ paymentStrategy: "fixed", fixedPaymentAmount: 300 });
    const rows = d.engineRows(app, doc.id);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    rows.forEach((r) => expect(r.projectedAmount).toBeCloseTo(300, 6));
  });

  knownDefect(
    "UI-RULE-41",
    "'Pay Full Balance' does not clear the card in one payment (a second, interest-only bill appears)",
    async () => {
      // 5,000 at 24%: paying the full 5,000 on the due date leaves interest 100 that is billed again next month
      const { doc, app } = await cardFlow({ ...base, apr: "24", strategy: "Pay Full Balance" });
      const rows = d.engineRows(app, doc.id);
      expect(rows[0].projectedAmount).toBeCloseTo(5000, 2); // precondition: first bill is the full balance
      expect(rows).toHaveLength(1);
    }
  );

  knownDefect(
    "UI-RULE-42",
    "an empty Credit Limit is saved as NaN",
    async () => {
      // observed: creditConfig.creditLimit is NaN
      const { doc } = await cardFlow({ ...base, limit: "" });
      expect(doc.creditConfig.currentBalance).toBe(5000); // precondition: the rest of the doc is fine
      expect(d.nonFinitePaths(doc)).toEqual([]);
    }
  );

  knownDefect(
    "UI-RULE-43",
    "a card saved without a Credit Limit renders 'NaN%' utilisation and '$NaN' available credit on its detail card",
    async () => {
      const { doc } = await cardFlow({ ...base, limit: "" });
      expect(screen.getByText("Credit Card Overview")).toBeInTheDocument(); // precondition: the detail card is showing
      expect(doc.creditConfig.currentBalance).toBe(5000);
      expect(document.body.textContent).not.toMatch(/NaN/);
    }
  );

  knownDefect(
    "UI-RULE-44",
    "clearing Minimum Payment % and Floor saves NaN as the rule amount and projects NaN bills",
    async () => {
      // observed: amount NaN, minimumPaymentPercent NaN, minimumPaymentFloor NaN, first projected bill NaN
      const { doc, app } = await cardFlow({ ...base, minPercent: "", minFloor: "" });
      expect(d.engineRows(app, doc.id).length).toBeGreaterThan(0); // precondition
      expect(d.nonFinitePaths(doc)).toEqual([]);
    }
  );

  knownDefect(
    "UI-RULE-45",
    "an empty minimum-payment % gives a NaN projected bill",
    async () => {
      const { doc, app } = await cardFlow({ ...base, minPercent: "" });
      const rows = d.engineRows(app, doc.id);
      expect(rows.length).toBeGreaterThan(0); // precondition
      rows.forEach((r) => expect(Number.isFinite(r.projectedAmount)).toBe(true));
    }
  );

  it("the schedule step shows the due date as a read-only 'Payment Day' and only offers Monthly", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, { ...base, kind: "Credit Card", dueDate: "20" });
    const payDay = screen.getByLabelText(/^Payment Day/) as HTMLInputElement;
    expect(payDay.value).toBe("20");
    expect(payDay).toBeDisabled();
    await app.user.click(screen.getByLabelText(/^Frequency/));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["Monthly"]);
  });

  knownDefect(
    "UI-RULE-46",
    "credit card due on the 31st, tracking from Feb 10: the Feb 28 bill is skipped (first bill is Mar 31)",
    async () => {
      // correct: Feb 28, Mar 31 (then Apr 30)
      const { doc, app } = await cardFlow({ ...base, dueDate: "31" });
      const dates = d.engineDates(app, doc.id);
      expect(dates).toContain("2026-03-31"); // precondition
      expect(dates.slice(0, 2)).toEqual(["2026-02-28", "2026-03-31"]);
    }
  );

  knownDefect(
    "UI-RULE-47",
    "credit card due on the 31st, tracking from Jan 5: February is missing (Jan 31, Mar 31)",
    async () => {
      // correct: Jan 31, Feb 28, Mar 31
      const { doc, app } = await cardFlow({ ...base, dueDate: "31", start: "2026-01-05" });
      const dates = d.engineDates(app, doc.id);
      expect(dates[0]).toBe("2026-01-31"); // precondition
      expect(dates.slice(0, 3)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    }
  );

  knownDefect(
    "UI-RULE-48",
    "a credit card ignores the Weekend Adjustment (a due date on Saturday Feb 7 stays on Saturday)",
    async () => {
      // due day 7, tracking from Feb 1, 'Pay on Monday' -> Mon Feb 9
      const { doc, app } = await cardFlow({ ...base, dueDate: "7", start: "2026-02-01", weekend: "after" });
      expect(doc.weekendAdjustment).toBe("after"); // precondition
      expect(d.engineDates(app, doc.id)[0]).toBe("2026-02-09");
    }
  );

  it("a minimum-payment percentage above 100 shows the validation message", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.openExpenseForm(app);
    await app.user.click(screen.getByRole("heading", { name: "Credit Card" }));
    await d.next(app);
    await d.fillExpenseDetails(app, { kind: "Credit Card", balance: "5000", apr: "12", minPercent: "150" });
    expect(await screen.findByText("Percentage cannot exceed 100%")).toBeInTheDocument();
  });

  knownDefect(
    "UI-RULE-49",
    "the '> 100%' minimum-payment error is shown but does not stop the wizard: a 150% card is saved",
    async () => {
      // observed: Continue stays enabled, rule saved with minimumPaymentPercent 150 (amount = 7,500 on a 5,000 balance)
      const app = await renderApp({ route: "/expenses", today: TODAY });
      await d.openExpenseForm(app);
      await app.user.click(screen.getByRole("heading", { name: "Credit Card" }));
      await d.next(app);
      await d.fillExpenseDetails(app, { ...base, kind: "Credit Card", minPercent: "150" });
      expect(await screen.findByText("Percentage cannot exceed 100%")).toBeInTheDocument(); // precondition
      await tryCreate(app);
      expect(d.ruleDocs(app)).toHaveLength(0);
    }
  );

  knownDefect(
    "UI-RULE-50",
    "a due date of 32 is rejected by the field's error text but the wizard still saves it",
    async () => {
      const app = await renderApp({ route: "/expenses", today: TODAY });
      await d.openExpenseForm(app);
      await app.user.click(screen.getByRole("heading", { name: "Credit Card" }));
      await d.next(app);
      await d.fillExpenseDetails(app, { kind: "Credit Card", balance: "5000", apr: "12", dueDate: "32" });
      expect(await screen.findAllByText("Day must be between 1 and 31")).not.toHaveLength(0); // precondition
      await d.next(app);
      await tryCreate(app);
      expect(d.ruleDocs(app)).toHaveLength(0);
    }
  );
});

// ===========================================================================
describe("installment wizard", () => {
  interface InstRun {
    app: AppHandle;
    doc: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    review: number;
  }

  async function instFlow(spec: ExpenseSpec, opts: { today?: string } = {}): Promise<InstRun> {
    const app = await renderApp({ route: "/expenses", today: opts.today ?? TODAY });
    await d.fillExpenseToSchedule(app, { ...spec, kind: "Installment" });
    await d.next(app);
    await screen.findByText("Review & Confirm");
    const review = moneyNear("Amount");
    const doc = await d.finishExpense(app, spec);
    return { app, doc, review };
  }

  it("0% plan 1,200 / 6: 200.00 in the Review, the saved config and all six projected bills (Feb 10 ... Jul 10)", async () => {
    const { app, doc, review } = await instFlow({
      name: "Laptop",
      total: "1200",
      count: "6",
      start: "2026-02-10",
      weekend: "none",
    });
    expect(review).toBe(200);
    expect(doc.amount).toBe(200);
    expect(doc.installmentConfig).toEqual({
      totalAmount: 1200,
      installmentCount: 6,
      installmentAmount: 200,
      installmentsPaid: 0,
      hasInterest: false,
    });
    await widenWindow(app);
    const rows = d.engineRows(app, doc.id);
    expect(rows.map((r) => r.scheduledDate)).toEqual([
      "2026-02-10", "2026-03-10", "2026-04-10", "2026-05-10", "2026-06-10", "2026-07-10",
    ]); // prettier-ignore
    expect(rows.map((r) => r.projectedAmount)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(rows[5].paymentBreakdown).toMatchObject({ paymentNumber: 6, totalPayments: 6, remainingBalance: 0 });
  });

  it("with 10% interest the plan costs 1,200 x 1.10 = 1,320 -> 220.00 x 6 and the config records the rate", async () => {
    const { doc, review } = await instFlow({
      total: "1200",
      count: "6",
      interest: "10",
      start: "2026-02-10",
      weekend: "none",
    });
    expect(review).toBe(220);
    expect(doc.amount).toBe(220);
    expect(doc.installmentConfig).toMatchObject({ hasInterest: true, interestRate: 10, totalAmount: 1200 });
  });

  it.todo("DECISION: installment 'Interest Rate' - a flat surcharge on the total (10% on a 6-month plan = +120, same as on 24 months) or an annual rate amortised over the count");

  knownDefect(
    "UI-RULE-51",
    "1,000 over 7 installments is projected as seven bills of 142.857142857... (fractions of a cent)",
    async () => {
      // correct: whole-cent bills within a few cents of the 142.857 share that sum to exactly 1,000.00
      // (e.g. 142.86 x 6 + 142.84). observed: 142.85714285714286 x 7
      const { app, doc } = await instFlow({ total: "1000", count: "7", start: "2026-02-10", weekend: "none" });
      await widenWindow(app);
      const rows = d.engineRows(app, doc.id);
      expect(rows).toHaveLength(7); // precondition
      const amounts = rows.map((r) => r.projectedAmount);
      amounts.forEach((a) => expect(Math.abs(a - 1000 / 7)).toBeLessThan(0.05));
      amounts.forEach((a) => expect(d.isWholeCents(a)).toBe(true));
      expect(d.cents(d.sum(amounts))).toBe(1000);
    }
  );

  it("1,000 over 7: the Review shows 142.86 and the seven bills add up to 1,000 (to within float noise)", async () => {
    const { app, doc, review } = await instFlow({ total: "1000", count: "7", start: "2026-02-10", weekend: "none" });
    expect(review).toBeCloseTo(142.86, 2);
    await widenWindow(app);
    const rows = d.engineRows(app, doc.id);
    expect(d.sum(rows.map((r) => r.projectedAmount))).toBeCloseTo(1000, 6);
    expect(rows[6].paymentBreakdown?.remainingBalance).toBeCloseTo(0, 6);
  });

  knownDefect(
    "UI-RULE-52",
    "installments starting on the 31st drift to the 28th after February (Jan 31, Feb 28, Mar 28)",
    async () => {
      // correct: Jan 31, Feb 28, Mar 31. observed: month arithmetic is applied to the previous (clamped) date
      const { app, doc } = await instFlow({ total: "400", count: "4", start: "2026-01-31", weekend: "none" });
      const dates = d.engineDates(app, doc.id);
      expect(dates.slice(0, 2)).toEqual(["2026-01-31", "2026-02-28"]); // precondition
      expect(dates.slice(0, 3)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    }
  );

  it("installments honour the Weekend Adjustment (Sat Feb 7 and Sat Mar 7 -> Mon; Tue Apr 7 unchanged)", async () => {
    const { app, doc } = await instFlow({
      total: "400",
      count: "4",
      start: "2026-02-07",
      weekend: "after",
    });
    expect(d.engineDates(app, doc.id)).toEqual(["2026-02-09", "2026-03-09", "2026-04-07"]);
  });

  knownDefect(
    "UI-RULE-53",
    "an installment plan's 'Day of Month' input is ignored by the engine (preview and projections disagree)",
    async () => {
      // First Payment Date Feb 10, Day of Month 20: preview shows the 20th, engine bills the 10th
      const app = await renderApp({ route: "/expenses", today: TODAY });
      await d.fillExpenseToSchedule(app, {
        kind: "Installment",
        total: "400",
        count: "4",
        start: "2026-02-10",
        dayOfMonth: "20",
        weekend: "none",
      });
      const preview = d.previewCards();
      const doc = await d.finishExpense(app, { notes: undefined });
      const dates = d.engineDates(app, doc.id);
      expect(dates.length).toBeGreaterThan(0); // precondition
      expect(preview[0]).toBe(d.label(dates[0]));
    }
  );

  it("more than 120 installments shows the validation message and blocks Continue", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.openExpenseForm(app);
    await app.user.click(screen.getByRole("heading", { name: "Installment" }));
    await d.next(app);
    await d.fillExpenseDetails(app, { kind: "Installment", total: "1000", count: "121" });
    expect(await screen.findByText("Number of installments cannot exceed 120")).toBeInTheDocument();
    expect(d.nextButton()).toBeDisabled();
  });

  it("a negative or empty total blocks Continue", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.openExpenseForm(app);
    await app.user.click(screen.getByRole("heading", { name: "Installment" }));
    await d.next(app);
    await d.fillExpenseDetails(app, { kind: "Installment", total: "-10", count: "3" });
    expect(d.nextButton()).toBeDisabled();
    await d.fill(app, /^Total Amount/, "");
    expect(d.nextButton()).toBeDisabled();
  });

  knownDefect(
    "UI-RULE-54",
    "0 installments is accepted and saved with an Infinity instalment amount",
    async () => {
      // observed: installmentAmount = Infinity (1000 / 0)
      const app = await renderApp({ route: "/expenses", today: TODAY });
      await d.fillExpenseToSchedule(app, { kind: "Installment", total: "1000", count: "0", start: "2026-02-10" });
      await tryCreate(app);
      const docs = d.ruleDocs(app);
      expect(docs.flatMap((x) => d.nonFinitePaths(x))).toEqual([]);
      expect(docs).toHaveLength(0);
    }
  );

  knownDefect(
    "UI-RULE-55",
    "a negative installment count is accepted and saved as a negative instalment amount",
    async () => {
      // observed: 1000 / -3 = -333.33 per 'installment', installmentCount -3
      const app = await renderApp({ route: "/expenses", today: TODAY });
      await d.fillExpenseToSchedule(app, { kind: "Installment", total: "1000", count: "-3", start: "2026-02-10" });
      await tryCreate(app);
      expect(d.ruleDocs(app)).toHaveLength(0);
    }
  );
});
