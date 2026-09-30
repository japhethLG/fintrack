import { describe, expect, it, vi } from "vitest";
import { act, knownDefect } from "../harness";
import { H1_TODAY, h1Seed } from "./households";
import { amounts, card, money, openTab, renderPages, stat, within } from "./screens";

// Load-tolerant: a cold first render can exceed the default 20s on a busy machine.
vi.setConfig({ testTimeout: 90_000 });

/**
 * STALE-VALUE HUNT: after each mutation every screen that shows the affected
 * number must move to the hand-computed value. All five pages share one
 * FinancialContext; mutations go through the real context actions (the same
 * ones the modals call), then we re-read every page.
 *
 * Baseline = H1 (see households.ts): March income 5,120, expenses 2,930.8317,
 * balance 13,969.05.
 */

const ALL = ["dashboard", "calendar", "forecast", "income", "expenses"] as const;
const mount = () => renderPages([...ALL], { today: H1_TODAY, timeZone: "UTC", seed: h1Seed() });
type Mounted = Awaited<ReturnType<typeof mount>>;

const findTx = (m: Mounted, name: string, date: string) => {
  const t = m.app.financial().transactions.find((x) => x.name === name && x.scheduledDate === date);
  if (!t) throw new Error(`no transaction ${name} on ${date}`);
  return t;
};
const kpi = (m: Mounted) => card(m.page("dashboard"), "Period Summary");

describe("mutation: complete a projected bill with a different actual (Electricity Mar 18, planned 90, paid 95)", () => {
  it("every screen moves to the hand-computed values", async () => {
    const m = await mount();
    const power = findTx(m, "Electricity", "2026-03-18");
    await act(async () => {
      await m.app.financial().markTransactionComplete(power.id, { actualAmount: 95 });
    });
    await m.app.settle();

    // Dashboard KPI: balance 13,969.05 - 95; expenses 2,930.8317 - 90 + 95 = 2,935.8317; net 2,184.1683
    expect(money(kpi(m), "Current Balance")).toBe(13_874.05);
    expect(money(kpi(m), "Total Expenses")).toBe(-2_935.83);
    expect(money(kpi(m), "Net Flow")).toBe(2_184.17);
    expect(within(kpi(m)).getByText("3 completed, 1 projected")).toBeInTheDocument(); // income untouched
    expect(within(kpi(m)).getByText("4 completed, 6 projected")).toBeInTheDocument();
    // Projected vs Actual: actual 1,500.95 + 95 = 1,595.95 ; the plan is unchanged 2,929.8817
    expect(amounts(card(m.page("dashboard"), "Projected vs Actual"))).toEqual([3_120, 5_050, 1_595.95, 2_929.88]);
    // Upcoming (14 days): the completed bill leaves the list: expenses 1,429.8817 - 90 = 1,339.8817; net 660.1183
    expect(amounts(card(m.page("dashboard"), /Upcoming Activity/)).slice(0, 3)).toEqual([2_000, -1_339.88, 660]);
    // Calendar tiles (whole dollars) and the completed counter 6 -> 7 of 14
    const cal = m.page("calendar");
    expect(money(cal, "Expenses", { occurrence: 0 })).toBe(-2_936);
    expect(money(cal, "Net Change", { occurrence: 0 })).toBe(2_184);
    expect(card(cal, "Transactions").textContent?.replace(/\s+/g, " ")).toContain("7 / 14");
    // Forecast
    expect(money(m.page("forecast"), "Current Balance")).toBe(13_874.05);
    const cmp = card(m.page("forecast"), /Budgeted vs Actual/);
    expect(money(cmp, "Actual", { occurrence: 1 })).toBe(2_935.83);
    expect(money(cmp, "Actual", { occurrence: 2 })).toBe(2_184.17);
    // Expenses page: upcoming 30-day total loses the 90; the recurring estimate (rule-based) is unchanged
    expect(money(card(m.page("expenses"), "Upcoming Bills"), "Total Due")).toBe(2_839.88);
    expect(money(m.page("expenses"), "Monthly Recurring")).toBe(2_730);
  });

  it("the Bills tab projected balance follows: 13,874.05 + 2,000 - 1,339.8817 = 14,534.17", async () => {
    const m = await mount();
    const power = findTx(m, "Electricity", "2026-03-18");
    await act(async () => {
      await m.app.financial().markTransactionComplete(power.id, { actualAmount: 95 });
    });
    await m.app.settle();
    await openTab(m.app, m.page("dashboard"), /Bills/);
    const upc = card(m.page("dashboard"), /Upcoming Activity/);
    expect(money(upc, "Projected Balance")).toBe(14_534.17);
    expect(within(upc).queryByText("Electricity")).toBeNull();
  });
});

describe("mutation: add and then deactivate a one-time income (Side gig 400 on Mar 25)", () => {
  const sideGig = {
    name: "Side gig",
    sourceType: "other" as const,
    amount: 400,
    isVariableAmount: false,
    frequency: "one-time" as const,
    startDate: "2026-03-25",
    scheduleConfig: {},
    weekendAdjustment: "none" as const,
    category: "other",
    isActive: true,
  };

  it("all widgets pick it up, and all return to baseline when it is switched off", async () => {
    const m = await mount();
    let created!: { id: string };
    await act(async () => {
      created = await m.app.financial().createIncomeSource(sideGig);
    });
    await m.app.settle();

    // --- with the source ---
    // Dashboard KPI: income 5,120 + 400 = 5,520 ; net 2,589.1683 ; income counter 3 completed, 2 projected
    expect(money(kpi(m), "Total Income")).toBe(5_520);
    expect(money(kpi(m), "Net Flow")).toBe(2_589.17);
    expect(within(kpi(m)).getByText("3 completed, 2 projected")).toBeInTheDocument();
    // Upcoming 14d income 2,000 + 400
    expect(amounts(card(m.page("dashboard"), /Upcoming Activity/)).slice(0, 3)).toEqual([2_400, -1_429.88, 970]);
    // Recurring summary: one-time income adds a source but no monthly amount
    const rec = card(m.page("dashboard"), "Recurring Summary");
    expect(within(rec).getByText("3 sources")).toBeInTheDocument();
    expect(money(rec, "Monthly Income")).toBe(4_750);
    // Income page
    expect(stat(m.page("income"), "Active Sources")).toBe("3");
    expect(money(m.page("income"), "One-time Income")).toBe(400);
    expect(money(m.page("income"), "Monthly Recurring")).toBe(4_750);
    expect(money(card(m.page("income"), "Upcoming Payments"), "Total Expected")).toBe(5_150);
    // Calendar + Forecast
    expect(money(m.page("calendar"), "Income", { occurrence: 0 })).toBe(5_520);
    expect(money(m.page("calendar"), "Net Change", { occurrence: 0 })).toBe(2_589);
    expect(money(card(m.page("forecast"), /Budgeted vs Actual/), "Actual", { occurrence: 0 })).toBe(5_520);

    // --- switch it off: everything returns to the H1 baseline ---
    await act(async () => {
      await m.app.financial().toggleIncomeSourceActive(created.id, false);
    });
    await m.app.settle();
    expect(money(kpi(m), "Total Income")).toBe(5_120);
    expect(money(kpi(m), "Net Flow")).toBe(2_189.17);
    expect(stat(m.page("income"), "Active Sources")).toBe("2");
    expect(money(m.page("income"), "One-time Income")).toBe(0);
    expect(money(card(m.page("income"), "Upcoming Payments"), "Total Expected")).toBe(4_750);
    expect(within(card(m.page("dashboard"), "Recurring Summary")).getByText("2 sources")).toBeInTheDocument();
    expect(money(m.page("calendar"), "Income", { occurrence: 0 })).toBe(5_120);
    expect(money(card(m.page("forecast"), /Budgeted vs Actual/), "Actual", { occurrence: 0 })).toBe(5_120);
  });
});

describe("mutation: add a weekly expense rule (Gym 40 every Saturday from Mar 21)", () => {
  it("adds Mar 21 + Mar 28 to March and re-estimates the monthly recurring total", async () => {
    const m = await mount();
    await act(async () => {
      await m.app.financial().createExpenseRule({
        name: "Gym",
        expenseType: "fixed",
        category: "personal",
        amount: 40,
        isVariableAmount: false,
        frequency: "weekly",
        startDate: "2026-03-21",
        scheduleConfig: { dayOfWeek: 6 },
        weekendAdjustment: "none",
        isPriority: false,
        isActive: true,
      });
    });
    await m.app.settle();
    // March: 2,930.8317 + 2 x 40 = 3,010.8317 ; net 5,120 - 3,010.8317 = 2,109.1683
    expect(money(kpi(m), "Total Expenses")).toBe(-3_010.83);
    expect(money(kpi(m), "Net Flow")).toBe(2_109.17);
    expect(within(kpi(m)).getByText("3 completed, 9 projected")).toBeInTheDocument();
    expect(money(m.page("calendar"), "Expenses", { occurrence: 0 })).toBe(-3_011);
    // recurring: 2,729.88 + 40 * 52/12 (173.33) = 2,903.21
    expect(money(card(m.page("dashboard"), "Recurring Summary"), "Monthly Expenses")).toBe(2_903);
    expect(money(card(m.page("dashboard"), "Recurring Summary"), "Net Recurring")).toBe(1_847); // 4,750 - 2,903.21
    expect(money(m.page("expenses"), "Monthly Recurring")).toBe(2_903);
    expect(stat(m.page("expenses"), "Active Expenses")).toBe("8");
    // Upcoming 30 days: Mar 21, Mar 28, Apr 4, Apr 11 = 4 x 40 more: 2,929.8817 + 160 = 3,089.8817
    expect(money(card(m.page("expenses"), "Upcoming Bills"), "Total Due")).toBe(3_089.88);
    // Forecast actual expenses
    expect(money(card(m.page("forecast"), /Budgeted vs Actual/), "Actual", { occurrence: 1 })).toBe(3_010.83);
  });
});

describe("mutation: skip a projected bill (Dentist 250 on Mar 27)", () => {
  it("skipped rows leave every total and counter but stay visible as 'skipped'", async () => {
    const m = await mount();
    const dentist = findTx(m, "Dentist", "2026-03-27");
    await act(async () => {
      await m.app.financial().markTransactionSkipped(dentist.id);
    });
    await m.app.settle();
    // expenses 2,930.8317 - 250 = 2,680.8317 ; net 2,439.1683 ; projected expense rows 7 -> 6
    expect(money(kpi(m), "Total Expenses")).toBe(-2_680.83);
    expect(money(kpi(m), "Net Flow")).toBe(2_439.17);
    expect(within(kpi(m)).getByText("3 completed, 6 projected")).toBeInTheDocument();
    // the plan also drops the skipped bill: 2,929.8817 - 250 = 2,679.8817
    expect(amounts(card(m.page("dashboard"), "Projected vs Actual"))).toEqual([3_120, 5_050, 1_500.95, 2_679.88]);
    // Upcoming 14d: 1,429.8817 - 250 = 1,179.8817
    expect(amounts(card(m.page("dashboard"), /Upcoming Activity/)).slice(0, 2)).toEqual([2_000, -1_179.88]);
    // Calendar tiles: expenses 2,681 ; tile 6 completed of 13 (skipped is neither completed nor projected)
    const cal = m.page("calendar");
    expect(money(cal, "Expenses", { occurrence: 0 })).toBe(-2_681);
    expect(card(cal, "Transactions").textContent?.replace(/\s+/g, " ")).toContain("6 / 13");
    expect(within(card(cal, "Monthly range")).getByText("skipped")).toBeInTheDocument();
    // Expenses page: the 30-day list drops it; the one-time RULE total is unchanged (the rule is still active)
    expect(money(card(m.page("expenses"), "Upcoming Bills"), "Total Due")).toBe(2_679.88);
    expect(money(m.page("expenses"), "One-time")).toBe(250);
  });
});

describe("mutation: override the current balance", () => {
  it("Dashboard, Forecast and the Calendar closing balance all move by exactly the same 6,030.95", async () => {
    const m = await mount();
    const before = money(m.page("calendar"), "Closing", { occurrence: 0 });
    await act(async () => {
      await m.app.financial().setCurrentBalance(20_000);
    });
    await m.app.settle();
    expect(money(kpi(m), "Current Balance")).toBe(20_000);
    expect(money(m.page("forecast"), "Current Balance")).toBe(20_000);
    // delta 20,000 - 13,969.05 = 6,030.95 on whole-dollar chips: (before + 6,031) +/- 1
    const after = money(m.page("calendar"), "Closing", { occurrence: 0 });
    expect(Math.abs(after - before - 6_030.95)).toBeLessThan(1);
    // income/expense totals for the month are untouched by a balance override
    expect(money(kpi(m), "Total Income")).toBe(5_120);
    expect(money(kpi(m), "Total Expenses")).toBe(-2_930.83);
  });
});

describe("mutation: pay the first Car Loan instalment (Mar 20, 564.88)", () => {
  const pay = async () => {
    const m = await mount();
    const loan = findTx(m, "Car Loan", "2026-03-20");
    await act(async () => {
      await m.app.financial().markTransactionComplete(loan.id, { actualAmount: 564.88 });
    });
    await m.app.settle();
    return m;
  };

  it("the payment itself lands correctly: balance -564.88, March expenses unchanged, counters 4/6", async () => {
    const m = await pay();
    expect(money(kpi(m), "Current Balance")).toBe(13_404.17); // 13,969.05 - 564.88
    expect(money(kpi(m), "Total Expenses")).toBe(-2_930.83); // 564.8817 planned -> 564.88 actual (-0.0017 rounds away)
    expect(within(kpi(m)).getByText("4 completed, 6 projected")).toBeInTheDocument();
  });

  it("UI-DISP-38 — after paying an instalment the NEXT month's instalment jumps from 564.88 to 586.63",
    async () => {
      // observed: April Car Loan projected 586.63 (PMT recomputed over 23 months on the unchanged 12,000 balance)
      // April hand expenses: Rent 1,200 + Groceries 4 x 150 + Electricity 90 + Loan 564.8817 + Visa 25 + Laptop 200 = 2,679.8817
      const m = await pay();
      const cal = m.page("calendar");
      await m.app.user.click(within(cal).getByText("chevron_right").closest("button")!);
      expect(within(cal).getByText("April 2026")).toBeInTheDocument(); // precondition
      expect(money(cal, "Income", { occurrence: 0 })).toBe(4_750); // precondition: April income = 2 x 2,000 + 750
      expect(money(cal, "Expenses", { occurrence: 0 })).toBe(-2_680);
    }
  );

  it(
    "UI-DISP-39 — Total Debt on the Expenses page does not drop after a loan instalment is paid",
    async () => {
      // paying 564.88 with 120.00 interest (12,000 x 1%) reduces the loan principal by 444.88.
      // observed: $14,200 before and after.  correct: 14,200 - 444.88 = 13,755.12
      const m = await pay();
      expect(within(kpi(m)).getByText("4 completed, 6 projected")).toBeInTheDocument(); // precondition
      expect(money(m.page("expenses"), "Total Debt")).toBe(13_755);
    }
  );
});
