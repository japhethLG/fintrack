import { describe, expect, it, vi } from "vitest";
import { renderApp, screen, waitFor, knownDefect, makeIncomeSource } from "../harness";
import * as d from "./driver";
import type { IncomeSpec } from "./driver";

// Cold first render (antd + radix + wizard) can exceed the 20 s default on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

/**
 * INCOME SOURCE WIZARD -> persisted doc -> Schedule Preview -> generated projections.
 *
 * Every test drives the real 4-step wizard on /income. Three views of one rule are compared
 * against HAND-LISTED dates (2026 calendar: Jan 1 = Thu, Feb 1 = Sun, Mar 1 = Sun, Apr 1 = Wed;
 * "today" is Thu 2026-01-15, so the default window is Nov 2025 .. Apr 2026):
 *   (a) the document in `income_sources`
 *   (b) the form's own Schedule Preview cards (3-month horizon, 12 max, first 8 rendered)
 *   (c) the transactions `useFinancial()` actually generates.
 */

const TODAY = "2026-01-15";

async function run(spec: IncomeSpec, opts: { today?: string; timeZone?: string } = {}) {
  const app = await renderApp({
    route: "/income",
    today: opts.today ?? TODAY,
    timeZone: opts.timeZone,
  });
  await d.fillIncomeToSchedule(app, spec);
  const preview = d.previewCards();
  const more = d.previewMore();
  const doc = await d.finishIncome(app, spec);
  return { app, preview, more, doc, engine: d.engineDates(app, doc.id) };
}

// ---------------------------------------------------------------------------
describe("income wizard: persisted document, preview and projections per frequency", () => {
  it("one-time on a Saturday with the default 'before' adjustment lands on Friday in all three views", async () => {
    // 2026-02-14 is a Saturday -> Friday 2026-02-13
    const { doc, preview, engine } = await run({
      name: "Bonus",
      amount: "2500",
      frequency: "One-time",
      start: "2026-02-14",
    });
    expect(doc).toMatchObject({
      name: "Bonus",
      amount: 2500,
      frequency: "one-time",
      startDate: "2026-02-14",
      scheduleConfig: {},
      weekendAdjustment: "before",
      isActive: true,
      userId: "user-1",
    });
    expect(doc).not.toHaveProperty("endDate");
    expect(preview).toEqual([d.label("2026-02-13")]);
    expect(engine).toEqual(["2026-02-13"]);
  });

  it("one-time with 'no adjustment' stays on the Saturday", async () => {
    const { doc, preview, engine } = await run({
      frequency: "One-time",
      start: "2026-02-14",
      weekend: "none",
    });
    expect(doc.weekendAdjustment).toBe("none");
    expect(preview).toEqual(["Feb 14 Sat"]);
    expect(engine).toEqual(["2026-02-14"]);
  });

  it("daily (no adjustment) Feb 6-10 persists an empty config and yields five consecutive days", async () => {
    // Fri 6, Sat 7, Sun 8, Mon 9, Tue 10
    const { doc, preview, engine } = await run({
      amount: "10",
      frequency: "Daily",
      start: "2026-02-06",
      end: "2026-02-10",
      weekend: "none",
    });
    expect(doc).toMatchObject({ frequency: "daily", endDate: "2026-02-10", scheduleConfig: {} });
    const days = ["2026-02-06", "2026-02-07", "2026-02-08", "2026-02-09", "2026-02-10"];
    expect(preview).toEqual(days.map(d.label));
    expect(engine).toEqual(days);
  });

  it("weekly on Friday: doc stores dayOfWeek 5 (a number) and the engine pays every Friday from the first one on/after the start", async () => {
    // start Mon 2026-02-02 -> first Friday is 02-06; every 7 days; window edge is Apr 28 (safe)
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
    "UI-RULE-01",
    "income weekly Schedule Preview ignores the chosen Day of Week (shows start-date weekday)",
    async () => {
      // observed: preview cards are Mondays (Feb 2, Feb 9 ...) although the rule pays on Fridays
      const { preview, engine } = await run({
        frequency: "Weekly",
        start: "2026-02-02",
        dayOfWeek: "Friday",
        weekend: "none",
      });
      expect(engine.slice(0, 2)).toEqual(["2026-02-06", "2026-02-13"]); // precondition: the engine pays Fridays
      expect(preview).toHaveLength(8);
      expect(preview.slice(0, 4)).toEqual(
        ["2026-02-06", "2026-02-13", "2026-02-20", "2026-02-27"].map(d.label)
      );
    }
  );

  it("bi-weekly on the start weekday: doc {dayOfWeek, intervalWeeks: 2}; preview (3-month horizon) and engine agree", async () => {
    // Fri 2026-01-16 + 14d: 01-16, 01-30, 02-13, 02-27, 03-13, 03-27, 04-10, 04-24
    // preview horizon = start + 3 months = Apr 16 -> 7 cards (04-24 is beyond it)
    const { doc, preview, more, engine } = await run({
      frequency: "Bi-weekly (Every 2 weeks)",
      start: "2026-01-16",
      dayOfWeek: "Friday",
      weekend: "none",
    });
    expect(doc.scheduleConfig).toEqual({ dayOfWeek: 5, intervalWeeks: 2 });
    expect(preview).toEqual(
      ["2026-01-16", "2026-01-30", "2026-02-13", "2026-02-27", "2026-03-13", "2026-03-27", "2026-04-10"].map(d.label)
    );
    expect(more).toBe(0);
    expect(engine).toEqual([
      "2026-01-16", "2026-01-30", "2026-02-13", "2026-02-27",
      "2026-03-13", "2026-03-27", "2026-04-10", "2026-04-24",
    ]); // prettier-ignore
  });

  knownDefect(
    "UI-RULE-02",
    "income bi-weekly Schedule Preview ignores the chosen Day of Week",
    async () => {
      // start Mon 2026-02-02, pays Fridays every 2 weeks: 02-06, 02-20, 03-06, 03-20
      // observed preview: Feb 2, Feb 16, Mar 2, Mar 16 (Mondays)
      const { preview, engine } = await run({
        frequency: "Bi-weekly (Every 2 weeks)",
        start: "2026-02-02",
        dayOfWeek: "Friday",
        weekend: "none",
      });
      expect(engine.slice(0, 4)).toEqual(["2026-02-06", "2026-02-20", "2026-03-06", "2026-03-20"]);
      expect(preview.slice(0, 4)).toEqual(
        ["2026-02-06", "2026-02-20", "2026-03-06", "2026-03-20"].map(d.label)
      );
    }
  );

  it("semi-monthly 15th & 30th: engine clamps day 30 to Feb 28", async () => {
    const { doc, engine } = await run({
      frequency: "Semi-monthly (e.g., 15th & 30th)",
      start: "2026-01-01",
      weekend: "none",
    });
    expect(doc.scheduleConfig).toEqual({ specificDays: [15, 30] });
    expect(engine).toEqual([
      "2026-01-15", "2026-01-30", "2026-02-15", "2026-02-28",
      "2026-03-15", "2026-03-30", "2026-04-15",
    ]); // prettier-ignore
  });

  knownDefect(
    "UI-RULE-03",
    "semi-monthly Schedule Preview does not clamp day 30 in February (shows Mar 2)",
    async () => {
      // observed preview: Jan 15, Jan 30, Feb 15, Mar 2, Mar 15, Mar 30 ("Feb 30" overflows)
      const { preview, engine } = await run({
        frequency: "Semi-monthly (e.g., 15th & 30th)",
        start: "2026-01-01",
        weekend: "none",
      });
      expect(engine).toContain("2026-02-28"); // precondition: the engine clamps
      expect(preview).toHaveLength(6); // Jan 15/30, Feb, Mar 15/30 within the 3-month horizon
      expect(preview).toEqual(
        ["2026-01-15", "2026-01-30", "2026-02-15", "2026-02-28", "2026-03-15", "2026-03-30"].map(d.label)
      );
    }
  );

  it("semi-monthly with custom days [1, 16]: chips replace the defaults; doc, preview and engine agree", async () => {
    const { doc, preview, engine } = await run({
      frequency: "Semi-monthly (e.g., 15th & 30th)",
      start: "2026-01-01",
      weekend: "none",
      specificDays: [1, 16],
    });
    expect(doc.scheduleConfig).toEqual({ specificDays: [1, 16] });
    // preview horizon = Jan 1 + 3 months = Apr 1 (inclusive)
    expect(preview).toEqual(
      ["2026-01-01", "2026-01-16", "2026-02-01", "2026-02-16", "2026-03-01", "2026-03-16", "2026-04-01"].map(d.label)
    );
    expect(engine).toEqual([
      "2026-01-01", "2026-01-16", "2026-02-01", "2026-02-16",
      "2026-03-01", "2026-03-16", "2026-04-01", "2026-04-16",
    ]); // prettier-ignore
  });

  knownDefect("UI-RULE-04", "semi-monthly day chips use the ordinal suffix 'th' for every day (1th, 2th, 22th)", async () => {
    // observed: "1th"
    const app = await renderApp({ route: "/income", today: TODAY });
    await d.fillIncomeToSchedule(app, {
      frequency: "Semi-monthly (e.g., 15th & 30th)",
      specificDays: [1, 2, 22],
    });
    const chips = screen.getAllByText(/^\d+(st|nd|rd|th)$/).map((e) => e.textContent);
    expect(chips.map((c) => parseInt(c!))).toEqual([1, 2, 22]); // precondition: three chips, sorted
    expect(chips).toEqual(["1st", "2nd", "22nd"]);
  });

  knownDefect(
    "UI-RULE-05",
    "semi-monthly with every date removed can be saved and silently never generates income",
    async () => {
      // observed: income_sources gets a doc with scheduleConfig { specificDays: [] } and zero projections
      const app = await renderApp({ route: "/income", today: TODAY });
      await d.fillIncomeToSchedule(app, {
        frequency: "Semi-monthly (e.g., 15th & 30th)",
        specificDays: [],
      });
      expect(screen.queryAllByText(/^\d+(st|nd|rd|th)$/)).toHaveLength(0); // precondition: chips gone
      if (!d.nextButton().hasAttribute("disabled")) {
        await app.user.click(d.nextButton());
        await app.user.click(await screen.findByRole("button", { name: "Create Income Source" }));
        await app.settle();
      }
      expect(d.incomeDocs(app)).toHaveLength(0);
    }
  );

  it("monthly on the 31st: engine clamps to month ends (Jan 31, Feb 28, Mar 31, Apr 30) and preview agrees", async () => {
    const { preview, engine } = await run({
      frequency: "Monthly",
      start: "2026-01-31",
      dayOfMonth: "31",
      weekend: "none",
    });
    expect(preview).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"].map(d.label));
    expect(engine).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]); // Apr 30 is outside the TZ-safe clip
  });

  knownDefect("UI-RULE-06", "a typed Day of Month is persisted as a string ('31'), not a number", async () => {
    // observed: scheduleConfig.dayOfMonth === "31" (only the untouched default is a number)
    const { doc } = await run({
      frequency: "Monthly",
      start: "2026-01-31",
      dayOfMonth: "31",
      weekend: "none",
    });
    expect(doc.scheduleConfig).toHaveProperty("dayOfMonth"); // precondition
    expect(doc.scheduleConfig.dayOfMonth).toBe(31);
  });

  it("monthly day 15 with 'Pay on Friday' moves the Sunday paydays to Friday (Feb 13, Mar 13)", async () => {
    // day of month is left at its default (15 = today's date). Feb 15 and Mar 15 2026 are Sundays.
    const { doc, preview, engine } = await run({
      frequency: "Monthly",
      start: "2026-01-01",
      weekend: "before",
    });
    expect(doc).toMatchObject({ weekendAdjustment: "before", scheduleConfig: { dayOfMonth: 15 } });
    expect(preview).toEqual(["2026-01-15", "2026-02-13", "2026-03-13"].map(d.label));
    expect(engine).toEqual(["2026-01-15", "2026-02-13", "2026-03-13", "2026-04-15"]);
  });

  it("monthly day 15 with 'Pay on Monday' moves the Sunday paydays to Monday (Feb 16, Mar 16)", async () => {
    const { doc, preview, engine } = await run({
      frequency: "Monthly",
      start: "2026-01-01",
      weekend: "after",
    });
    expect(doc.weekendAdjustment).toBe("after");
    expect(preview).toEqual(["2026-01-15", "2026-02-16", "2026-03-16"].map(d.label));
    expect(engine).toEqual(["2026-01-15", "2026-02-16", "2026-03-16", "2026-04-15"]);
  });

  it("semi-monthly 15th & 30th with 'Pay on Friday': Sunday the 15th and Saturday Feb 28 move to Friday", async () => {
    // Jan 15 Thu, Jan 30 Fri, Feb 15 Sun -> Fri 13, Feb 28 Sat (clamped 30th) -> Fri 27, Mar 15 Sun -> Fri 13, Mar 30 Mon, Apr 15 Wed
    const { engine } = await run({
      frequency: "Semi-monthly (e.g., 15th & 30th)",
      start: "2026-01-01",
      weekend: "before",
    });
    expect(engine).toEqual([
      "2026-01-15", "2026-01-30", "2026-02-13", "2026-02-27",
      "2026-03-13", "2026-03-30", "2026-04-15",
    ]); // prettier-ignore
  });

  it("weekly on Saturday with 'Pay on Monday' pays on the Monday after each Saturday", async () => {
    // Saturdays Feb 7, 14, 21, 28 -> Mondays Feb 9, 16, 23, Mar 2
    const { engine } = await run({
      frequency: "Weekly",
      start: "2026-02-07",
      dayOfWeek: "Saturday",
      weekend: "after",
    });
    expect(engine.slice(0, 4)).toEqual(["2026-02-09", "2026-02-16", "2026-02-23", "2026-03-02"]);
  });

  it("monthly with an end date: the end date is inclusive and later paydays are not generated", async () => {
    // day 15, end Sun 2026-03-15 (weekend none): Jan 15, Feb 15, Mar 15 and nothing after
    const { doc, engine } = await run({
      frequency: "Monthly",
      start: "2026-01-01",
      end: "2026-03-15",
      weekend: "none",
    });
    expect(doc.endDate).toBe("2026-03-15");
    expect(engine).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
  });

  it("monthly with an end date one day before a payday excludes that payday", async () => {
    const { engine } = await run({
      frequency: "Monthly",
      start: "2026-01-01",
      end: "2026-03-14",
      weekend: "none",
    });
    expect(engine).toEqual(["2026-01-15", "2026-02-15"]);
  });

  it("quarterly income whose start day equals today's day-of-month is generated correctly (Mar 5, Jun 5)", async () => {
    // today == start day, so the hidden dayOfMonth default (today's date) happens to be right
    const { doc, app } = await run(
      { frequency: "Quarterly", start: "2026-03-05", weekend: "none" },
      { today: "2026-03-05" }
    );
    expect(doc.scheduleConfig).toEqual({ dayOfMonth: 5, monthOfYear: 2 });
    expect(d.engineDates(app, doc.id, { from: "2026-01-01", to: "2026-07-25" })).toEqual([
      "2026-03-05",
      "2026-06-05",
    ]);
  });

  knownDefect(
    "UI-RULE-07",
    "quarterly/yearly income ignore the start date's day: the hidden Day of Month is today's date (15th)",
    async () => {
      // Start Thu 2026-01-01, quarterly, created on 2026-01-15. The wizard has no Day of Month field for
      // quarterly, the preview shows Jan 1 / Apr 1, but doc.scheduleConfig.dayOfMonth = 15 (today) so the
      // engine pays Jan 15 / Apr 15.
      const { preview, engine } = await run({
        frequency: "Quarterly",
        start: "2026-01-01",
        weekend: "none",
      });
      expect(preview.slice(0, 2)).toEqual(["2026-01-01", "2026-04-01"].map(d.label)); // preview is right
      expect(engine).toHaveLength(2); // precondition: two quarters in the window
      expect(engine).toEqual(["2026-01-01", "2026-04-01"]);
    }
  );

  knownDefect(
    "UI-RULE-08",
    "quarterly Schedule Preview from Jan 31 overflows month ends (May 1, Aug 1, Nov 1) instead of Apr 30, Jul 31, Oct 31",
    async () => {
      // today == start (Jan 31) so the engine's hidden dayOfMonth is correct: it pays Jan 31 / Apr 30.
      // preview uses Date#setMonth(+3) from Jan 31 -> "Apr 31" -> May 1 and keeps drifting.
      const { preview, engine } = await run(
        { frequency: "Quarterly", start: "2026-01-31", end: "2026-12-31", weekend: "none" },
        { today: "2026-01-31" }
      );
      expect(engine).toEqual(["2026-01-31"]); // precondition (Apr 30 is outside the TZ-safe clip)
      expect(preview).toHaveLength(4);
      expect(preview).toEqual(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"].map(d.label));
    }
  );

  knownDefect(
    "UI-RULE-09",
    "yearly Schedule Preview from Feb 29 drifts to Mar 1 forever (Feb 28 expected in non-leap years)",
    async () => {
      // 2028-02-29 (Tue). Next years: Feb 28 2029, Feb 28 2030, Feb 28 2031, Feb 29 2032.
      // observed: Feb 29, Mar 1, Mar 1, Mar 1, Mar 1
      const { preview } = await run(
        { frequency: "Yearly", start: "2028-02-29", end: "2032-12-31", weekend: "none" },
        { today: "2028-02-29" }
      );
      expect(preview).toHaveLength(5); // precondition: five yearly occurrences 2028..2032
      expect(preview.map((p) => p.split(" ").slice(0, 2).join(" "))).toEqual([
        "Feb 29",
        "Feb 28",
        "Feb 28",
        "Feb 28",
        "Feb 29",
      ]);
    }
  );

  it("yearly income on 2026-03-05 (today == start day): doc {dayOfMonth: 5, monthOfYear: 2}, engine pays Mar 5", async () => {
    const { doc, app, preview } = await run(
      { frequency: "Yearly", start: "2026-03-05", weekend: "none" },
      { today: "2026-03-05" }
    );
    expect(doc.scheduleConfig).toEqual({ dayOfMonth: 5, monthOfYear: 2 });
    expect(preview).toEqual([d.label("2026-03-05")]);
    expect(d.engineDates(app, doc.id, { from: "2026-01-01", to: "2026-07-25" })).toEqual(["2026-03-05"]);
  });

  it("yearly income with a January start (month index 0) is generated in January (UTC)", async () => {
    // today == start == Thu 2026-01-01 -> dayOfMonth 1, monthOfYear 0. `0 || start.getMonth()` still yields 0.
    const { doc, app } = await run(
      { frequency: "Yearly", start: "2026-01-01", weekend: "none" },
      { today: "2026-01-01", timeZone: "UTC" }
    );
    expect(doc.scheduleConfig).toEqual({ dayOfMonth: 1, monthOfYear: 0 });
    expect(d.engineDates(app, doc.id, { from: "2025-11-02", to: "2026-04-28" })).toEqual(["2026-01-01"]);
  });

  it("yearly income in a positive-offset zone (Asia/Manila) saves the right month", async () => {
    const { doc } = await run(
      { frequency: "Yearly", start: "2026-03-01", weekend: "none" },
      { today: "2026-03-01", timeZone: "Asia/Manila" }
    );
    expect(doc.scheduleConfig.monthOfYear).toBe(2); // March, zero-based
  });

  knownDefect(
    "UI-RULE-10",
    "yearly income saved in a negative-offset zone (America/New_York) gets the previous month as monthOfYear",
    async () => {
      // start 2026-03-01: new Date("2026-03-01") is Feb 28 19:00 local in New York -> getMonth() = 1.
      // observed: monthOfYear 1 (February) instead of 2 (March)
      const { doc } = await run(
        { frequency: "Yearly", start: "2026-03-01", weekend: "none" },
        { today: "2026-03-01", timeZone: "America/New_York" }
      );
      expect(doc.frequency).toBe("yearly"); // precondition
      expect(doc.startDate).toBe("2026-03-01");
      expect(doc.scheduleConfig.monthOfYear).toBe(2);
    }
  );

  knownDefect(
    "UI-RULE-11",
    "a January-start yearly income in America/New_York is projected for December instead of January",
    async () => {
      // start 2026-01-01 -> monthOfYear 11 (Dec) in NY. Engine emits Dec 1 2026 (outside the window)
      // instead of Jan 1 2026, so the income is missing from the projections entirely.
      const { doc, app } = await run(
        { frequency: "Yearly", start: "2026-01-01", weekend: "none" },
        { today: "2026-01-01", timeZone: "America/New_York" }
      );
      expect(doc.startDate).toBe("2026-01-01"); // precondition
      expect(d.engineDates(app, doc.id, { from: "2025-11-02", to: "2026-04-28" })).toEqual(["2026-01-01"]);
    }
  );

  it.todo("DECISION: weekend adjustment at a rule boundary (e.g. one-time/first payment on a Saturday with 'before' lands before the start date; 'after' past the end date): drop vs clamp");
  it.todo("DECISION: hidden defaults - Day of Week / Day of Month default to TODAY's weekday/date, not the Start Date's; is the Start Date meant to fix the schedule?");
});

// ---------------------------------------------------------------------------
describe("income wizard: daily and weekend interactions", () => {
  it("daily with 'Pay on Friday' produces a payment for the Mon-Fri days and moves Sat/Sun onto Friday", async () => {
    // documents the raw behaviour: Fri 6, Sat->Fri 6, Sun->Fri 6, Mon 9, Tue 10 (see UI-RULE-12)
    const { engine } = await run({
      frequency: "Daily",
      start: "2026-02-06",
      end: "2026-02-10",
      weekend: "before",
    });
    expect(engine).toContain("2026-02-09");
    expect(engine).toContain("2026-02-10");
    expect(engine).toHaveLength(5);
  });

  knownDefect(
    "UI-RULE-12",
    "daily + weekend adjustment stacks three payments on the same Friday (engine)",
    async () => {
      // Fri 02-06, Sat 02-07 -> Fri, Sun 02-08 -> Fri. observed: ["02-06","02-06","02-06","02-09","02-10"]
      const { engine } = await run({
        frequency: "Daily",
        start: "2026-02-06",
        end: "2026-02-10",
        weekend: "before",
      });
      expect(engine).toContain("2026-02-09"); // precondition: engine produced the weekdays
      expect(new Set(engine).size).toBe(engine.length); // at most one payment per date
    }
  );

  knownDefect(
    "UI-RULE-13",
    "daily + weekend adjustment shows duplicate cards in the Schedule Preview",
    async () => {
      // observed cards: Feb 6 Fri, Feb 6 Fri, Feb 6 Fri, Feb 9 Mon, Feb 10 Tue
      const { preview } = await run({
        frequency: "Daily",
        start: "2026-02-06",
        end: "2026-02-10",
        weekend: "before",
      });
      expect(preview).toContain("Feb 9 Mon"); // precondition
      expect(new Set(preview).size).toBe(preview.length);
    }
  );
});

// ---------------------------------------------------------------------------
describe("income wizard: field mapping and validation", () => {
  it("persists every step-2 field: type, name (trimmed), amount, category, variable flag, notes and colour", async () => {
    const { doc } = await run({
      type: "Freelance",
      name: "  Design Work  ",
      amount: "1234.56",
      category: "Freelance",
      variable: true,
      frequency: "Monthly",
      start: "2026-02-10",
      notes: "  invoice net-30 ",
      weekend: "after",
    });
    expect(doc).toMatchObject({
      name: "Design Work",
      sourceType: "freelance",
      amount: 1234.56,
      isVariableAmount: true,
      category: "Freelance",
      notes: "invoice net-30",
      color: "#22c55e",
      weekendAdjustment: "after",
      isActive: true,
    });
  });

  it.each([
    "Salary",
    "Freelance",
    "Business",
    "Investment",
    "Rental",
    "Government",
    "Gift",
    "Other",
  ])("source type card '%s' is persisted as its lower-case sourceType", async (type) => {
    const app = await renderApp({ route: "/income", today: TODAY });
    const doc = await d.createIncome(app, { type, name: `${type} src`, frequency: "One-time" });
    expect(doc.sourceType).toBe(type.toLowerCase());
  });

  it("an unchecked 'Set End Date' persists no endDate key", async () => {
    const { doc } = await run({ frequency: "Monthly", start: "2026-02-10" });
    expect(doc).not.toHaveProperty("endDate");
  });

  knownDefect(
    "UI-RULE-14",
    "'Set End Date' ticked with the date left empty persists endDate '' instead of no end date",
    async () => {
      // observed: endDate === ""
      const app = await renderApp({ route: "/income", today: TODAY });
      await d.fillIncomeToSchedule(app, { frequency: "Monthly", start: "2026-02-10" });
      await d.check(app, /Set End Date/);
      const doc = await d.finishIncome(app);
      expect(doc.frequency).toBe("monthly"); // precondition
      expect(doc.endDate ?? undefined).toBeUndefined();
    }
  );

  it.each([
    ["negative", "-50"],
    ["zero", "0"],
    ["empty", ""],
  ])("a %s amount blocks Continue on step 2", async (_n, value) => {
    const app = await renderApp({ route: "/income", today: TODAY });
    await d.openIncomeForm(app);
    await app.user.click(screen.getByRole("heading", { name: "Salary" }));
    await d.next(app);
    await d.fill(app, /^Source Name/, "Pay");
    await d.fill(app, /^Amount/, value);
    expect(d.nextButton()).toBeDisabled();
    expect(screen.getByText("Income Details")).toBeInTheDocument(); // still on step 2
  });

  it("a whitespace-only name blocks Continue", async () => {
    const app = await renderApp({ route: "/income", today: TODAY });
    await d.openIncomeForm(app);
    await d.next(app);
    await d.fill(app, /^Source Name/, "   ");
    await d.fill(app, /^Amount/, "100");
    expect(d.nextButton()).toBeDisabled();
  });

  it("a huge amount (9,999,999,999.99) is stored exactly and shown on the detail card", async () => {
    const { doc } = await run({ name: "Whale", amount: "9999999999.99", frequency: "One-time" });
    expect(doc.amount).toBe(9999999999.99);
    // the manager selects the new source, so its detail card is already showing
    expect(screen.getAllByText("$9,999,999,999.99").length).toBeGreaterThan(0);
  });

  it("decimal amounts keep their cents", async () => {
    const { doc } = await run({ amount: "0.07", frequency: "One-time" });
    expect(doc.amount).toBe(0.07);
  });

  knownDefect(
    "UI-RULE-15",
    "an end date before the start date is accepted and the rule silently generates nothing",
    async () => {
      // observed: doc saved with startDate 2026-03-01, endDate 2026-02-01; zero projections
      const app = await renderApp({ route: "/income", today: TODAY });
      await d.fillIncomeToSchedule(app, {
        frequency: "Monthly",
        start: "2026-03-01",
        end: "2026-02-01",
        weekend: "none",
      });
      expect((screen.getByLabelText(/^End Date/) as HTMLInputElement).value).toBe("02/01/2026"); // precondition
      if (!d.nextButton().hasAttribute("disabled")) {
        await app.user.click(d.nextButton());
        await app.user.click(await screen.findByRole("button", { name: "Create Income Source" }));
        await app.settle();
      }
      expect(d.incomeDocs(app)).toHaveLength(0);
    }
  );

  it.todo("DECISION: sub-cent amounts (19.999) - round to cents on save or reject");
});

// ---------------------------------------------------------------------------
describe("income wizard: default start date in a UTC+ zone", () => {
  knownDefect(
    "UI-RULE-16",
    "Start Date defaults to yesterday between 00:00 and 08:00 local in Asia/Manila (toISOString default)",
    async () => {
      // 2026-01-15 00:30 Manila = 2026-01-14 16:30Z -> default startDate "2026-01-14"
      const app = await renderApp({
        route: "/income",
        today: "2026-01-15T00:30",
        timeZone: "Asia/Manila",
      });
      expect(new Date().getDate()).toBe(15); // precondition: local date really is the 15th
      await d.fillIncomeToSchedule(app, { frequency: "Monthly" });
      expect((screen.getByLabelText(/^Start Date/) as HTMLInputElement).value).toBe("01/15/2026");
    }
  );

  it("mid-day in Asia/Manila the default Start Date is today", async () => {
    const app = await renderApp({ route: "/income", today: "2026-01-15", timeZone: "Asia/Manila" });
    await d.fillIncomeToSchedule(app, { frequency: "Monthly" });
    await waitFor(() =>
      expect((screen.getByLabelText(/^Start Date/) as HTMLInputElement).value).toBe("01/15/2026")
    );
  });
});

// ---------------------------------------------------------------------------
describe("income wizard: dates rendered on the Review step and detail card in a UTC- zone", () => {
  knownDefect(
    "UI-RULE-17",
    "the Review step shows the Start Date one day early in America/New_York (new Date('YYYY-MM-DD') is UTC)",
    async () => {
      // Start Date field 02/10/2026 -> observed Review "2/9/2026"
      const app = await renderApp({ route: "/income", today: TODAY, timeZone: "America/New_York" });
      await d.fillIncomeToSchedule(app, { frequency: "Monthly", start: "2026-02-10" });
      await d.next(app);
      await screen.findByText("Review & Confirm");
      const startCell = screen.getByText("Start Date").nextElementSibling!;
      expect(startCell.textContent).toBe("2/10/2026");
    }
  );

  knownDefect(
    "UI-RULE-18",
    "an income detail card shows the Start Date one day early in America/New_York",
    async () => {
      await renderApp({
        route: "/income",
        today: TODAY,
        timeZone: "America/New_York",
        seed: { incomeSources: [makeIncomeSource({ id: "i", name: "Payroll", startDate: "2026-02-10" })] },
      }).then(async (app) => {
        await app.user.click(screen.getAllByText("Payroll")[0]);
        const startCell = (await screen.findByText("Start Date")).nextElementSibling!;
        expect(startCell.textContent).toBe("2/10/2026");
      });
    }
  );
});
