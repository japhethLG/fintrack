import { describe, expect, it, vi } from "vitest";
import { knownDefect, makeExpenseRule, makeIncomeSource, makeManualTransaction } from "../harness";
import type { AppSeed } from "../harness";
import { H1_TODAY, h1Seed } from "./households";
import {
  billRow,
  card,
  colorToken,
  healthComponent,
  money,
  openTab,
  renderPages,
  screen,
  within,
} from "./screens";

// Load-tolerant: a cold first render can exceed the default 20s on a busy machine.
vi.setConfig({ testTimeout: 90_000 });

// NOTE: FORECAST_PRESETS / DASHBOARD_PRESETS are computed once at module load, i.e. under the
// clock of the FIRST render in this file. Every test here therefore uses H1_TODAY (2026-03-16).

const manual = (
  id: string,
  type: "income" | "expense",
  amount: number,
  date: string,
  status: "completed" | "projected" = "completed",
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

/**
 * T1 "Tight": today Mon 2026-03-16, balance 500.
 *   Mar 20  expense 300   -> 200 left
 *   Mar 25  expense 400   -> -200  (first negative day: today + 9 days; shortfall 200)
 *   Apr 01  income 1,000  (16 days out: outside the 14-day bill window)
 */
const tight = () => ({
  profile: { currentBalance: 500, initialBalance: 500 },
  transactions: [
    manual("Bill A", "expense", 300, "2026-03-20", "projected"),
    manual("Bill B", "expense", 400, "2026-03-25", "projected"),
    manual("Refund", "income", 1_000, "2026-04-01", "projected"),
  ],
});

const fc = async (seed: AppSeed, names: Parameters<typeof renderPages>[0] = ["forecast"]) => {
  const r = await renderPages(names, { today: H1_TODAY, timeZone: "UTC", seed });
  return { ...r, f: r.page("forecast") };
};
const runwayCard = (f: HTMLElement) => card(f, "Cash Runway");

describe("Forecast: runway and next crunch", () => {
  it("T1: runs out on the first negative day, 9 days out, with the 200 shortfall bill flagged", async () => {
    const { f, app } = await fc(tight(), ["forecast", "dashboard"]);
    expect(money(f, "Current Balance")).toBe(500);
    const rc = runwayCard(f);
    expect(within(rc).getByText("9 days")).toBeInTheDocument(); // Mar 16 -> Mar 25
    expect(within(rc).getByText("Crunch on 3/25/2026")).toBeInTheDocument();
    expect(colorToken(rc)).toBe("warning");
    // Dashboard health uses the same horizon: 9 days falls in the 7-13 day tier = 20/100
    expect(healthComponent(card(app.container as HTMLElement, "Financial Health"), "Cash Runway")).toBe(20);
  });

  it("T1: Forecast 'Bills at Risk' alert count equals the number of 'Need $' rows in the Dashboard Bills tab", async () => {
    const { f, app, page } = await fc(tight(), ["forecast", "dashboard"]);
    expect(within(f).getByText("1 Bill at Risk")).toBeInTheDocument();
    await openTab(app, page("dashboard"), /Bills/);
    const upc = card(page("dashboard"), /Upcoming Activity/);
    expect(billRow(upc, "Bill A")).toMatchObject({ covered: true });
    // 500 - 300 = 200 left; Bill B 400 leaves -200 -> needs 200
    expect(billRow(upc, "Bill B")).toMatchObject({ covered: false, need: 200 });
    expect(money(upc, "Projected Balance")).toBe(-200); // Refund (Apr 1) is beyond the window
    expect(colorToken(within(upc).getByText("-$200"))).toBe("danger");
  });

  it(
    "UI-DISP-33 — Forecast 'Cash Runway' declares 0 days / crunch today for a user whose balance ALREADY includes a bill completed today",
    async () => {
      // balance 100 (= 300 - the 200 bill paid today), nothing else scheduled.
      // observed: Forecast '0 days' + 'Crunch on 3/16/2026' while the Dashboard health card scores the same
      // balance 100/100 for runway ('90+ days').
      const { f, page } = await fc(
        {
          profile: { currentBalance: 100, initialBalance: 300 },
          transactions: [manual("Bill paid today", "expense", 200, "2026-03-16", "completed")],
        },
        ["forecast", "dashboard"]
      );
      expect(money(f, "Current Balance")).toBe(100); // precondition
      expect(healthComponent(card(page("dashboard"), "Financial Health"), "Cash Runway")).toBe(100); // precondition
      const rc = runwayCard(f);
      expect(rc.textContent).toContain("90+ days");
      expect(rc.textContent).not.toContain("Crunch on");
    }
  );

  it(
    "UI-DISP-34 — the runway and the crunch share one horizon, so the card never contradicts itself",
    async () => {
      // observed before: '120 days' next to 'No crunch detected' (runway scanned 365 days, the crunch 90).
      // REWRITTEN: both read ONE 90-day walk (the default projection window always covers 90 days;
      // a longer claim would over-state the runway once the generated rows run out, BAL-7).
      // balance 1,000 and a 1,500 bill 60 days out (2026-05-15): '60 days' AND 'Crunch on 5/15/2026'.
      const near = await fc({
        profile: { currentBalance: 1_000, initialBalance: 1_000 },
        transactions: [manual("Roof", "expense", 1_500, "2026-05-15", "projected")],
      });
      const rcNear = runwayCard(near.f);
      expect(within(rcNear).getByText("60 days")).toBeInTheDocument();
      expect(within(rcNear).getByText("Crunch on 5/15/2026")).toBeInTheDocument();
      expect(rcNear.textContent).not.toContain("No crunch detected");
      near.app.unmount();

      // the same bill 120 days out (2026-07-14) is beyond the horizon: '90+ days' AND no crunch
      const far = await fc({
        profile: { currentBalance: 1_000, initialBalance: 1_000 },
        transactions: [manual("Roof", "expense", 1_500, "2026-07-14", "projected")],
      });
      const rcFar = runwayCard(far.f);
      expect(within(rcFar).getByText("90+ days")).toBeInTheDocument();
      expect(within(rcFar).getByText("No crunch detected")).toBeInTheDocument();
    }
  );

  it("no data at all: the runway card says 'Not enough data yet', never '90+ days'", async () => {
    // REWRITTEN (decision: an empty account is a neutral state): it asserted '90+ days' and a green
    // 'No crunch detected' for a user with a balance and nothing else.
    const { f } = await fc({ profile: { currentBalance: 2_500, initialBalance: 2_500 } });
    const rc = runwayCard(f);
    expect(within(rc).getByText("Not enough data yet")).toBeInTheDocument();
    expect(rc.textContent).not.toMatch(/90\+ days|No crunch/);
    expect(colorToken(rc)).not.toBe("success");
  });

  it("data but no bills in the horizon and a positive balance: '90+ days' and 'No crunch detected' in green", async () => {
    // one projected 100 income next week, nothing owed: the runway is the whole 90-day horizon
    const { f } = await fc({
      profile: { currentBalance: 2_500, initialBalance: 2_500 },
      transactions: [manual("Refund", "income", 100, "2026-03-23", "projected")],
    });
    const rc = runwayCard(f);
    expect(within(rc).getByText("90+ days")).toBeInTheDocument();
    expect(within(rc).getByText("No crunch detected")).toBeInTheDocument();
    expect(colorToken(rc)).toBe("success");
  });

  it("an already-overdrawn balance paints Current Balance red and flags the bill at risk", async () => {
    const { f } = await fc({
      profile: { currentBalance: -400, initialBalance: 0 },
      transactions: [
        manual("Rent paid", "expense", 400, "2026-03-10", "completed"),
        manual("Phone", "expense", 100, "2026-03-18", "projected"),
        manual("Client", "income", 1_000, "2026-03-20", "projected"),
      ],
    });
    const bal = card(f, "Current Balance");
    expect(money(bal, "Current Balance")).toBe(-400);
    expect(colorToken(bal)).toBe("danger");
    expect(within(f).getByText("1 Bill at Risk")).toBeInTheDocument();
  });

  it("overdue unpaid bill (D5): every view owes it, none moves the realized balance", async () => {
    // RESOLVED (was the DECISION todo, user decision D5). 300 in the account, a 400 bill dated Mar 10
    // that nobody paid: it is OVERDUE. The realized balance stays 300 (Dashboard/Forecast print it);
    // every projection owes the bill from today:
    //   Calendar: the day Mar 10 lists the bill (flagged) but does not move; today (Mar 16) opens at
    //   300 and closes at 300 - 400 = -100; the month closes at -100. Runway: 0 days (crunch today,
    //   short 100). Bill coverage: the bill is listed, needs 100. Health runway: 0.
    const { app, page } = await fc(
      {
        profile: { currentBalance: 300, initialBalance: 300 },
        transactions: [manual("Old bill", "expense", 400, "2026-03-10", "projected")],
      },
      ["forecast", "dashboard", "calendar"]
    );
    expect(money(page("forecast"), "Current Balance")).toBe(300);
    expect(money(card(page("dashboard"), "Period Summary"), "Current Balance")).toBe(300);
    // the calendar: month closing -100, today opens at the realized 300
    expect(money(page("calendar"), "Closing", { occurrence: 0 })).toBe(-100);
    expect(money(card(page("dashboard"), /Projected Cash Flow/), "Closing")).toBe(-100);
    const cal = page("calendar");
    await app.user.click(within(cal).getByRole("button", { name: "Today" }));
    const today = card(cal, "Monday, Mar 16");
    expect(money(today, "Opening")).toBe(300);
    expect(money(today, "Overdue owed")).toBe(-400);
    expect(money(today, "Closing")).toBe(-100);
    // the risk views
    const rc = runwayCard(page("forecast"));
    expect(within(rc).getByText("0 days")).toBeInTheDocument();
    expect(within(rc).getByText("Crunch on 3/16/2026")).toBeInTheDocument();
    expect(healthComponent(card(page("dashboard"), "Financial Health"), "Cash Runway")).toBe(0);
    expect(within(page("forecast")).getByText("1 Bill at Risk")).toBeInTheDocument();
  });
});

describe("Forecast: Actual metrics and overview", () => {
  it(
    "UI-DISP-35 — 'Negative Cash Flow' warning never appears when a period has expenses but NO income",
    async () => {
      // March: expenses 700 (300 + 400), income 0. observed: savings rate 0.0% (status warning) and no alert.
      const { f } = await fc(tight());
      expect(money(card(f, /Budgeted vs Actual/), "Actual", { occurrence: 1 })).toBe(700); // precondition
      expect(within(f).getByText("Actual Savings Rate")).toBeInTheDocument();
      expect(f.textContent).toContain("Negative Cash Flow");
    }
  );

  it("H1 colours: healthy savings rate is green, income above plan green, expenses above plan red", async () => {
    const { f } = await fc(h1Seed());
    expect(colorToken(card(f, "Actual Savings Rate"))).toBe("success"); // 42.8% >= 20
    expect(colorToken(card(f, "Current Balance"))).toBe("success");
    const cmp = card(f, /Budgeted vs Actual/);
    const chip = (label: string) =>
      Array.from(cmp.querySelectorAll("span")).find((s) => s.textContent === label)!.nextElementSibling!;
    expect(chip("Income").textContent).toMatch(/^\+\s*[\d.]+%$/);
    expect(colorToken(chip("Income"))).toBe("success");
    expect(chip("Expenses").textContent).toMatch(/^\+\s*[\d.]+%$/);
    expect(colorToken(chip("Expenses"))).toBe("danger"); // actual 2,930.83 > any budget for this month
  });

  it("Compare / Actual / Budgeted tabs show the same actual figures", async () => {
    const { f, app } = await fc(h1Seed());
    const overview = card(f, "Monthly Overview");
    await app.user.click(within(overview).getByRole("button", { name: "Actual" }));
    expect(within(overview).getByText("Income")).toBeInTheDocument();
    expect(within(overview).getByText("+$5,120")).toBeInTheDocument();
    expect(within(overview).getByText("-$2,930.83")).toBeInTheDocument();
    expect(within(overview).getByText("+$2,189")).toBeInTheDocument(); // net 2,189.1683 (whole-dollar signed format)
  });

  it(
    "UI-DISP-36 — picking 'Next 30 Days' keeps the savings-rate subtitle saying '... this month'",
    async () => {
      // Mar 16..Apr 15: income 4,750 (Payroll Mar30 2,000 + Freelance Apr10 750 + Payroll Apr15 2,000);
      // expenses 2,929.8817 (see households.ts window list) -> surplus 1,820.1183, rate 38.3%.
      // observed subtitle: "$1,820.12 this month" for a 31-day window.
      const { f, app } = await fc(h1Seed());
      const inputs = screen.getAllByPlaceholderText("Start date");
      await app.user.click(inputs[0]);
      await app.user.click(await screen.findByRole("button", { name: "Next 30 Days" }));
      expect(within(f).getAllByText("Insights for Mar 16 - Apr 15, 2026").length).toBe(1); // precondition
      const savings = card(f, "Actual Savings Rate");
      expect(within(savings).getByText("38.3%")).toBeInTheDocument(); // precondition
      expect(savings.textContent).toContain("$1,820.12");
      expect(savings.textContent).not.toMatch(/this month/);
    }
  );
});

describe("Dashboard Bills tab (bill coverage)", () => {
  const bills = async (seed: AppSeed) => {
    const r = await renderPages(["dashboard"], { today: H1_TODAY, timeZone: "UTC", seed });
    await openTab(r.app, r.page("dashboard"), /Bills/);
    return { ...r, upc: card(r.page("dashboard"), /Upcoming Activity/) };
  };

  it("the coverage window is EXACTLY 14 days: today through today+13; today+14 is excluded", async () => {
    const { upc } = await bills({
      profile: { currentBalance: 10_000, initialBalance: 10_000 },
      transactions: [
        manual("D0", "expense", 10, "2026-03-16", "projected"),
        manual("D13", "expense", 10, "2026-03-29", "projected"),
        manual("D14", "expense", 10, "2026-03-30", "projected"),
        manual("D15", "expense", 10, "2026-03-31", "projected"),
      ],
    });
    // REWRITTEN (user decision, SPECIFICATION "Next 14 days of bills"): Mar 16 .. Mar 29 is 14 days.
    expect(within(upc).getByText("D0")).toBeInTheDocument();
    expect(within(upc).getByText("D13")).toBeInTheDocument();
    expect(within(upc).queryByText("D14")).toBeNull(); // the 15th calendar day is outside
    expect(within(upc).queryByText("D15")).toBeNull();
    expect(money(upc, "Projected Balance")).toBe(9_980); // 10,000 - 2 x 10
  });

  it("a bill due today is included and completed rows are excluded from coverage", async () => {
    const { upc } = await bills({
      profile: { currentBalance: 1_000, initialBalance: 1_000 },
      transactions: [
        manual("Due today", "expense", 200, "2026-03-16", "projected"),
        manual("Already paid", "expense", 300, "2026-03-18", "completed"),
      ],
    });
    expect(within(upc).getByText("Due today")).toBeInTheDocument();
    expect(within(upc).queryByText("Already paid")).toBeNull();
    expect(money(upc, "Projected Balance")).toBe(800);
  });

  it("same-day RULE income is credited before the same-day bill (Covered)", async () => {
    // balance 100; bill 150 and income 200 both on Mar 20 (both rule-based). day nets +50, never negative.
    const { upc } = await bills({
      profile: { currentBalance: 100, initialBalance: 100 },
      incomeSources: [
        makeIncomeSource({ id: "pay", name: "RulePay", amount: 200, frequency: "one-time", startDate: "2026-03-20" }),
      ],
      expenseRules: [
        makeExpenseRule({ id: "bill", name: "RuleBill", amount: 150, frequency: "one-time", startDate: "2026-03-20" }),
      ],
    });
    expect(billRow(upc, "RuleBill").covered).toBe(true);
    expect(money(upc, "Projected Balance")).toBe(150);
  });

  it(
    "UI-DISP-37 — the SAME scenario with a MANUAL same-day income says 'Need $50' (coverage depends on which list the income sits in)",
    async () => {
      // balance 100; rule bill 150 + manual income 200, both Mar 20. Day nets +50.
      // observed: bill row 'Need $50' (manual rows are appended after rule rows, so the bill is walked first).
      const { upc } = await bills({
        profile: { currentBalance: 100, initialBalance: 100 },
        expenseRules: [
          makeExpenseRule({ id: "bill", name: "RuleBill", amount: 150, frequency: "one-time", startDate: "2026-03-20" }),
        ],
        transactions: [manual("ManualPay", "income", 200, "2026-03-20", "projected")],
      });
      expect(money(upc, "Projected Balance")).toBe(150); // precondition: same end balance as the rule-income case
      expect(billRow(upc, "RuleBill").covered).toBe(true);
    }
  );

  it("'Need $X' is each bill's OWN uncovered part, not a cumulative carry", async () => {
    // RESOLVED (was a DECISION todo). Balance 100; Water 200 on Mar 20 (needs 100), then Electric 300
    // on Mar 22: nothing is left, so it needs its own full 300 (the old figure, 400, added Water's
    // 100 again). The end balance is still 100 - 200 - 300 = -400.
    const { upc } = await bills({
      profile: { currentBalance: 100, initialBalance: 100 },
      transactions: [
        manual("Water", "expense", 200, "2026-03-20", "projected"),
        manual("Electric", "expense", 300, "2026-03-22", "projected"),
      ],
    });
    expect(billRow(upc, "Water")).toMatchObject({ covered: false, need: 100 });
    expect(billRow(upc, "Electric")).toMatchObject({ covered: false, need: 300 });
    expect(money(upc, "Projected Balance")).toBe(-400);
  });

  it("an OVERDUE bill is walked first and flagged 'Overdue' (D5)", async () => {
    // 1,000 balance; Rent 700 was due Mar 10 and is unpaid (overdue); Gym 400 is due Mar 20.
    // Rent is owed now (1,000 -> 300), then Gym needs 100 of its 400.
    const { upc } = await bills({
      profile: { currentBalance: 1_000, initialBalance: 1_000 },
      transactions: [
        manual("Rent", "expense", 700, "2026-03-10", "projected"),
        manual("Gym", "expense", 400, "2026-03-20", "projected"),
      ],
    });
    expect(billRow(upc, "Rent").text).toContain("Overdue");
    expect(billRow(upc, "Rent")).toMatchObject({ covered: true });
    expect(billRow(upc, "Gym")).toMatchObject({ covered: false, need: 100 });
    expect(money(upc, "Projected Balance")).toBe(-100);
  });
});
