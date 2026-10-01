import { describe, expect, it, vi } from "vitest";
import {
  knownDefect,
  makeCompletedTransaction,
  makeExpenseRule,
  makeIncomeSource,
  makeInstallmentRule,
  makeCreditRule,
  makeManualTransaction,
} from "../harness";
import type { IncomeFrequency } from "@/lib/types";
import type { AppSeed } from "../harness";
import { H1_TODAY, h1Seed } from "./households";
import {
  amounts,
  card,
  changeChip,
  colorToken,
  healthComponent,
  healthScore,
  money,
  renderPages,
  stat,
  within,
  yAxisLabels,
} from "./screens";

// Load-tolerant: a cold first render can exceed the default 20s on a busy machine.
vi.setConfig({ testTimeout: 90_000 });

const manual = (
  id: string,
  type: "income" | "expense",
  amount: number,
  date: string,
  status: "completed" | "projected" = "projected",
  extra: Record<string, unknown> = {}
) =>
  makeManualTransaction({
    id,
    name: id,
    type,
    projectedAmount: amount,
    scheduledDate: date,
    status,
    ...(status === "completed" ? { actualAmount: amount, actualDate: date } : {}),
    ...extra,
  });

const dash = async (seed: AppSeed, today = H1_TODAY, tz?: string) => {
  const r = await renderPages(["dashboard"], { today, seed, ...(tz ? { timeZone: tz } : {}) });
  return { ...r, d: r.page("dashboard") };
};

// ---------------------------------------------------------------------------
// H2 "Clean month": no history at all, today = Mar 1, so the calendar/cash-flow bugs
// that depend on pre-window history or overdue rows cannot interfere.
//   current balance 10,000 (initial 10,000, nothing completed)
//   Rent 1,200 monthly on Mar 1 (projected, due today)      Salary 3,000 monthly on Mar 15 (projected)
//   March: income 3,000, expenses 1,200, net +1,800.  opening 10,000, closing 11,800 (18.0% up)
// ---------------------------------------------------------------------------
const h2Seed = () => ({
  profile: { currentBalance: 10_000, initialBalance: 10_000 },
  incomeSources: [
    makeIncomeSource({ id: "sal", name: "Salary", amount: 3_000, startDate: "2026-03-15" }),
  ],
  expenseRules: [
    makeExpenseRule({ id: "rent", name: "Rent", amount: 1_200, startDate: "2026-03-01" }),
  ],
});
const H2_TODAY = "2026-03-01";

describe("Dashboard KPI cards", () => {
  it("H2 clean month: totals, counts and net are the hand values", async () => {
    const { d, app } = await dash(h2Seed(), H2_TODAY);
    expect(app.financial().transactions.map((t) => t.scheduledDate)).toEqual(
      expect.arrayContaining(["2026-03-01", "2026-03-15"])
    ); // precondition: both March rows were projected
    const kpi = card(d, "Period Summary");
    expect(money(kpi, "Current Balance")).toBe(10_000);
    expect(money(kpi, "Total Income")).toBe(3_000);
    expect(money(kpi, "Total Expenses")).toBe(-1_200);
    expect(money(kpi, "Net Flow")).toBe(1_800);
    expect(within(kpi).getAllByText("0 completed, 1 projected")).toHaveLength(2); // income and expense
    expect(within(kpi).getByText("Surplus for period")).toBeInTheDocument();
  });

  it("a deficit period is labelled and coloured as a deficit", async () => {
    // one completed 200 expense today, balance already net of it
    const { d } = await dash({
      profile: { currentBalance: 100, initialBalance: 300 },
      transactions: [manual("bill", "expense", 200, "2026-03-16", "completed")],
    });
    const kpi = card(d, "Period Summary");
    expect(money(kpi, "Net Flow")).toBe(-200);
    expect(within(kpi).getByText("Deficit for period")).toBeInTheDocument();
    const netValue = within(kpi).getByText("Net Flow").closest("div.p-3")!.querySelector("h2")!;
    expect(netValue.textContent).toBe("-$200.00");
    expect(colorToken(netValue)).toBe("danger");
    expect(within(kpi).getAllByText("1 completed, 0 projected").length).toBe(1);
  });

  it("a negative balance is flagged with the warning subtitle and red value", async () => {
    const { d } = await dash({ profile: { currentBalance: -400, initialBalance: 0 } });
    const kpi = card(d, "Period Summary");
    expect(money(kpi, "Current Balance")).toBe(-400);
    expect(within(kpi).getByText("Negative balance!")).toBeInTheDocument();
    expect(colorToken(within(kpi).getByText("-$400.00"))).toBe("danger");
  });

  it("completed rows use the actual amount, skipped rows are ignored, a 0.00 actual counts as 0", async () => {
    const { d } = await dash({
      profile: { currentBalance: 10_000, initialBalance: 10_000 },
      transactions: [
        manual("paid-more", "expense", 100, "2026-03-05", "completed", { actualAmount: 140 }),
        manual("waived", "expense", 60, "2026-03-06", "completed", { actualAmount: 0 }),
        manual("skip", "expense", 999, "2026-03-07", "projected", { status: "skipped" }),
      ],
    });
    const kpi = card(d, "Period Summary");
    // expenses = 140 + 0 (skipped 999 ignored) = 140
    expect(money(kpi, "Total Expenses")).toBe(-140);
    expect(within(kpi).getByText("2 completed, 0 projected")).toBeInTheDocument();
  });
});

describe("Dashboard cash-flow chart card", () => {
  it("H2 (no history): closing balance equals the hand value 11,800", async () => {
    const { d } = await dash(h2Seed(), H2_TODAY);
    expect(money(card(d, /Projected Cash Flow/), "Closing")).toBe(11_800); // 10,000 - 1,200 + 3,000
  });

  it(
    "UI-DISP-15 — 'Opening' on the cash-flow card is the FIRST DAY'S CLOSING balance, so it excludes day 1's own activity",
    async () => {
      // observed: Opening $8,800 (Mar 1 after rent), change +$3,000 (+34.1%).
      // correct: Opening $10,000, change +$1,800 (+18.0%) == the Period Summary net flow.
      const { d } = await dash(h2Seed(), H2_TODAY);
      expect(money(card(d, "Period Summary"), "Net Flow")).toBe(1_800); // precondition
      const chart = card(d, /Projected Cash Flow/);
      expect(money(chart, "Closing")).toBe(11_800); // precondition
      expect(money(chart, "Opening")).toBe(10_000);
    }
  );

  it(
    "UI-DISP-16 — cash-flow change badge for a month starting with a bill (H2) shows +$3,000 (+34.1%) instead of +$1,800 (+18.0%)",
    async () => {
      const { d } = await dash(h2Seed(), H2_TODAY);
      const chart = card(d, /Projected Cash Flow/);
      expect(money(chart, "Closing")).toBe(11_800); // precondition
      expect(amounts(chart)[0]).toBe(1_800);
      expect(chart.textContent).toContain("18.0");
    }
  );

  it(
    "UI-DISP-17 — negative Y-axis ticks are rendered '$-2.7k' (sign after the currency symbol)",
    async () => {
      // observed labels: "$-2.7k", "$-2.3k", "$-1.8k", "$-1.4k", "$-0.9k"
      const { d } = await dash({
        profile: { currentBalance: -1_000, initialBalance: -1_000 },
        transactions: [
          manual("a", "expense", 500, "2026-03-20"),
          manual("b", "expense", 500, "2026-03-25"),
          manual("c", "expense", 500, "2026-03-30"),
        ],
      });
      const labels = yAxisLabels(card(d, /Projected Cash Flow/));
      const negatives = labels.filter((l) => /-/.test(l));
      expect(negatives.length).toBeGreaterThan(0); // precondition: some ticks are negative
      expect(negatives.every((l) => /^-\$/.test(l))).toBe(true);
    }
  );

  it(
    "UI-DISP-18 — Y-axis ticks for very large balances are printed in thousands with 8 digits ('$10000000k') instead of M/B",
    async () => {
      // observed: "$0k", "$2500000k", "$5000000k", "$7500000k", "$10000000k"
      const { d } = await dash({
        profile: { currentBalance: 123_456_789.12, initialBalance: 1 },
        transactions: [manual("windfall", "income", 9_876_543_210.55, "2026-03-20")],
      });
      const labels = yAxisLabels(card(d, /Projected Cash Flow/));
      expect(labels.length).toBeGreaterThan(2); // precondition: ticks rendered
      expect(labels.some((l) => /\d{5,}k$/.test(l))).toBe(false);
    }
  );
});

describe("Dashboard period comparison", () => {
  const pc = (d: HTMLElement) => card(d, "Period Comparison");

  it("H1 (UTC): previous period is the same-length window ending the day before, and every 'was' is hand-checked", async () => {
    const { d } = await dash(h1Seed(), H1_TODAY, "UTC");
    const c = pc(d);
    // current March 1..31 (31 days) -> previous = 31 days ending Feb 28 = Jan 29 .. Feb 28
    expect(within(c).getByText("vs Jan 29 - Feb 28")).toBeInTheDocument();
    // prev income: Jan 30 payroll 2,000 + Feb 15 payroll 1,950 + Feb 28 payroll 2,000 = 5,950 (Feb 10 freelance skipped)
    // prev expenses: Rent Feb 1 = 1,200 (Jan 29..Jan 31: nothing)  -> prev net 4,750
    expect(money(c, "Total Income", { index: 1 })).toBe(5_950);
    expect(money(c, "Total Expenses", { index: 1 })).toBe(1_200);
    expect(money(c, "Net Flow", { index: 1 })).toBe(4_750);
    // percent changes: (5120-5950)/5950 = -13.95% ; (2930.8317-1200)/1200 = +144.24% ; (2189.1683-4750)/4750 = -53.91%
    const inc = changeChip(c, "Total Income");
    const exp = changeChip(c, "Total Expenses");
    const net = changeChip(c, "Net Flow");
    expect([inc.arrow, inc.percent, inc.color]).toEqual(["down", 13.9, "danger"]);
    expect([exp.arrow, exp.percent, exp.color]).toEqual(["up", 144.2, "danger"]); // spending more is bad
    expect([net.arrow, net.percent, net.color]).toEqual(["down", 53.9, "danger"]);
  });

  it("income growth is green, expense reduction is green", async () => {
    // Feb 10: income 1,000, expense 800. Mar 5: income 1,500, expense 400.
    const { d } = await dash({
      profile: { currentBalance: 10_000, initialBalance: 10_000 },
      transactions: [
        manual("i1", "income", 1_000, "2026-02-10", "completed"),
        manual("e1", "expense", 800, "2026-02-10", "completed"),
        manual("i2", "income", 1_500, "2026-03-05", "completed"),
        manual("e2", "expense", 400, "2026-03-05", "completed"),
      ],
    }, H1_TODAY, "UTC");
    const c = pc(d);
    const inc = changeChip(c, "Total Income");
    const exp = changeChip(c, "Total Expenses");
    const net = changeChip(c, "Net Flow");
    expect([inc.arrow, inc.percent, inc.color]).toEqual(["up", 50, "success"]); // +50%
    expect([exp.arrow, exp.percent, exp.color]).toEqual(["down", 50, "success"]); // -50%
    expect([net.arrow, net.percent, net.color]).toEqual(["up", 450, "success"]); // net 200 -> 1,100 = +450%
  });

  it(
    "UI-DISP-19 — a WORSENING net flow that is negative in both periods renders as a green up-arrow",
    async () => {
      // prev period (Jan 29-Feb 28): net -1,000. current March: net -1,500 (worse by 500).
      // observed: Net Flow chip "arrow_upward 50.0%" in green ((-1500 - -1000) / -1000 = +50%).
      const { d } = await dash({
        profile: { currentBalance: 10_000, initialBalance: 10_000 },
        transactions: [
          manual("feb", "expense", 1_000, "2026-02-10", "completed"),
          manual("mar", "expense", 1_500, "2026-03-05", "completed"),
        ],
      }, H1_TODAY, "UTC");
      const c = pc(d);
      expect(money(c, "Net Flow")).toBe(-1_500); // precondition: current net
      expect(money(c, "Net Flow", { index: 1 })).toBe(-1_000); // precondition: previous net
      const net = changeChip(c, "Net Flow");
      expect(net.arrow).toBe("down");
      expect(net.color).toBe("danger");
    }
  );

  it(
    "UI-DISP-20 — a net flow that got strictly worse from a $0 baseline shows the neutral '0%'",
    async () => {
      // prev net 0 (no data), current net -400. observed chip text "0%" (grey).
      const { d } = await dash({
        profile: { currentBalance: 10_000, initialBalance: 10_000 },
        transactions: [manual("mar", "expense", 400, "2026-03-05", "completed")],
      }, H1_TODAY, "UTC");
      const c = pc(d);
      expect(money(c, "Net Flow")).toBe(-400); // precondition
      expect(money(c, "Net Flow", { index: 1 })).toBe(0); // precondition
      expect(changeChip(c, "Net Flow").text).not.toBe("0%");
    }
  );

  it(
    "UI-DISP-21 — signed amounts drop the cents on the same screen that shows them elsewhere: income $1,234.56 prints '+$1,235'",
    async () => {
      // Period Summary prints +$1,234.56; Period Comparison prints +$1,235 for the same figure.
      const { d } = await dash({
        profile: { currentBalance: 10_000, initialBalance: 10_000 },
        transactions: [
          manual("in", "income", 1_234.56, "2026-03-05", "completed"),
          manual("out", "expense", 234.56, "2026-03-06", "completed"),
        ],
      }, H1_TODAY, "UTC");
      expect(money(card(d, "Period Summary"), "Total Income")).toBe(1_234.56); // precondition
      expect(money(pc(d), "Total Income")).toBe(1_234.56);
    }
  );

  it(
    "UI-DISP-22 — a tiny negative net flow (-$0.40) prints as '-$0' (sign taken from the unrounded value)",
    async () => {
      // observed: "-$0" in Period Comparison and Upcoming Activity; Period Summary prints -$0.40
      const { d } = await dash({
        profile: { currentBalance: 10_000, initialBalance: 10_000 },
        transactions: [manual("tiny", "expense", 0.4, "2026-03-05", "completed")],
      }, H1_TODAY, "UTC");
      expect(money(card(d, "Period Summary"), "Net Flow")).toBe(-0.4); // precondition
      expect(money(pc(d), "Net Flow")).toBe(-0.4);
    }
  );

  it.todo(
    "DECISION: previous period for a full-month selection is the same-length window (Jan 29 - Feb 28), not the previous calendar month (Feb 1 - Feb 28); which one does the product want?"
  );
  it("a zero baseline has no percent: new income shows an up-arrow 'new' in green, not an invented +100%", async () => {
    // RESOLVED (was a DECISION todo). Previous period (Jan 29 - Feb 28) is empty, March has a
    // completed 500 income: the move is "new", not a percentage.
    const { d } = await dash({
      profile: { currentBalance: 10_000, initialBalance: 9_500 },
      transactions: [manual("gig", "income", 500, "2026-03-05", "completed")],
    }, H1_TODAY, "UTC");
    const inc = changeChip(pc(d), "Total Income");
    expect([inc.arrow, inc.text.includes("new"), inc.color]).toEqual(["up", true, "success"]);
    expect(inc.percent).toBeNull();
  });
});

describe("Dashboard Projected vs Actual", () => {
  it("H2: nothing collected yet, plan equals the month's rows", async () => {
    const { d } = await dash(h2Seed(), H2_TODAY);
    const pva = card(d, "Projected vs Actual");
    expect(amounts(pva)).toEqual([0, 3_000, 0, 1_200]);
    expect(within(pva).getByText(/0\s*%\s*collected/)).toBeInTheDocument();
  });

  it("a bill paid late across a month boundary: the plan stays in the scheduled month, the actual lands in the paid month", async () => {
    // Rule-less row: scheduled Feb 27 for 100, paid Mar 2 for 130.
    const late = makeCompletedTransaction({
      id: "late",
      sourceType: "manual",
      type: "expense",
      name: "Late bill",
      category: "utilities",
      projectedAmount: 100,
      actualAmount: 130,
      scheduledDate: "2026-02-27",
      actualDate: "2026-03-02",
    });
    const { d } = await dash({
      profile: { currentBalance: 8_870, initialBalance: 9_000 },
      transactions: [late],
    });
    // REWRITTEN (decision: projected by scheduledDate, actual by actualDate). March shows what was
    // paid in March (130) against what was PLANNED for March (nothing: the 100 was February's plan,
    // scheduled Feb 27). February's side is pinned in tests/unit/balanceCalculator/projectedVsActual.test.ts.
    expect(amounts(card(d, "Projected vs Actual"))).toEqual([0, 0, 130, 0]);
  });
  it.todo(
    "DECISION: 'X% spent' is capped at 100% even when actual is 130% of plan; print the true percentage?"
  );

  it(
    "UI-DISP-23 — an actual amount of 0 (waived fee) counts as 0 in the KPI but as the projected amount in Projected vs Actual",
    async () => {
      // observed: Period Summary Total Expenses -$0.00, Projected vs Actual 'Expenses $100 / $100'.
      const { d } = await dash({
        profile: { currentBalance: 10_000, initialBalance: 10_000 },
        transactions: [manual("waived", "expense", 100, "2026-03-05", "completed", { actualAmount: 0 })],
      });
      expect(Math.abs(money(card(d, "Period Summary"), "Total Expenses"))).toBe(0); // precondition
      expect(amounts(card(d, "Projected vs Actual"))).toEqual([0, 0, 0, 100]);
    }
  );
});

describe("Dashboard Recurring Summary: occurrences, not multipliers", () => {
  const mk = (frequency: IncomeFrequency, amount: number, extra = {}) =>
    makeIncomeSource({
      id: `s-${frequency}`,
      name: `Src ${frequency}`,
      amount,
      frequency,
      startDate: "2026-01-01",
      ...extra,
    });

  it("weekly 100, bi-weekly 200, semi-monthly 1,000, quarterly 300, yearly 1,200 count their real occurrences", async () => {
    // REWRITTEN (occurrence counting). Today is Mar 16 2026, every source starts 2026-01-01.
    // MARCH 2026 (the month shown): weekly on Fridays Mar 6, 13, 20, 27 = 4 x 100 = 400 ;
    // bi-weekly on every other Friday from Jan 2 (Jan 2, 16, 30, Feb 13, 27, Mar 13, 27) = 2 x 200 = 400 ;
    // semi-monthly 15th and 30th = 2 x 1,000 = 2,000 ; quarterly (Jan, Apr, Jul, Oct) and yearly (Jan 1)
    // have no March occurrence = 0  ->  2,800 (the old multiplier estimate said 3,067).
    // NEXT 12 MONTHS (Mar 16 2026 .. Mar 15 2027): 52 Fridays x 100 + 26 x 200 + 24 x 1,000
    // + 4 x 300 (Apr, Jul, Oct, Jan) + 1 x 1,200 (Jan 1 2027) = 5,200 + 5,200 + 24,000 + 1,200 + 1,200 = 36,800
    const { d, page } = await (async () => {
      const r = await renderPages(["dashboard", "income"], {
        today: H1_TODAY,
        seed: {
          incomeSources: [
            mk("weekly", 100, { scheduleConfig: { dayOfWeek: 5 } }),
            mk("bi-weekly", 200, { scheduleConfig: { dayOfWeek: 5 } }),
            mk("semi-monthly", 1_000, { scheduleConfig: { specificDays: [15, 30] } }),
            mk("quarterly", 300),
            mk("yearly", 1_200),
          ],
        },
      });
      return { ...r, d: r.page("dashboard") };
    })();
    expect(money(card(d, "Recurring Summary"), "Monthly Income")).toBe(2_800);
    expect(money(page("income"), "Monthly Recurring")).toBe(2_800);
    expect(money(page("income"), "Annual Projection")).toBe(36_800);
  });

  it(
    "UI-DISP-24 — Annual Projection for a daily source counts the real 365 days, not a 360-day year",
    async () => {
      // a $10 daily source: 365 occurrences a year = 3,650. observed before: Monthly $300 x 12 = $3,600.
      // REWRITTEN precondition: March has 31 days = 31 x 10 = 310 (it was the estimate 30 x 10).
      const { page } = await renderPages(["income"], {
        today: H1_TODAY,
        seed: { incomeSources: [mk("daily", 10)] },
      });
      expect(money(page("income"), "Monthly Recurring")).toBe(310); // precondition (31 days x 10)
      expect(money(page("income"), "Annual Projection")).toBe(3_650); // Mar 16 2026 .. Mar 15 2027 = 365 days
    }
  );

  it(
    "UI-DISP-25 — Recurring Summary counts an income source whose end date has passed",
    async () => {
      // Contract 3,000/mo ended 2026-02-28; Salary 2,000/mo active. observed: Monthly Income $5,000.
      const { d } = await dash({
        incomeSources: [
          makeIncomeSource({ id: "old", name: "Contract", amount: 3_000, startDate: "2025-06-01", endDate: "2026-02-28" }),
          makeIncomeSource({ id: "cur", name: "Salary", amount: 2_000, startDate: "2026-01-01" }),
        ],
      }, H1_TODAY, "UTC");
      const rec = card(d, "Recurring Summary");
      // REWRITTEN precondition: the ended contract is no longer counted as ACTIVE (it said "2 sources")
      expect(within(rec).getByText("1 sources")).toBeInTheDocument();
      expect(money(rec, "Monthly Income")).toBe(2_000);
    }
  );

  it(
    "UI-DISP-26 — Income page 'Monthly Recurring' counts an ended source that the Forecast budget already excludes",
    async () => {
      // observed: Income page $5,000; Forecast Budgeted (March) uses only the 2,000 salary.
      const { page } = await renderPages(["income", "forecast"], {
        today: H1_TODAY,
        timeZone: "UTC",
        seed: {
          incomeSources: [
            makeIncomeSource({ id: "old", name: "Contract", amount: 3_000, startDate: "2025-06-01", endDate: "2026-02-28" }),
            makeIncomeSource({ id: "cur", name: "Salary", amount: 2_000, startDate: "2026-01-01" }),
          ],
        },
      });
      const budgeted = money(card(page("forecast"), /Budgeted vs Actual/), "Budgeted", { occurrence: 0 });
      expect([2_000, 2_066.67]).toContain(budgeted); // precondition: forecast excludes the contract (2,000 or 31/30-prorated)
      expect(money(page("income"), "Monthly Recurring")).toBe(2_000);
    }
  );

  it(
    "UI-DISP-27 — Recurring Summary keeps counting an installment plan that is fully paid (6 of 6)",
    async () => {
      // observed: Monthly Expenses $200 although no payment is projected any more.
      const { d, app } = await dash({
        expenseRules: [
          makeInstallmentRule(
            { id: "done", name: "Old BNPL", amount: 200, startDate: "2025-08-01" },
            { installmentCount: 6, installmentsPaid: 6, installmentAmount: 200, totalAmount: 1_200 }
          ),
        ],
      });
      expect(app.financial().transactions.filter((t) => t.sourceId === "done")).toHaveLength(0); // precondition: nothing projected
      expect(money(card(d, "Recurring Summary"), "Monthly Expenses")).toBe(0);
    }
  );

  it(
    "UI-DISP-28 — Expenses page 'Monthly Recurring' keeps counting a settled credit card (balance 0, no payments projected)",
    async () => {
      // observed: $100 (the rule amount) although the calendar has no card payment at all.
      const { page, app } = await renderPages(["expenses"], {
        today: H1_TODAY,
        seed: {
          expenseRules: [makeCreditRule({ id: "old-visa", name: "Old Visa", amount: 100, startDate: "2026-01-05" }, { currentBalance: 0 })],
        },
      });
      expect(app.financial().transactions.filter((t) => t.sourceId === "old-visa")).toHaveLength(0); // precondition
      expect(money(page("expenses"), "Monthly Recurring")).toBe(0);
    }
  );
});

describe("Dashboard health score", () => {
  it("components for H1 come straight from the hand-checked month (see crossScreen)", async () => {
    const { d } = await dash(h1Seed(), H1_TODAY, "UTC");
    const hs = card(d, "Financial Health");
    const { score, grade } = healthScore(hs);
    expect(score).toBeGreaterThanOrEqual(94);
    expect(grade).toBe("A");
  });

  it(
    "UI-DISP-29 — balance trend is INVERTED for an overdrawn user: a worsening negative balance scores 100/100",
    async () => {
      // -1,000 falling to -2,500 (three 500 bills). observed: Balance Trend 100/100.
      const { d } = await dash({
        profile: { currentBalance: -1_000, initialBalance: -1_000 },
        transactions: [
          manual("a", "expense", 500, "2026-03-20"),
          manual("b", "expense", 500, "2026-03-25"),
          manual("c", "expense", 500, "2026-03-30"),
        ],
      });
      expect(money(card(d, "Period Summary"), "Current Balance")).toBe(-1_000); // precondition
      expect(healthComponent(card(d, "Financial Health"), "Balance Trend")).toBeLessThanOrEqual(30);
    }
  );

  it(
    "UI-DISP-30 — balance trend is INVERTED the other way: a recovering negative balance scores 2/100",
    async () => {
      // -2,000 rising to -500. observed: Balance Trend 2/100.
      const { d } = await dash({
        profile: { currentBalance: -2_000, initialBalance: -2_000 },
        transactions: [
          manual("a", "income", 500, "2026-03-20"),
          manual("b", "income", 500, "2026-03-25"),
          manual("c", "income", 500, "2026-03-30"),
        ],
      });
      expect(money(card(d, "Period Summary"), "Current Balance")).toBe(-2_000); // precondition
      expect(healthComponent(card(d, "Financial Health"), "Balance Trend")).toBeGreaterThanOrEqual(70);
    }
  );

  it(
    "UI-DISP-31 — savings-rate score is 20/100 (not 0) when there is NO income and a 3,000 expense",
    async () => {
      // observed: Savings Rate 20/100; correct: spending 100% of nothing = 0/100 (and the
      // 'spending more than you earn' insight must be reachable).
      const { d } = await dash({
        profile: { currentBalance: 5_000, initialBalance: 5_000 },
        transactions: [manual("big", "expense", 3_000, "2026-03-20")],
      });
      const kpi = card(d, "Period Summary");
      expect(money(kpi, "Net Flow")).toBe(-3_000); // precondition
      expect(money(kpi, "Total Income")).toBe(0);
      expect(healthComponent(card(d, "Financial Health"), "Savings Rate")).toBe(0);
    }
  );

  it(
    "UI-DISP-32 — an unpaid overdue bill still earns a perfect 100/100 Bill Payments score",
    async () => {
      // 300 balance, a 400 bill due Mar 10 never paid (overdue). observed: Bill Payments 100/100.
      const { d } = await dash({
        profile: { currentBalance: 300, initialBalance: 300 },
        transactions: [manual("old-bill", "expense", 400, "2026-03-10")],
      });
      expect(within(d).getByText(/1 Overdue Transaction/)).toBeInTheDocument(); // precondition
      expect(healthComponent(card(d, "Financial Health"), "Bill Payments")).toBeLessThan(100);
    }
  );

  it("brand-new user: a neutral 'not enough data yet' state instead of a grade and a runway claim", async () => {
    // REWRITTEN (decision: an empty account has no score). It rendered "93/100 Grade A" and the
    // insight "Great cash runway! You have 90+ days of expenses covered.".
    const { d } = await dash({ profile: null });
    const hs = card(d, "Financial Health");
    expect(within(hs).getByText("Not enough data yet")).toBeInTheDocument();
    expect(hs.textContent).not.toMatch(/\/100|Grade|runway/i);
  });

  it("a user with only a balance and no rows is also 'not enough data' (nothing to grade)", async () => {
    const { d } = await dash({ profile: { currentBalance: 5_000, initialBalance: 5_000 } });
    expect(within(card(d, "Financial Health")).getByText("Not enough data yet")).toBeInTheDocument();
  });
});

describe("Dashboard category pie", () => {
  it("Income view: salary 4,000 > freelance 820 > gift 300, total 5,120", async () => {
    const { app, d } = await dash(h1Seed());
    const pie = card(d, /by Category/);
    await app.user.click(within(pie).getByRole("button", { name: /Income/ }));
    expect(within(pie).getByText("Income by Category")).toBeInTheDocument();
    expect(money(pie, "Total")).toBe(5_120);
    for (const name of ["salary", "freelance", "gift"]) expect(within(pie).getByText(name)).toBeInTheDocument();
  });

  it("no expenses: shows the empty placeholder, not NaN", async () => {
    const { d } = await dash({ profile: { currentBalance: 1_000, initialBalance: 1_000 } });
    const pie = card(d, /by Category/);
    expect(within(pie).getByText("No spending data yet")).toBeInTheDocument();
    expect(money(pie, "Total")).toBe(0);
  });
});

describe("Dashboard extreme values", () => {
  it("billion-dollar figures print in full with grouping and no NaN/Infinity", async () => {
    const { d } = await dash({
      profile: { currentBalance: 123_456_789.12, initialBalance: 1 },
      transactions: [
        manual("windfall", "income", 9_876_543_210.55, "2026-03-20"),
        manual("yacht", "expense", 1_234_567.89, "2026-03-22"),
      ],
    });
    const kpi = card(d, "Period Summary");
    expect(money(kpi, "Current Balance")).toBe(123_456_789.12);
    expect(money(kpi, "Total Income")).toBe(9_876_543_210.55);
    expect(money(kpi, "Total Expenses")).toBe(-1_234_567.89);
    // 9,876,543,210.55 - 1,234,567.89 = 9,875,308,642.66
    expect(money(kpi, "Net Flow")).toBe(9_875_308_642.66);
    expect(d.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("only one-time items in the period: Recurring Summary is 0 while the KPI shows them", async () => {
    const { d } = await dash({
      profile: { currentBalance: 1_000, initialBalance: 1_000 },
      incomeSources: [
        makeIncomeSource({ id: "gift", name: "Gift", amount: 500, frequency: "one-time", startDate: "2026-03-20" }),
      ],
      expenseRules: [
        makeExpenseRule({ id: "once", name: "Passport", expenseType: "one-time", frequency: "one-time", amount: 120, startDate: "2026-03-22" }),
      ],
    });
    const kpi = card(d, "Period Summary");
    expect(money(kpi, "Total Income")).toBe(500);
    expect(money(kpi, "Total Expenses")).toBe(-120);
    const rec = card(d, "Recurring Summary");
    expect(money(rec, "Monthly Income")).toBe(0);
    expect(money(rec, "Monthly Expenses")).toBe(0);
    expect(stat(kpi, "Total Income")).toBeDefined();
  });
});
