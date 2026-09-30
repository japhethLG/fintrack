import { describe, expect, it, vi } from "vitest";
import { renderApp, knownDefect, moneyNear, type AppHandle, type AppSeed } from "../harness";
import * as d from "./driver";

// Cold first render (antd + radix + wizard) can exceed the 20 s default on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

/**
 * Create a rule through the real wizard on its manager page, then re-mount the app on the CALENDAR with the
 * persisted document(s) and read the month summary the user will actually look at.
 *
 * 2026: Fridays in January are 2, 9, 16, 23, 30.  "Today" is Thu 2026-01-15.
 */

const TODAY = "2026-01-15";

async function onCalendar(previous: AppHandle, seed: AppSeed) {
  previous.unmount();
  return renderApp({ route: "/calendar", today: TODAY, seed });
}

describe("wizard -> persisted rule -> calendar month summary (January 2026)", () => {
  it("a weekly $100 Friday income created in the wizard shows +$500 for January (5 Fridays)", async () => {
    const app = await renderApp({ route: "/income", today: TODAY });
    const doc = await d.createIncome(app, {
      name: "Weekly Gig",
      amount: "100",
      frequency: "Weekly",
      start: "2026-01-02",
      dayOfWeek: "Friday",
      weekend: "none",
    });
    expect(doc.scheduleConfig).toEqual({ dayOfWeek: 5 });
    await onCalendar(app, { incomeSources: [doc as never] });
    expect(moneyNear("Income", { occurrence: 0 })).toBe(500);
  });

  it("a monthly $1,200 expense on the 20th created in the wizard shows -$1,200 for January", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    const doc = await d.createExpense(app, {
      name: "Rent",
      amount: "1200",
      frequency: "Monthly",
      start: "2026-01-20",
      dayOfMonth: "20",
      weekend: "none",
    });
    await onCalendar(app, { expenseRules: [doc as never] });
    expect(moneyNear("Expenses", { occurrence: 0 })).toBe(-1200);
  });

  knownDefect(
    "UI-RULE-70",
    "a quarterly $300 expense scheduled for Jan 5 in the wizard is missing from the January calendar",
    async () => {
      // the wizard's Schedule Preview promised Jan 5; the persisted scheduleConfig {} makes the engine bill Apr 1.
      // observed: January Expenses -$0
      const app = await renderApp({ route: "/expenses", today: TODAY });
      await d.fillExpenseToSchedule(app, {
        name: "Insurance",
        amount: "300",
        frequency: "Quarterly",
        start: "2026-01-05",
        weekend: "none",
      });
      expect(d.previewCards()[0]).toBe(d.label("2026-01-05")); // precondition: the user was promised Jan 5
      const doc = await d.finishExpense(app);
      expect(doc.scheduleConfig).toEqual({}); // precondition: the persisted cause
      await onCalendar(app, { expenseRules: [doc as never] });
      expect(moneyNear("Expenses", { occurrence: 0 })).toBe(-300);
    }
  );
});
