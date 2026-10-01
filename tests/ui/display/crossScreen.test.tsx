import { describe, expect, it, vi } from "vitest";
import { knownDefect } from "../harness";
import { H1, H1_TODAY, h1Seed } from "./households";
import {
  amounts,
  card,
  colorToken,
  dayCellBalance,
  healthComponent,
  healthScore,
  money,
  openTab,
  renderPages,
  stat,
  within,
} from "./screens";

// Load-tolerant: a cold first render can exceed the default 20s on a busy machine.
vi.setConfig({ testTimeout: 90_000 });

/**
 * CROSS-SCREEN CONSISTENCY on household H1 (see households.ts for every hand
 * value). All five screens are mounted under ONE FinancialContext, so each test
 * compares what different screens print for the same household.
 */

const ALL = ["dashboard", "calendar", "forecast", "income", "expenses"] as const;

const mountH1 = (overrides: Parameters<typeof renderPages>[1] = {}) =>
  renderPages([...ALL], { today: H1_TODAY, seed: h1Seed(), ...overrides });

describe("H1 March 2026: totals every screen prints", () => {
  it("income, expenses and net for March agree on Dashboard, Calendar and Forecast", async () => {
    const { app, page } = await mountH1();
    // Preconditions: the household really loaded (2 sources, 7 rules, 16 stored rows).
    expect(app.financial().incomeSources).toHaveLength(2);
    expect(app.financial().expenseRules).toHaveLength(7);
    expect(app.store.__count("transactions")).toBe(16);
    expect(app.financial().userProfile?.currentBalance).toBe(H1.currentBalance);

    // Dashboard "Period Summary" (2 decimals).
    const kpi = card(page("dashboard"), "Period Summary");
    expect(money(kpi, "Total Income")).toBe(5_120); // 2000+2000+820+300
    expect(money(kpi, "Total Expenses")).toBe(-2_930.83); // 2,930.8317
    expect(money(kpi, "Net Flow")).toBe(2_189.17); // 2,189.1683

    // Calendar summary tiles print whole dollars.
    const cal = page("calendar");
    expect(money(cal, "Income", { occurrence: 0 })).toBe(5_120);
    expect(money(cal, "Expenses", { occurrence: 0 })).toBe(-2_931);
    expect(money(cal, "Net Change", { occurrence: 0 })).toBe(2_189);

    // Calendar sidebar "Monthly range" (0-2 decimals).
    const side = card(cal, "Monthly range");
    expect(money(side, "Income")).toBe(5_120);
    expect(money(side, "Expenses")).toBe(-2_930.83);

    // Forecast "Budgeted vs Actual" Actual column.
    const fc = card(page("forecast"), /Budgeted vs Actual/);
    expect(money(fc, "Actual", { occurrence: 0 })).toBe(5_120);
    expect(money(fc, "Actual", { occurrence: 1 })).toBe(2_930.83);
    expect(money(fc, "Actual", { occurrence: 2 })).toBe(2_189.17);
    // Forecast "Actual Savings Rate": 2,189.1683 / 5,120 = 42.757% -> 42.8%
    expect(within(page("forecast")).getAllByText("42.8%").length).toBeGreaterThanOrEqual(1);
  });

  it("transaction counts: Dashboard subtitles and Calendar 'Transactions' tile agree", async () => {
    const { page } = await mountH1();
    const kpi = card(page("dashboard"), "Period Summary");
    // income: Payroll Mar15 + Freelance Mar10 + Gift = 3 completed; Payroll Mar30 = 1 projected
    expect(within(kpi).getByText("3 completed, 1 projected")).toBeInTheDocument();
    // expense: Rent + 2 groceries = 3 completed; groc x2, power, loan, card, laptop, dentist = 7
    expect(within(kpi).getByText("3 completed, 7 projected")).toBeInTheDocument();
    // Calendar: 6 completed of 14 (skipped Feb freelance is not in March)
    const tile = card(page("calendar"), "Transactions");
    expect(tile.textContent?.replace(/\s+/g, " ")).toContain("6 / 14");
  });

  it("Current Balance is identical on Dashboard and Forecast and equals initial + completed net", async () => {
    const { page } = await mountH1();
    // 5,000 + 13,470 completed income - 4,500.95 completed expense = 13,969.05
    expect(money(card(page("dashboard"), "Period Summary"), "Current Balance")).toBe(13_969.05);
    expect(money(page("forecast"), "Current Balance")).toBe(13_969.05);
  });

  it("Projected-vs-Actual widget: actual = completed rows, projected = plan for every non-skipped row", async () => {
    const { page } = await mountH1();
    const pva = card(page("dashboard"), "Projected vs Actual");
    // income actual 2000+820+300 = 3,120; planned 2000+2000+750+300 = 5,050 (freelance planned 750)
    // expense actual 1200+138.40+162.55 = 1,500.95; planned 1200+4*150+90+564.8817+25+200+250 = 2,929.8817
    expect(amounts(pva)).toEqual([3_120, 5_050, 1_500.95, 2_929.88]);
    expect(within(pva).getByText(/62\s*%\s*collected/)).toBeInTheDocument(); // 3120/5050 = 61.8%
    expect(within(pva).getByText(/51\s*%\s*spent/)).toBeInTheDocument(); // 1500.95/2929.88 = 51.2%
  });

  it("Upcoming Activity (next 14 days) totals and the Expense/Income 30-day widgets", async () => {
    const { page } = await mountH1({ timeZone: "UTC" });
    // REWRITTEN (14-day decision: "Next N days" is exactly N days, today .. today + N - 1).
    // Mar16..Mar29: Payroll Mar30 is day 15 and is OUT, so income 0.
    // expenses Mar18 90 + Mar20 564.8817 + Mar21 150 + Mar22 25 + Mar25 200 + Mar27 250 + Mar28 150 = 1,429.8817
    const upc = card(page("dashboard"), /Upcoming Activity/);
    expect(amounts(upc).slice(0, 3)).toEqual([0, -1_429.88, -1_430]); // net -1,429.8817 prints as -$1,430
    // Expenses page, 30 days (Mar16..Apr14): 1,429.8817 + Rent Apr1 1,200 + Groc Apr4 150 + Apr11 150 = 2,929.8817
    expect(money(card(page("expenses"), "Upcoming Bills"), "Total Due")).toBe(2_929.88);
    // Income page, 30 days (Mar16..Apr14): Payroll Mar30 2,000 + Freelance Apr10 750 = 2,750
    // (Payroll Apr15 is day 31 and is out; it used to make this 4,750)
    expect(money(card(page("income"), "Upcoming Payments"), "Total Expected")).toBe(2_750);
  });

  it("category views agree: pie total, legend order and Forecast top categories", async () => {
    const { page } = await mountH1();
    // housing 1,200; food 138.40+162.55+150+150 = 600.95; debt 564.8817+25 = 589.8817;
    // healthcare 250; personal 200; utilities 90  (sum 2,930.8317)
    const pie = card(page("dashboard"), /Spending by Category/);
    expect(money(pie, "Total")).toBe(2_931);
    const legend = ["housing", "food", "debt_payment", "healthcare", "personal", "Other"];
    for (const name of legend) expect(within(pie).getByText(name)).toBeInTheDocument();
    // Forecast lists the top 5 categories with cents.
    const overview = card(page("forecast"), "Monthly Overview");
    expect(amounts(within(overview).getByText("housing").closest("div")!.parentElement!)).toEqual([
      1_200,
    ]);
    expect(within(overview).getByText("food")).toBeInTheDocument();
    expect(overview.textContent).toContain("$600.95");
    expect(overview.textContent).toContain("$589.88");
  });

  it("Recurring Summary (Dashboard) and the Income / Expense pages count the same March occurrences", async () => {
    const { page } = await mountH1();
    const rec = card(page("dashboard"), "Recurring Summary");
    // REWRITTEN (occurrence counting, no amount x multiplier). March 2026 RECURRING rows:
    // income: payroll Mar 15 2,000 + Mar 30 2,000 + freelance Mar 10 (paid 820, not the planned 750) = 4,820
    // expense: rent 1,200 + groceries Mar 7 138.40 + Mar 14 162.55 + Mar 21 150 + Mar 28 150 (= 600.95)
    //          + power 90 + loan 564.8817 + card 25 + laptop 200 = 2,680.8317 (one-time dentist excluded)
    expect(money(rec, "Monthly Income")).toBe(4_820);
    expect(money(rec, "Monthly Expenses")).toBe(2_681);
    expect(money(rec, "Net Recurring")).toBe(2_139); // 4,820 - 2,680.8317 = 2,139.1683
    expect(money(page("income"), "Monthly Recurring")).toBe(4_820);
    // next 12 months: payroll 24 x 2,000 + freelance 12 x 750 = 57,000
    expect(money(page("income"), "Annual Projection")).toBe(57_000);
    expect(money(page("expenses"), "Monthly Recurring")).toBe(2_681);
    expect(money(page("expenses"), "One-time")).toBe(250);
    expect(stat(page("expenses"), "Active Expenses")).toBe("7");
    expect(stat(page("expenses"), "Priority Bills")).toBe("1");
    expect(stat(page("income"), "Active Sources")).toBe("2");
  });

  it("Health score components for a clean household are derived from the hand-checked inputs", async () => {
    const { page } = await mountH1({ timeZone: "UTC" });
    const hs = card(page("dashboard"), "Financial Health");
    // runway: no negative balance in 90 days -> 100.  savings 42.8% >= 30% -> 100.
    // bills: rent + 2 groceries due on/before today are all completed on time -> 100%.
    expect(healthComponent(hs, "Cash Runway")).toBe(100);
    expect(healthComponent(hs, "Savings Rate")).toBe(100);
    expect(healthComponent(hs, "Bill Payments")).toBe(100);
    // balance rises through March, so the trend is "improving" (>= 70)
    const trend = healthComponent(hs, "Balance Trend");
    expect(trend).toBeGreaterThanOrEqual(70);
    // overall = 0.3*100 + 0.3*100 + 0.2*100 + 0.2*trend, i.e. 94..100 -> grade A
    const { score, grade } = healthScore(hs);
    expect(score).toBe(Math.round(80 + 0.2 * trend));
    expect(grade).toBe("A");
  });

  it("colours follow good/bad: positive net is green, expense growth is red, negative balance is red", async () => {
    const { page } = await mountH1();
    const kpi = card(page("dashboard"), "Period Summary");
    expect(colorToken(within(kpi).getByText("+$2,189.17"))).toBe("success");
    expect(colorToken(within(kpi).getByText("-$2,930.83"))).toBe("danger");
    expect(colorToken(within(kpi).getByText("$13,969.05"))).toBe("white");
  });
});

describe("H1 calendar day-by-day movement (replay within the window is correct)", () => {
  it("consecutive day cells move by exactly the transactions of that day", async () => {
    const { page } = await mountH1();
    const cal = page("calendar");
    // Whatever the absolute level, Mar 17 -> Mar 20 must drop by Electricity 90 + Loan 564.8817 = 654.8817.
    const d17 = dayCellBalance(cal, 17);
    const d18 = dayCellBalance(cal, 18);
    const d20 = dayCellBalance(cal, 20);
    expect(Math.round(d17 - d18)).toBe(90);
    expect(Math.round(d18 - d20)).toBe(565); // 564.8817 (rounded displays differ by <= 1)
    // Mar 29 -> Mar 30: + Payroll 2,000
    expect(dayCellBalance(cal, 30) - dayCellBalance(cal, 29)).toBe(2_000);
  });
});

describe("H1 pre-window history (completed before the default window, Dec 2025: +1,500 bonus, -600 flights = +900)", () => {
  it(
    "UI-DISP-01 — Calendar month opening balance loses completed history from before the default window",
    async () => {
      // observed: Opening $11,450 (= 12,350 - 900). The pre-window rows are subtracted from the
      // opening and never replayed because the day loop starts at the window start.
      const { page } = await mountH1();
      // preconditions: Dashboard's Current Balance is the hand value, and March is on screen
      expect(money(card(page("dashboard"), "Period Summary"), "Current Balance")).toBe(13_969.05);
      expect(within(page("calendar")).getByText("March 2026")).toBeInTheDocument();
      // correct: 5,000 initial + 900 pre-window + 3,700 (Jan) + 2,750 (Feb) = 12,350
      expect(money(page("calendar"), "Opening", { occurrence: 0 })).toBe(12_350);
    }
  );

  it(
    "UI-DISP-02 — Calendar month closing balance is short by the same pre-window history",
    async () => {
      // observed: Closing $13,639 / $13,639.17 (sidebar); correct 12,350 + 2,189.1683 = 14,539.17
      const { page } = await mountH1();
      expect(money(card(page("calendar"), "Monthly range"), "Expenses")).toBe(-2_930.83); // precondition
      expect(money(page("calendar"), "Closing", { occurrence: 0 })).toBe(14_539);
      expect(money(card(page("calendar"), "Monthly range"), "Closing")).toBe(14_539.17);
    }
  );

  it(
    "UI-DISP-03 — Calendar balance for today (no rows dated after the last completed one) differs from Current Balance",
    async () => {
      // observed: today's cell $13,069 vs Current Balance $13,969.05 (900 short). With nothing overdue
      // and nothing completed after Mar 15, the balance on Mar 15 and Mar 16 IS the current balance.
      const { page } = await mountH1();
      expect(money(card(page("dashboard"), "Period Summary"), "Current Balance")).toBe(13_969.05);
      const cal = page("calendar");
      expect(dayCellBalance(cal, 15)).toBe(13_969);
      expect(dayCellBalance(cal, 16)).toBe(13_969);
    }
  );

  it(
    "UI-DISP-04 — Dashboard cash-flow change badge disagrees with the Period Summary net flow of the same period",
    async () => {
      // observed: badge +$3,389 (+33.1%) vs Net Flow +$2,189.17. 'Opening' is Mar 1's CLOSING balance,
      // so Mar 1's rent (-1,200) is missing from the change.  (Independent of the pre-window bug: the
      // 900 offset cancels in a difference.)
      const { page } = await mountH1();
      const dash = page("dashboard");
      expect(money(card(dash, "Period Summary"), "Net Flow")).toBe(2_189.17); // precondition
      const chart = card(dash, /Projected Cash Flow/);
      const closing = money(chart, "Closing");
      const opening = money(chart, "Opening");
      expect(closing - opening).toBe(2_189); // closing - opening must equal the period's net (rounded)
    }
  );

  it("Dashboard Bills tab projected balance equals current balance + income - bills in the next 14 days", async () => {
    const { app, page } = await mountH1({ timeZone: "UTC" });
    await openTab(app, page("dashboard"), /Bills/);
    const upc = card(page("dashboard"), /Upcoming Activity/);
    // REWRITTEN (14-day decision): the window is Mar 16 .. Mar 29, so the Mar 30 payroll (+2,000) is
    // outside it. 13,969.05 - 1,429.8817 = 12,539.1683
    expect(money(upc, "Projected Balance")).toBe(12_539.17);
  });

  it(
    "UI-DISP-05 — Calendar balance on the last day of the bill-coverage window agrees with the Bills tab projected balance",
    async () => {
      // Both describe the balance after the last day of the 14-day window (today + 13 = Mar 29).
      // observed before the fix: Calendar $13,639 vs Bills tab $14,539.17 (900 of pre-window history
      // missing, and a 15-day window). REWRITTEN for the exact 14-day window: Mar 29 is its last day.
      const { app, page } = await mountH1({ timeZone: "UTC" });
      await openTab(app, page("dashboard"), /Bills/);
      const projected = money(card(page("dashboard"), /Upcoming Activity/), "Projected Balance");
      expect(projected).toBe(12_539.17); // 13,969.05 - 1,429.8817: the Bills tab
      expect(dayCellBalance(page("calendar"), 29)).toBe(12_539); // the whole-dollar day chip
    }
  );
});

describe("Forecast vs Expenses page", () => {
  it(
    "UI-DISP-06 — Forecast 'Total Debt' omits installment plans that the Expenses page counts as debt",
    async () => {
      // observed: Forecast $13,000 (loan 12,000 + card 1,000) vs Expenses $14,200 (also 6 x 200 BNPL).
      const { page } = await mountH1();
      // hand: 12,000 + 1,000 + (6 installments - 0 paid) * 200 = 14,200
      expect(money(page("expenses"), "Total Debt")).toBe(14_200);
      expect(money(page("forecast"), "Total Debt")).toBe(14_200);
    }
  );

  it("Forecast 'Budgeted' is the PLAN of the period: every scheduled row, the one-time Dentist 250 included", async () => {
    // REWRITTEN (occurrence counting; it asserted the amount x multiplier estimate and that the
    // one-time dentist is excluded). The budget must cover the same rows the actuals cover, or a
    // paid dentist shows as 250 "over budget". The plan is every non-skipped row scheduled in March
    // at its projected amount (the same plan the Projected vs Actual widget shows):
    // income: payroll 2,000 x 2 + freelance 750 + the 300 birthday gift = 5,050
    // expenses: rent 1,200 + groceries 4 x 150 + power 90 + loan 564.8817 + card 25 + laptop 200
    //           + dentist 250 = 2,929.8817
    const { page } = await mountH1();
    const fc = card(page("forecast"), /Budgeted vs Actual/);
    expect(money(fc, "Budgeted", { occurrence: 0 })).toBe(5_050);
    expect(money(fc, "Budgeted", { occurrence: 1 })).toBe(2_929.88);
    expect(money(fc, "Budgeted", { occurrence: 2 })).toBe(2_120.12); // 5,050 - 2,929.8817 = 2,120.1183
  });
});
