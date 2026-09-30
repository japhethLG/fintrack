import { describe, expect, it, vi } from "vitest";
import { renderApp, screen, knownDefect } from "../harness";
import * as d from "./driver";
import type { ExpenseSpec } from "./driver";

// Cold first render (antd + radix + wizard) can exceed the 20 s default on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

/**
 * EXPENSE RULE WIZARD (fixed / variable / one-time, every frequency) -> persisted doc ->
 * Schedule Preview -> generated projections.
 *
 * 2026 calendar: Jan 1 = Thu, Feb 1 = Sun, Mar 1 = Sun, Apr 1 = Wed. "Today" is Thu 2026-01-15, so the
 * default window is Nov 2025 .. Apr 2026 and the hidden Day-of-Month / Day-of-Week defaults are 15 / Thursday.
 */

const TODAY = "2026-01-15";

async function run(spec: ExpenseSpec, opts: { today?: string; timeZone?: string } = {}) {
  const app = await renderApp({ route: "/expenses", today: opts.today ?? TODAY, timeZone: opts.timeZone });
  await d.fillExpenseToSchedule(app, spec);
  const preview = d.previewCards();
  const more = d.previewMore();
  const doc = await d.finishExpense(app, spec);
  return { app, preview, more, doc, engine: d.engineDates(app, doc.id) };
}

describe("expense wizard: fixed monthly", () => {
  it("monthly on the 1st: doc, preview and engine agree", async () => {
    // Jan 1 Thu, Feb 1 Sun, Mar 1 Sun, Apr 1 Wed; preview horizon is Apr 1 (inclusive)
    const { doc, preview, engine } = await run({
      name: "Rent",
      amount: "1200",
      frequency: "Monthly",
      start: "2026-01-01",
      dayOfMonth: "1",
      weekend: "none",
    });
    expect(doc).toMatchObject({
      name: "Rent",
      expenseType: "fixed",
      amount: 1200,
      frequency: "monthly",
      startDate: "2026-01-01",
      weekendAdjustment: "none",
      isVariableAmount: false,
      isPriority: false,
      isActive: true,
      category: "other",
    });
    expect(doc).not.toHaveProperty("endDate");
    expect(doc).not.toHaveProperty("loanConfig");
    expect(preview).toEqual(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"].map(d.label));
    expect(engine).toEqual(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]);
  });

  knownDefect("UI-RULE-19", "expense monthly: a typed Day of Month is persisted as a string ('1'), not a number", async () => {
    // observed: scheduleConfig.dayOfMonth === "1"
    const { doc } = await run({ frequency: "Monthly", start: "2026-01-01", dayOfMonth: "1", weekend: "none" });
    expect(doc.scheduleConfig).toHaveProperty("dayOfMonth"); // precondition
    expect(doc.scheduleConfig.dayOfMonth).toBe(1);
  });

  it("monthly on the 31st clamps to month ends in both preview and engine", async () => {
    const { preview, engine } = await run({
      frequency: "Monthly",
      start: "2026-01-31",
      dayOfMonth: "31",
      weekend: "none",
    });
    expect(preview).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"].map(d.label));
    expect(engine).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("'Pay on Friday' moves Sunday bills to Friday (Feb 13, Mar 13); 'after' moves them to Monday", async () => {
    // Day of Month is left at its default (15 = today). Feb 15 and Mar 15 are Sundays.
    const before = await run({ frequency: "Monthly", start: "2026-01-01", weekend: "before" });
    expect(before.doc.weekendAdjustment).toBe("before");
    expect(before.preview).toEqual(["2026-01-15", "2026-02-13", "2026-03-13"].map(d.label));
    expect(before.engine).toEqual(["2026-01-15", "2026-02-13", "2026-03-13", "2026-04-15"]);
  });

  it("'Pay on Monday' moves Sunday bills to Monday (Feb 16, Mar 16)", async () => {
    const after = await run({ frequency: "Monthly", start: "2026-01-01", weekend: "after" });
    expect(after.doc.weekendAdjustment).toBe("after");
    expect(after.preview).toEqual(["2026-01-15", "2026-02-16", "2026-03-16"].map(d.label));
    expect(after.engine).toEqual(["2026-01-15", "2026-02-16", "2026-03-16", "2026-04-15"]);
  });

  it("an end date stops the series inclusively (Jan 15, Feb 15, Mar 15) and is persisted", async () => {
    const { doc, engine } = await run({
      frequency: "Monthly",
      start: "2026-01-01",
      end: "2026-03-15",
      weekend: "none",
    });
    expect(doc.endDate).toBe("2026-03-15");
    expect(engine).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
  });

  knownDefect(
    "UI-RULE-20",
    "expense monthly: the 'First Payment Date' is not the first payment when Day of Month is left at its default (today's date)",
    async () => {
      // First Payment Date = Thu 2026-03-05; Day of Month untouched (defaults to today's 15).
      // observed: preview and engine both start on Mar 15, so the date the user entered is never paid.
      const { preview, engine } = await run({
        frequency: "Monthly",
        start: "2026-03-05",
        weekend: "none",
      });
      expect(engine.length).toBeGreaterThan(0); // precondition: something is generated
      expect(preview.length).toBeGreaterThan(0);
      expect(engine[0]).toBe("2026-03-05");
      expect(preview[0]).toBe(d.label("2026-03-05"));
    }
  );

  knownDefect(
    "UI-RULE-21",
    "expense weekly: the 'First Payment Date' is not the first payment when Day of Week is left at its default (today's weekday)",
    async () => {
      // First Payment Date = Mon 2026-02-02; Day of Week untouched = Thursday (today). observed: engine starts Thu Feb 5
      // while the preview starts Mon Feb 2 - the two disagree AND the entered date is skipped.
      const { doc, preview, engine } = await run({
        frequency: "Weekly",
        start: "2026-02-02",
        weekend: "none",
      });
      expect(doc.scheduleConfig).toEqual({ dayOfWeek: 4 }); // precondition: default is today's weekday
      expect(preview[0]).toBe(d.label("2026-02-02"));
      expect(engine[0]).toBe("2026-02-02");
    }
  );
});

describe("expense wizard: variable, priority, one-time", () => {
  it("variable expenses are forced to isVariableAmount and keep the entered estimate", async () => {
    const { doc, engine } = await run({
      kind: "Variable",
      name: "Electric",
      amount: "87.35",
      frequency: "Monthly",
      start: "2026-01-20",
      dayOfMonth: "20",
      weekend: "none",
    });
    expect(doc).toMatchObject({ expenseType: "variable", isVariableAmount: true, amount: 87.35 });
    expect(engine).toEqual(["2026-01-20", "2026-02-20", "2026-03-20", "2026-04-20"]);
  });

  it("the Priority Bill checkbox persists isPriority", async () => {
    const { doc } = await run({
      name: "Rent",
      priority: true,
      frequency: "Monthly",
      start: "2026-01-15",
    });
    expect(doc.isPriority).toBe(true);
  });

  it("one-time (2-step wizard): persists frequency one-time and generates exactly one bill on the chosen date", async () => {
    const { doc, engine } = await run({
      kind: "One-time",
      name: "Car repair",
      amount: "450.25",
      start: "2026-02-14", // a Saturday; one-time has no weekend control
    });
    expect(doc).toMatchObject({
      expenseType: "one-time",
      frequency: "one-time",
      amount: 450.25,
      startDate: "2026-02-14",
      weekendAdjustment: "none",
    });
    expect(engine).toEqual(["2026-02-14"]);
  });

  knownDefect(
    "UI-RULE-22",
    "one-time / hidden schedule values leak into the document (scheduleConfig.dayOfMonth = today's date)",
    async () => {
      // observed: scheduleConfig { dayOfMonth: 15 } on a one-time rule (the form still has frequency 'monthly'
      // when buildScheduleConfig runs; only the final `frequency` field is overridden to one-time)
      const { doc } = await run({ kind: "One-time", name: "Fee", amount: "20", start: "2026-02-14" });
      expect(doc.frequency).toBe("one-time"); // precondition
      expect(doc.scheduleConfig).toEqual({});
    }
  );
});

describe("expense wizard: weekly, bi-weekly, semi-monthly", () => {
  it("weekly on Friday: engine pays every Friday from Feb 6", async () => {
    const { doc, engine } = await run({
      frequency: "Weekly",
      start: "2026-02-02",
      dayOfWeek: "Friday",
      weekend: "none",
    });
    expect(doc.scheduleConfig).toEqual({ dayOfWeek: 5 });
    expect(engine).toEqual([
      "2026-02-06", "2026-02-13", "2026-02-20", "2026-02-27",
      "2026-03-06", "2026-03-13", "2026-03-20", "2026-03-27",
      "2026-04-03", "2026-04-10", "2026-04-17", "2026-04-24",
    ]); // prettier-ignore
  });

  knownDefect(
    "UI-RULE-23",
    "expense weekly Schedule Preview shows the start-date weekday, not the chosen Day of Week",
    async () => {
      // observed: preview Mondays (Feb 2, 9, 16 ...) while the engine bills Fridays
      const { preview, engine } = await run({
        frequency: "Weekly",
        start: "2026-02-02",
        dayOfWeek: "Friday",
        weekend: "none",
      });
      expect(engine.slice(0, 2)).toEqual(["2026-02-06", "2026-02-13"]); // precondition
      expect(preview.slice(0, 3)).toEqual(["2026-02-06", "2026-02-13", "2026-02-20"].map(d.label));
    }
  );

  it("weekly preview honours the 3-month horizon: start Feb 6 Fri -> 13 Fridays but only 12 are previewed", async () => {
    // Feb 6 .. horizon May 6: Fridays Feb 6,13,20,27, Mar 6,13,20,27, Apr 3,10,17,24, May 1 = 13; preview caps at 12
    const { preview, more } = await run({
      frequency: "Weekly",
      start: "2026-02-06",
      dayOfWeek: "Friday",
      weekend: "none",
    });
    expect(preview).toHaveLength(8);
    expect(more).toBe(4); // 12 - 8
    expect(preview[7]).toBe(d.label("2026-03-27"));
  });

  it("bi-weekly: doc {dayOfWeek, intervalWeeks:2}; engine every second Friday", async () => {
    const { doc, engine } = await run({
      frequency: "Bi-weekly",
      start: "2026-01-16",
      dayOfWeek: "Friday",
      weekend: "none",
    });
    expect(doc.scheduleConfig).toEqual({ dayOfWeek: 5, intervalWeeks: 2 });
    expect(engine).toEqual([
      "2026-01-16", "2026-01-30", "2026-02-13", "2026-02-27",
      "2026-03-13", "2026-03-27", "2026-04-10", "2026-04-24",
    ]); // prettier-ignore
  });

  it("semi-monthly starts with a single default day [1]; adding 15 gives the 1st and 15th in all three views", async () => {
    const { doc, preview, engine } = await run({
      frequency: "Semi-monthly",
      start: "2026-01-01",
      weekend: "none",
      specificDays: [1, 15],
    });
    expect(doc.scheduleConfig).toEqual({ specificDays: [1, 15] });
    expect(preview).toEqual(
      ["2026-01-01", "2026-01-15", "2026-02-01", "2026-02-15", "2026-03-01", "2026-03-15", "2026-04-01"].map(d.label)
    );
    expect(engine).toEqual([
      "2026-01-01", "2026-01-15", "2026-02-01", "2026-02-15",
      "2026-03-01", "2026-03-15", "2026-04-01", "2026-04-15",
    ]); // prettier-ignore
  });

  knownDefect("UI-RULE-24", "expense semi-monthly chip for the default day reads '1th'", async () => {
    // observed: "1th" (default specificDays is [1])
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, { frequency: "Semi-monthly" });
    const chips = screen.getAllByText(/^\d+(st|nd|rd|th)$/).map((e) => e.textContent);
    expect(chips.map((c) => parseInt(c!))).toEqual([1]); // precondition: one chip, day 1
    expect(chips[0]).toBe("1st");
  });

  knownDefect(
    "UI-RULE-25",
    "expense semi-monthly with every date removed can be saved and never generates a bill",
    async () => {
      // observed: rule saved with scheduleConfig { specificDays: [] }
      const app = await renderApp({ route: "/expenses", today: TODAY });
      await d.fillExpenseToSchedule(app, { frequency: "Semi-monthly", specificDays: [] });
      expect(screen.queryAllByText(/^\d+(st|nd|rd|th)$/)).toHaveLength(0); // precondition
      const create = screen.getByRole("button", { name: "Create Expense" });
      if (!create.hasAttribute("disabled")) {
        await app.user.click(create);
        await app.settle();
      }
      expect(d.ruleDocs(app)).toHaveLength(0);
    }
  );

  knownDefect(
    "UI-RULE-26",
    "semi-monthly expense Schedule Preview does not clamp day 30 in February",
    async () => {
      // days [15, 30]: engine Feb 15 & Feb 28; observed preview shows Mar 2 for the second February date
      const { preview, engine } = await run({
        frequency: "Semi-monthly",
        start: "2026-01-01",
        weekend: "none",
        specificDays: [15, 30],
      });
      expect(engine).toContain("2026-02-28"); // precondition
      expect(preview).toEqual(
        ["2026-01-15", "2026-01-30", "2026-02-15", "2026-02-28", "2026-03-15", "2026-03-30"].map(d.label)
      );
    }
  );
});

describe("expense wizard: quarterly and yearly (hypothesis: expense form persists scheduleConfig {})", () => {
  it("quarterly: the form persists an empty scheduleConfig", async () => {
    const { doc } = await run({ frequency: "Quarterly", start: "2026-01-05", weekend: "none" });
    expect(doc.frequency).toBe("quarterly");
    expect(doc.scheduleConfig).toEqual({});
  });

  it("quarterly: the Schedule Preview shows the user's schedule (Jan 5, Apr 5)", async () => {
    const { preview } = await run({ frequency: "Quarterly", start: "2026-01-05", weekend: "none" });
    expect(preview).toEqual(["2026-01-05", "2026-04-05"].map(d.label));
  });

  knownDefect(
    "UI-RULE-27",
    "quarterly expense: engine bills on the 1st of the quarter month, not on the day the user scheduled",
    async () => {
      // start Mon 2026-01-05 -> correct: Jan 5, Apr 5. observed engine: only Apr 1 (Jan 1 < start is dropped)
      const { preview, engine } = await run({ frequency: "Quarterly", start: "2026-01-05", weekend: "none" });
      expect(preview).toEqual(["2026-01-05", "2026-04-05"].map(d.label)); // precondition: what the user approved
      expect(engine).toEqual(["2026-01-05", "2026-04-05"]);
    }
  );

  knownDefect(
    "UI-RULE-28",
    "quarterly expense from Jan 31: the Schedule Preview omits Apr 30 (Jan 31 + 3 months overflows to May 1)",
    async () => {
      // observed preview: [Jan 31] only. Correct (clamped) quarterly dates inside the horizon: Jan 31, Apr 30
      const { preview } = await run(
        { frequency: "Quarterly", start: "2026-01-31", weekend: "none" },
        { today: "2026-01-31" }
      );
      expect(preview[0]).toBe(d.label("2026-01-31")); // precondition
      expect(preview).toEqual(["2026-01-31", "2026-04-30"].map(d.label));
    }
  );

  it("yearly: hypothesis REFUTED - {} config is harmless because the engine falls back to the start month and day", async () => {
    const { doc, app, preview } = await run({ frequency: "Yearly", start: "2026-03-05", weekend: "none" });
    expect(doc.scheduleConfig).toEqual({});
    expect(preview).toEqual([d.label("2026-03-05")]);
    expect(d.engineDates(app, doc.id, { from: "2025-11-02", to: "2026-04-28" })).toEqual(["2026-03-05"]);
  });

  it("yearly starting in January (month index 0) is generated in January", async () => {
    const { app, doc } = await run(
      { frequency: "Yearly", start: "2026-01-20", weekend: "none" },
      { today: "2026-01-15" }
    );
    expect(d.engineDates(app, doc.id, { from: "2025-11-02", to: "2026-04-28" })).toEqual(["2026-01-20"]);
  });

  it("yearly expense created in America/New_York on the 1st of a month is not shifted (config is {})", async () => {
    // the income wizard corrupts monthOfYear here (UI-RULE-10); the expense wizard writes no month at all
    const { app, doc } = await run(
      { frequency: "Yearly", start: "2026-03-01", weekend: "none" },
      { today: "2026-03-01", timeZone: "America/New_York" }
    );
    expect(d.engineDates(app, doc.id, { from: "2026-01-01", to: "2026-07-25" })).toEqual(["2026-03-01"]);
  });
});

describe("expense wizard: frequency choices and validation", () => {
  it("fixed expenses offer one-time..yearly but no 'Daily' (the income wizard does)", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, {});
    await app.user.click(screen.getByLabelText(/^Frequency/));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["One-time", "Weekly", "Bi-weekly", "Semi-monthly", "Monthly", "Quarterly", "Yearly"]);
  });

  it.todo("DECISION: should expense rules offer a Daily frequency (the engine and IncomeFrequency support it; the income form offers it)?");

  it.each([
    ["negative", "-5"],
    ["zero", "0"],
    ["empty", ""],
  ])("a %s amount blocks Continue on the details step", async (_n, value) => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.openExpenseForm(app);
    await d.next(app);
    await d.fill(app, /^Expense Name/, "Rent");
    await d.fill(app, /^Amount/, value);
    expect(d.nextButton()).toBeDisabled();
  });

  it("a one-time expense cannot be created with a zero amount", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.openExpenseForm(app);
    await app.user.click(screen.getByRole("heading", { name: "One-time" }));
    await d.next(app);
    await d.fill(app, /^Expense Name/, "Fee");
    await d.fill(app, /^Amount/, "0");
    expect(screen.getByRole("button", { name: "Create Expense" })).toBeDisabled();
  });

  it("a whitespace-only name blocks Continue", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.openExpenseForm(app);
    await d.next(app);
    await d.fill(app, /^Expense Name/, "  ");
    await d.fill(app, /^Amount/, "10");
    expect(d.nextButton()).toBeDisabled();
  });

  it("decimal and very large amounts are stored exactly", async () => {
    const { doc } = await run({ amount: "1234567890.12", frequency: "Monthly", start: "2026-02-01" });
    expect(doc.amount).toBe(1234567890.12);
  });

  knownDefect(
    "UI-RULE-29",
    "an expense whose end date is before its first payment date is accepted and never generates a bill",
    async () => {
      // observed: rule saved with startDate 2026-03-01 / endDate 2026-02-01 and zero projections
      const app = await renderApp({ route: "/expenses", today: TODAY });
      await d.fillExpenseToSchedule(app, {
        frequency: "Monthly",
        start: "2026-03-01",
        end: "2026-02-01",
        weekend: "none",
      });
      expect((screen.getByLabelText(/^End Date/) as HTMLInputElement).value).toBe("02/01/2026"); // precondition
      const create = screen.getByRole("button", { name: "Create Expense" });
      if (!create.hasAttribute("disabled")) {
        await app.user.click(create);
        await app.settle();
      }
      expect(d.ruleDocs(app)).toHaveLength(0);
    }
  );

  knownDefect(
    "UI-RULE-30",
    "expense form: Date/First Payment Date defaults to yesterday between 00:00 and 08:00 local in Asia/Manila",
    async () => {
      // 2026-01-15 00:30 Manila = 2026-01-14T16:30Z; observed default "01/14/2026"
      const app = await renderApp({
        route: "/expenses",
        today: "2026-01-15T00:30",
        timeZone: "Asia/Manila",
      });
      expect(new Date().getDate()).toBe(15); // precondition
      await d.fillExpenseToSchedule(app, { frequency: "Monthly" });
      expect((screen.getByLabelText(/^First Payment Date/) as HTMLInputElement).value).toBe("01/15/2026");
    }
  );

  it.todo("DECISION: weekend adjustment at a rule boundary (first payment on a Saturday with 'before'; last payment on a Sunday with 'after' past the end date): drop vs clamp");
});
