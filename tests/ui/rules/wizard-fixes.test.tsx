import { describe, expect, it, vi } from "vitest";
import {
  renderApp,
  screen,
  makeLoanRule,
  makeExpenseRule,
  type AppHandle,
} from "../harness";
import * as d from "./driver";

// Cold first render (antd + radix + wizard) can exceed the 20 s default on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

/**
 * MANUAL-TEST FIXES in the income / expense wizards (docs/audit/manual-test-2026-10-01.md): M1, M7, L8 and the
 * wizard UX notes. Every expectation is written from first principles in the test (hand-listed dates, the
 * textbook PMT), and every test here failed on the code before the fix.
 * 2026 calendar: Jan 1 Thu, Oct 1 Thu, Nov 1 Sun. "Today" is Thu 2026-01-15.
 */

const TODAY = "2026-01-15";

/** The date cells of the loan "Payment Schedule Preview" table on the Details step. */
const amortDates = () =>
  Array.from(
    Array.from(document.querySelectorAll("table"))
      .find((t) => t.textContent?.includes("Principal"))
      ?.querySelectorAll("tbody tr") ?? []
  ).map(
    (tr) => tr.querySelectorAll("td")[1]?.textContent ?? ""
  );

const field = (label: string) => screen.getByText(label).nextElementSibling!.textContent;

// ===========================================================================
describe("M1: editing a loan does not re-price it", () => {
  const STORED = 564.88; // the contract payment the loan was saved with
  // a balance that has drifted away from what 564.88 over 23 remaining months would imply
  const seed = () => ({
    expenseRules: [
      makeLoanRule(
        { id: "loan-1", name: "Car Loan", amount: STORED, startDate: "2026-02-10", scheduleConfig: { dayOfMonth: 10 } },
        {
          principalAmount: 12_000,
          currentBalance: 11_000,
          interestRate: 12,
          termMonths: 24,
          monthlyPayment: STORED,
          firstPaymentDate: "2026-02-10",
          loanStartDate: "2026-02-10",
          paymentsMade: 1,
        }
      ),
    ],
  });

  const editLoan = async (change: (app: AppHandle) => Promise<void>) => {
    const app = await renderApp({ route: "/expenses", today: TODAY, seed: seed() });
    await d.openEdit(app, "Car Loan");
    await d.next(app);
    await change(app);
    await d.saveEdit(app);
    return d.ruleDocs(app)[0];
  };

  it("a name-only edit keeps the stored monthly payment (it used to be re-derived from the drifted balance)", async () => {
    const doc = await editLoan((app) => d.fill(app, /^Loan Name/, "Car Loan (renamed)"));
    expect(doc.name).toBe("Car Loan (renamed)");
    expect(doc.loanConfig.monthlyPayment).toBe(STORED);
    expect(doc.amount).toBe(STORED);
    expect(doc.loanConfig.currentBalance).toBe(11_000);
    expect(doc.loanConfig.paymentsMade).toBe(1);
  });

  it("the wizard shows the kept payment while editing (the Details step headline is the stored one)", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY, seed: seed() });
    await d.openEdit(app, "Car Loan");
    await d.next(app);
    expect(screen.getByText("Calculated Monthly Payment").nextElementSibling!.textContent).toMatch(/564\.88/);
  });

  it("changing only the schedule (weekend adjustment) keeps the payment too", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY, seed: seed() });
    await d.openEdit(app, "Car Loan");
    await d.next(app);
    await d.next(app);
    await d.applyExpenseSchedule(app, { weekend: "after" });
    await d.saveEdit(app);
    const doc = d.ruleDocs(app)[0];
    expect(doc.weekendAdjustment).toBe("after");
    expect(doc.loanConfig.monthlyPayment).toBe(STORED);
  });

  it("changing the current balance re-derives the payment from it over the 23 remaining months", async () => {
    const doc = await editLoan((app) => d.fill(app, /^Current Balance/, "10000"));
    expect(doc.loanConfig.currentBalance).toBe(10_000);
    expect(doc.loanConfig.monthlyPayment).toBeCloseTo(d.pmt(10_000, 12, 23), 6);
  });

  it("changing a term that affects the payment (the rate) re-derives it", async () => {
    const doc = await editLoan((app) => d.fill(app, /^Annual Interest Rate/, "6"));
    expect(doc.loanConfig.monthlyPayment).toBeCloseTo(d.pmt(11_000, 6, 23), 6);
  });
});

// ===========================================================================
describe("M7: a loan has ONE first-payment date", () => {
  it("the Details step has no 'Loan Start Date'; its date is the First Payment Date, which drives the schedule", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.openExpenseForm(app);
    await app.user.click(screen.getByRole("heading", { name: "Loan" }));
    await d.next(app);
    expect(screen.queryByLabelText(/Loan Start Date/)).toBeNull();
    await d.fillExpenseDetails(app, { kind: "Loan", principal: "1200", rate: "0", term: "12", start: "2026-03-20" });
    // the amortisation table's first payment IS the date typed
    expect(amortDates()[0]).toBe("3/20/2026");
    expect(amortDates()[1]).toBe("4/20/2026");

    // the next step shows the SAME date, and its preview starts there
    await d.next(app);
    expect((screen.getByLabelText(/^First Payment Date/) as HTMLInputElement).value).toBe("03/20/2026");
    expect(d.previewCards()[0]).toBe(d.label("2026-03-20"));

    // and what is saved agrees: one date everywhere
    const doc = await d.finishExpense(app, {});
    expect(doc.startDate).toBe("2026-03-20");
    expect(doc.loanConfig.firstPaymentDate).toBe("2026-03-20");
    expect(doc.loanConfig.loanStartDate).toBe("2026-03-20");
    expect(d.engineDates(app, doc.id)[0]).toBe("2026-03-20");
  });

  it("changing the date on the Schedule step moves the Details table with it (they are one field)", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, { kind: "Loan", principal: "1200", rate: "0", term: "12", start: "2026-03-20" });
    await d.applyExpenseSchedule(app, { start: "2026-04-05" });
    await app.user.click(screen.getByRole("button", { name: "Back" }));
    expect(amortDates()[0]).toBe("4/5/2026");
  });
});

// ===========================================================================
describe("L8: schedule previews match what the engine generates", () => {
  it("a one-time expense shows its single date (it showed no preview at all)", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, { kind: "One-time", amount: "250", start: "2026-02-14" });
    expect(d.previewCards()).toEqual([d.label("2026-02-14")]);
    const doc = await d.finishExpense(app, {});
    expect(d.engineDates(app, doc.id)).toEqual(["2026-02-14"]);
  });

  it("a card that pays its full balance previews ONE payment, not three monthly ones", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, {
      kind: "Credit Card",
      balance: "5000",
      apr: "12",
      dueDate: "20",
      strategy: "Pay Full Balance",
      start: "2026-02-10",
      weekend: "none",
    });
    expect(d.previewCards()).toEqual([d.label("2026-02-20")]);
    const doc = await d.finishExpense(app, {});
    expect(d.engineDates(app, doc.id)).toEqual(["2026-02-20"]);
  });

  it("a card with a fixed payment that clears it in two months previews two payments", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, {
      kind: "Credit Card",
      balance: "1000",
      apr: "0",
      dueDate: "20",
      strategy: "Fixed Amount",
      fixedPayment: "500",
      start: "2026-02-10",
      weekend: "none",
    });
    expect(d.previewCards()).toEqual(["2026-02-20", "2026-03-20"].map(d.label));
    const doc = await d.finishExpense(app, {});
    expect(d.engineDates(app, doc.id)).toEqual(["2026-02-20", "2026-03-20"]);
  });

  it("income: a one-time source and a daily source with an end date both preview exactly what the engine pays", async () => {
    // (these already worked at HEAD: pinned here because the audit reported them empty)
    const one = await renderApp({ route: "/income", today: TODAY });
    await d.fillIncomeToSchedule(one, { frequency: "One-time", start: "2026-02-10", weekend: "none" });
    expect(d.previewCards()).toEqual([d.label("2026-02-10")]);
    const oneDoc = await d.finishIncome(one, {});
    expect(d.engineDates(one, oneDoc.id)).toEqual(["2026-02-10"]);
  });
});

// ===========================================================================
describe("(f) the preview says when a weekend adjustment moved a payment", () => {
  it("Sun 1 Nov paid on Fri 30 Oct shows '(moved from Sun Nov 1)'; an unmoved payday shows no hint", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, {
      kind: "Fixed Recurring",
      frequency: "Monthly",
      start: "2026-11-01",
      weekend: "before",
    });
    expect(d.previewCards().slice(0, 2)).toEqual(["Oct 30 Fri", "Dec 1 Tue"]);
    expect(screen.getAllByText(/moved from/)).toHaveLength(1);
    expect(screen.getByText("(moved from Sun Nov 1)")).toBeInTheDocument();
  });
});

// ===========================================================================
describe("(a) a zero or negative amount says why Continue is disabled", () => {
  it("expense: Amount 0 and -5 show 'Amount must be greater than 0'", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.openExpenseForm(app);
    await app.user.click(screen.getByRole("heading", { name: "Fixed Recurring" }));
    await d.next(app);
    await d.fillExpenseDetails(app, { kind: "Fixed Recurring", name: "Rent", amount: "0" });
    expect(await screen.findByText("Amount must be greater than 0")).toBeInTheDocument();
    expect(d.nextButton()).toBeDisabled();
    await d.fill(app, /^Amount/, "-5");
    expect(await screen.findByText("Amount must be greater than 0")).toBeInTheDocument();
    await d.fill(app, /^Amount/, "5");
    expect(screen.queryByText("Amount must be greater than 0")).toBeNull();
    expect(d.nextButton()).toBeEnabled();
  });

  it("expense: a zero loan principal and a zero installment total say so too", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.openExpenseForm(app);
    await app.user.click(screen.getByRole("heading", { name: "Loan" }));
    await d.next(app);
    await d.fillExpenseDetails(app, { kind: "Loan", principal: "0", rate: "5", term: "12" });
    expect(await screen.findByText("Principal must be greater than 0")).toBeInTheDocument();
    expect(d.nextButton()).toBeDisabled();
  });

  it("income: Amount 0 shows 'Amount must be greater than 0'", async () => {
    const app = await renderApp({ route: "/income", today: TODAY });
    await d.openIncomeForm(app);
    await app.user.click(screen.getByRole("heading", { name: "Salary" }));
    await d.next(app);
    await d.fill(app, /^Source Name/, "Pay");
    await d.fill(app, /^Amount/, "0");
    expect(await screen.findByText("Amount must be greater than 0")).toBeInTheDocument();
    expect(d.nextButton()).toBeDisabled();
  });
});

// ===========================================================================
describe("(b)(c)(d) review steps and detail cards", () => {
  it("income review lists the chosen semi-monthly days, in one wording ('Semi-monthly', 'Pay on Friday if weekend')", async () => {
    const app = await renderApp({ route: "/income", today: TODAY });
    await d.fillIncomeToSchedule(app, {
      frequency: "Semi-monthly (e.g., 15th & 30th)",
      start: "2026-02-02",
      specificDays: [10, 25],
      weekend: "before",
    });
    await d.next(app);
    await screen.findByText("Review & Confirm");
    expect(field("Schedule")).toBe("On the 10th and 25th of each month");
    expect(field("Frequency")).toBe("Semi-monthly");
    expect(field("Weekend Adjustment")).toBe("Pay on Friday if weekend");
    expect(document.body.textContent).not.toMatch(/semi monthly/i);
    expect(document.body.textContent).not.toMatch(/Pay before/i);
  });

  it("the income detail card says the same thing as the wizard about weekends", async () => {
    const app = await renderApp({ route: "/income", today: TODAY });
    await d.createIncome(app, { frequency: "Monthly", start: "2026-02-02", weekend: "before" });
    expect(field("Weekend Handling")).toBe("Pay on Friday if weekend");
  });

  it("the expense detail card words weekends like the wizard ('Pay on Monday if weekend')", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, {
      kind: "Variable",
      frequency: "Semi-monthly",
      start: "2026-02-02",
      specificDays: [10, 25],
      weekend: "after",
    });
    await d.finishExpense(app, {});
    expect(field("Weekend Handling")).toBe("Pay on Monday if weekend");
  });

  it("an installment plan's review shows the total, the number of payments and the last payment date", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, {
      kind: "Installment",
      total: "1200",
      count: "12",
      start: "2026-02-10",
      weekend: "none",
    });
    await d.next(app);
    await screen.findByText("Review & Confirm");
    expect(field("Total Amount")).toMatch(/1,200\.00/);
    expect(field("Number of Payments")).toBe("12");
    // Feb 10 2026 + 11 months = Jan 10 2027
    expect(field("Last Payment")).toBe("1/10/2027");
    expect(field("Schedule")).toBe("On the 10th of each month");
  });

  it("an installment plan's detail card ends on its last payment date, not 'Ongoing'", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.createExpense(app, { kind: "Installment", total: "1200", count: "12", start: "2026-02-10", weekend: "none" });
    expect(field("End Date")).toBe("1/10/2027");
    expect(field("First Payment Date")).toBe("2/10/2026");
  });

  it("a loan's detail card ends on its last scheduled payment too (24 months from Feb 10 2026 = Jan 10 2028)", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.createExpense(app, { kind: "Loan", principal: "12000", rate: "12", term: "24", start: "2026-02-10", weekend: "none" });
    expect(field("End Date")).toBe("1/10/2028");
  });
});

// ===========================================================================
describe("(e) the card wizard warns about the minimum-payment trap", () => {
  it("5,000 at 24% with a 2% minimum (100 a month vs 100 of interest) warns on the Details step and the Review", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, { kind: "Credit Card", balance: "5000", apr: "24", start: "2026-02-10" });
    await app.user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Minimum-payment trap")).toBeInTheDocument();
    await d.next(app);
    await d.next(app);
    await screen.findByText("Review & Confirm");
    expect(screen.getByText("Minimum-payment trap")).toBeInTheDocument();
  });

  it("no warning when the payment clearly beats the interest (5,000 at 12%, 2% minimum = 100 vs 50 interest)", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, { kind: "Credit Card", balance: "5000", apr: "12", start: "2026-02-10" });
    await app.user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByText("Minimum-payment trap")).toBeNull();
  });

  it("the warning follows the Payment Strategy: a fixed 1,000 on the 24% card clears it", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.openExpenseForm(app);
    await app.user.click(screen.getByRole("heading", { name: "Credit Card" }));
    await d.next(app);
    await d.fillExpenseDetails(app, { kind: "Credit Card", balance: "5000", apr: "24" });
    expect(screen.getByText("Minimum-payment trap")).toBeInTheDocument();
    await d.fillExpenseDetails(app, { kind: "Credit Card", balance: "5000", apr: "24", strategy: "Fixed Amount", fixedPayment: "1000" });
    expect(screen.queryByText("Minimum-payment trap")).toBeNull();
  });
});

// ===========================================================================
describe("raw category codes in the managers", () => {
  it("Upcoming Bills shows 'Debt Payment', never 'debt_payment'", async () => {
    await renderApp({
      route: "/expenses",
      today: TODAY,
      seed: {
        expenseRules: [
          makeExpenseRule({ id: "r1", name: "Card Payoff", category: "debt_payment", amount: 300, frequency: "monthly", startDate: "2026-01-20", scheduleConfig: { dayOfMonth: 20 } }),
        ],
      },
    });
    expect(await screen.findByText("Debt Payment", { selector: "p" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/debt_payment/i);
  });
});
