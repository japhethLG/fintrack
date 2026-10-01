import { describe, expect, it } from "vitest";
import * as React from "react";
import {
  renderApp,
  screen,
  within,
  knownDefect,
  moneyNear,
  makeExpenseRule,
  makeManualTransaction,
} from "../harness";
import { Screens, calendarToday, screenEl } from "./support";

/**
 * The Calendar is the one screen that RECONSTRUCTS balances (opening/closing per day)
 * instead of printing users/{uid}.currentBalance. Its figures must agree with the
 * actual balance on the day the actual balance describes: today.
 */

const TODAY = "2026-01-15";

/** The closing-balance text printed inside the grid cell of a given day of the shown month. */
const gridCellBalance = (day: number): string => {
  const cal = screenEl("calendar");
  const num = within(cal)
    .getAllByText(String(day))
    .find((el) => el.nextElementSibling && /\d/.test(el.nextElementSibling.textContent ?? ""));
  if (!num) throw new Error(`no grid cell with a balance for day ${day}`);
  return (num.nextElementSibling as HTMLElement).textContent ?? "";
};

const clickNav = async (app: Awaited<ReturnType<typeof renderApp>>, icon: "chevron_left" | "chevron_right", times: number) => {
  const cal = within(screenEl("calendar"));
  for (let i = 0; i < times; i++) {
    await app.user.click(cal.getAllByRole("button", { name: icon })[0]);
  }
};

describe("calendar balance vs the stored balance", () => {
  // initial 10,000 with a completed 500 expense from August 2025 => current 9,500.
  // The default projection window starts on 2025-11-01, so that expense is "pre-window".
  const preWindow = {
    profile: { currentBalance: 9_500, initialBalance: 10_000 },
    transactions: [
      makeManualTransaction({ id: "old", name: "Old expense", status: "completed", projectedAmount: 500, actualAmount: 500, scheduledDate: "2025-08-05", actualDate: "2025-08-05" }),
    ],
  };

  it(
    "UI-BAL-35 — a completed transaction older than the 2-month window is subtracted from the opening balance but never re-applied, so today's closing balance is wrong",
    async () => {
      // observed: today's Opening/Closing $10,000 while Settings/Dashboard/Forecast say $9,500
      const app = await renderApp({ ui: <Screens only={["settings", "calendar"]} />, today: TODAY, seed: preWindow });
      // preconditions: the actual balance is 9,500 and nothing is pending on or before today
      expect(moneyNear("Current", { within: screenEl("settings") })).toBe(9_500);
      expect(app.financial().transactions.filter((t) => t.status === "projected")).toHaveLength(0);
      const today = await calendarToday(app);
      expect(today.closing).toBe(9_500);
      expect(today.opening).toBe(9_500);
    },
    40_000
  );

  it(
    "UI-BAL-36 — the calendar's balance for TODAY changes after browsing back to an older month (the view window only ever grows)",
    async () => {
      // observed: 10,000 before browsing to Aug 2025 (the 500 expense is outside the window), 9,500 after.
      const app = await renderApp({ ui: <Screens only={["settings", "calendar"]} />, today: TODAY, seed: preWindow });
      const before = (await calendarToday(app)).closing;
      await clickNav(app, "chevron_left", 5); // Jan -> Dec -> Nov -> Oct -> Sep -> Aug 2025
      expect(within(screenEl("calendar")).getByText("August 2025")).toBeInTheDocument();
      await clickNav(app, "chevron_right", 5);
      expect(within(screenEl("calendar")).getByText("January 2026")).toBeInTheDocument();
      const after = (await calendarToday(app)).closing;
      // precondition: once August has been visited the reconstruction is right
      expect(after).toBe(9_500);
      // money assertion: the same day must not print two different balances
      expect(before).toBe(after);
    },
    60_000
  );

  it("a completed transaction INSIDE the window keeps today's calendar closing equal to the actual balance", async () => {
    // same 500 expense, dated 2026-01-05 (in the window)
    const app = await renderApp({
      ui: <Screens only={["settings", "calendar"]} />,
      today: TODAY,
      seed: {
        profile: { currentBalance: 9_500, initialBalance: 10_000 },
        transactions: [makeManualTransaction({ id: "new", status: "completed", projectedAmount: 500, actualAmount: 500, scheduledDate: "2026-01-05", actualDate: "2026-01-05" })],
      },
    });
    const today = await calendarToday(app);
    expect(today.opening).toBe(9_500);
    expect(today.closing).toBe(9_500);
  }, 40_000);

  it("pending items dated after today move only the days from their date onward", async () => {
    // balance 1,000; a projected 250 bill on Jan 20 (a future date): days <= 19 stay 1,000, Jan 20+ are 750
    const app = await renderApp({
      ui: <Screens only={["settings", "calendar"]} />,
      today: TODAY,
      seed: {
        profile: { currentBalance: 1_000, initialBalance: 1_000 },
        expenseRules: [makeExpenseRule({ id: "b", name: "Phone", amount: 250, startDate: "2026-01-20", frequency: "one-time" })],
      },
    });
    const today = await calendarToday(app);
    expect(today).toEqual({ opening: 1_000, closing: 1_000 });
    expect(gridCellBalance(19)).toBe("$1,000");
    expect(gridCellBalance(20)).toBe("$750");
    expect(gridCellBalance(31)).toBe("$750");
  }, 40_000);
});

describe("calendar presentation of money", () => {
  knownDefect(
    "UI-BAL-37",
    "a negative closing balance is printed in the grid without its minus sign (Math.abs)",
    async () => {
      // observed: day 25 shows "$20" for a balance of -$20 (only the colour says it is negative)
      const app = await renderApp({
        ui: <Screens only={["settings", "calendar"]} />,
        today: TODAY,
        seed: {
          profile: { currentBalance: 100, initialBalance: 100 },
          expenseRules: [makeExpenseRule({ id: "b", name: "Bill", amount: 120, startDate: "2026-01-20", frequency: "one-time" })],
        },
      });
      // precondition: the day panel (a different code path) does print -$20 for the same day
      await app.user.click(within(screenEl("calendar")).getAllByText("25").find((el) => el.nextElementSibling)!);
      const panel = (await within(screenEl("calendar")).findByText(/^\w+day, Jan 25$/)).closest("div.sticky, div")!.parentElement!;
      expect(moneyNear("Closing", { within: panel })).toBe(-20);
      // money assertion: the grid must agree with the panel's sign
      expect(gridCellBalance(25)).toBe("-$20");
    },
    40_000
  );

  knownDefect(
    "UI-BAL-38",
    "month summary rounds cents away on signed amounts (+$1,235 for a 1,234.56 income)",
    async () => {
      // observed: Income "+$1,235", Net Change "+$1,235" (formatCurrencyWithSign defaults to 0 decimals)
      await renderApp({
        ui: <Screens only={["calendar"]} />,
        today: TODAY,
        seed: {
          profile: { currentBalance: 1_334.56, initialBalance: 100 },
          transactions: [makeManualTransaction({ id: "g", type: "income", name: "Gift", status: "completed", projectedAmount: 1_234.56, actualAmount: 1_234.56, scheduledDate: "2026-01-10", actualDate: "2026-01-10" })],
        },
      });
      // precondition: the row is in the calendar (the page counts 1 completed transaction)
      expect(screen.getByText("Transactions").parentElement!.textContent).toMatch(/1\s*\/\s*1/);
      const label = screen.getAllByText("Income")[0]; // the summary tile (the day panel repeats the word)
      const tile = label.parentElement!;
      expect(tile.textContent).toContain("+$1,23"); // 1,234.56 or its rounding 1,235 both start "+$1,23"
      expect(tile.textContent).toContain("+$1,234.56");
    },
    40_000
  );

  it("the Monthly Balance Overview opening/closing agree with the first and last day cells", async () => {
    // balance 2,000, a completed +300 on Jan 3 and a projected -700 on Jan 28.
    // opening (Jan 1) = 2,000 - 300 = 1,700 ; closing (Jan 31) = 2,000 - 700 = 1,300
    const app = await renderApp({
      ui: <Screens only={["settings", "calendar"]} />,
      today: TODAY,
      seed: {
        profile: { currentBalance: 2_000, initialBalance: 1_700 },
        transactions: [
          makeManualTransaction({ id: "in", type: "income", status: "completed", projectedAmount: 300, actualAmount: 300, scheduledDate: "2026-01-03", actualDate: "2026-01-03" }),
          makeManualTransaction({ id: "out", type: "expense", status: "projected", projectedAmount: 700, scheduledDate: "2026-01-28" }),
        ],
      },
    });
    let overview: HTMLElement = screen.getByText("Monthly Balance Overview");
    while (!/Opening/.test(overview.textContent ?? "")) overview = overview.parentElement!;
    expect(moneyNear("Opening", { within: overview })).toBe(1_700);
    expect(moneyNear("Closing", { within: overview })).toBe(1_300);
    expect(gridCellBalance(1)).toBe("$1,700");
    expect(gridCellBalance(3)).toBe("$2,000");
    expect(gridCellBalance(31)).toBe("$1,300");
    expect((await calendarToday(app)).closing).toBe(2_000);
  }, 40_000);
});
