import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => import("../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../helpers/firebaseConfigMock"));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { IncomeFrequency, ScheduleConfig, UserProfile } from "@/lib/types";
import { formatDate, parseDate } from "@/lib/utils/dateUtils";
import { useViewDateRange } from "@/contexts/FinancialContext/hooks/useViewDateRange";
import { calculateOccurrences } from "@/lib/logic/projectionEngine/occurrenceCalculator";
import { generateOccurrenceId } from "@/lib/logic/projectionEngine/occurrenceIdGenerator";
import { generateProjections } from "@/lib/logic/projectionEngine/projectionGenerator";
import { calculateForecast } from "@/lib/logic/forecasting/forecastCalculator";
import { getBillCoverageReport } from "@/lib/logic/balanceCalculator/billCoverage";
import { getRunway } from "@/lib/logic/balanceCalculator/runway";
import { mergeTransactionsWithProjections } from "@/contexts/FinancialContext/utils/projectionMerger";
import { createUserProfile, updateUserBalance } from "@/lib/firebase/firestore/users";
import * as store from "../helpers/firestoreEmulator";
import {
  makeExpenseRule,
  makeIncomeSource,
  makeProjectedTransaction,
  makeUserProfile,
} from "../helpers/builders";
import { d, ymd, ymdAll } from "../helpers/dates";
import { freezeAt, freezeToday } from "../helpers/time";

/**
 * THEME: the engine mixes three date conventions, and a POSITIVE UTC offset is
 * where they diverge.
 *
 *   (a) `dateUtils.parseDate` / `formatDate` — dayjs, LOCAL midnight. Correct.
 *   (b) `new Date("YYYY-MM-DD")` — UTC midnight, i.e. 08:00 LOCAL in Manila.
 *       So a bound parsed this way sits 8 hours AFTER local midnight of the
 *       same calendar day.
 *   (c) `toISOString().split("T")[0]` — the UTC calendar day. At UTC+8, local
 *       wall-clock is AHEAD of UTC, so any local time BEFORE 08:00 (including
 *       local midnight, which is what `new Date(y, m, d)` produces) serializes
 *       to the PREVIOUS calendar day. Local times from 08:00 onwards, including
 *       the whole evening, serialize to the correct day.
 *
 * This file is run only by `vitest.config.tz.ts` (TZ=Asia/Manila, UTC+8, no
 * DST). It is excluded from the default UTC config, so run it with:
 *   npx vitest run --config vitest.config.tz.ts
 */

// ============================================================================
// LOCAL HELPERS
// ============================================================================

/**
 * `calculateOccurrences` takes a bare OccurrenceParams struct that no shared
 * builder produces, so this wrapper keeps each case to its meaningful inputs
 * and returns local "YYYY-MM-DD" strings (via the raw-Date helpers, never the
 * engine's own dayjs formatter).
 */
const occurrences = (
  params: {
    frequency: IncomeFrequency;
    startDate: string;
    endDate?: string;
    scheduleConfig?: ScheduleConfig;
    weekendAdjustment?: "before" | "after" | "none";
  },
  viewStart: string,
  viewEnd: string
): string[] =>
  ymdAll(
    calculateOccurrences(
      {
        frequency: params.frequency,
        startDate: params.startDate,
        endDate: params.endDate,
        scheduleConfig: params.scheduleConfig ?? {},
        weekendAdjustment: params.weekendAdjustment ?? "none",
      },
      d(viewStart),
      d(viewEnd)
    )
  );

/** Occurrence id for a local-midnight date, with the shared 2026-01-01 anchor. */
const idFor = (
  frequency: IncomeFrequency,
  dateYmd: string,
  startDate = "2026-01-01",
  scheduleConfig: ScheduleConfig = {}
): string => generateOccurrenceId("src", frequency, d(dateYmd), startDate, scheduleConfig);

/**
 * Renders the REAL `useViewDateRange` hook and returns the default window its
 * `useState` initializer produced (useViewDateRange.ts:14-23). The defect lives
 * in that initializer, so a single static render observes it — no state updates
 * and no DOM are needed, hence `renderToStaticMarkup` rather than a testing
 * library. The probe element is built with `React.createElement` because this
 * file is `.ts` and cannot hold JSX.
 *
 * On a render failure this returns a sentinel rather than throwing, so the
 * `it.fails` cases below can only ever fail through a real assertion diff. The
 * "renders the real client hook" test guards the probe itself.
 */
const readDefaultViewWindow = (): { start: string; end: string } => {
  let captured: { start: string; end: string } | undefined;
  const Probe = () => {
    captured = useViewDateRange().viewDateRange;
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  return captured ?? { start: "<hook did not render>", end: "<hook did not render>" };
};

/** Scheduled dates of a merge/projection result, in returned order. */
const scheduledDates = (rows: { scheduledDate: string }[]): string[] =>
  rows.map((row) => row.scheduledDate);

// ============================================================================
// 0. HARNESS
// ============================================================================

describe("timezone harness", () => {
  it("runs at UTC+8 so positive-offset date bugs are observable", () => {
    // -480 minutes == UTC+8. If this fails, vitest.config.tz.ts is not being
    // applied and every other assertion in this file is meaningless.
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(-480);
  });

  it("has the same offset in July, confirming Asia/Manila has no DST", () => {
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(-480);
  });
});

// ============================================================================
// 1. BASELINE: the three conventions
// ============================================================================

describe("parseDate / formatDate", () => {
  describe("convention (a): dayjs local midnight", () => {
    it("parses a YYYY-MM-DD string to LOCAL midnight on that calendar day", () => {
      const parsed = parseDate("2026-03-15");

      expect(parsed.getFullYear()).toBe(2026);
      expect(parsed.getMonth()).toBe(2); // March
      expect(parsed.getDate()).toBe(15);
      expect(parsed.getHours()).toBe(0);
      expect(parsed.getMinutes()).toBe(0);
    });

    it("produces the identical instant as the raw-Date test helper", () => {
      expect(parseDate("2026-03-15").getTime()).toBe(d("2026-03-15").getTime());
    });

    it("round-trips a YYYY-MM-DD string through parseDate and formatDate", () => {
      expect(formatDate(parseDate("2026-03-15"))).toBe("2026-03-15");
      expect(formatDate(parseDate("2026-01-01"))).toBe("2026-01-01");
      expect(formatDate(parseDate("2026-12-31"))).toBe("2026-12-31");
    });

    it("formats a local-midnight Date as its own local calendar day", () => {
      // The dangerous instant: 2026-03-15T00:00+08:00 is 2026-03-14T16:00Z.
      expect(formatDate(new Date(2026, 2, 15))).toBe("2026-03-15");
    });

    it("formats a local-evening Date as its own local calendar day", () => {
      expect(formatDate(new Date(2026, 2, 15, 23, 59))).toBe("2026-03-15");
    });
  });

  describe("convention (b): new Date(string) is UTC midnight = 08:00 local", () => {
    it("keeps the calendar day but lands at 08:00 local", () => {
      const utcParsed = new Date("2026-03-15");

      expect(utcParsed.getDate()).toBe(15);
      expect(utcParsed.getHours()).toBe(8);
    });

    it("sits 8 hours after the local-midnight parse of the same string", () => {
      const eightHours = 8 * 60 * 60 * 1000;

      expect(new Date("2026-03-15").getTime() - parseDate("2026-03-15").getTime()).toBe(eightHours);
    });

    it("compares as LATER than local midnight of the same day", () => {
      // This single inequality is the root cause of the window-bound defects
      // in projectionMerger.ts:31 and useComputedFinancials.ts:21.
      expect(new Date("2026-03-15") > d("2026-03-15")).toBe(true);
    });
  });

  describe("convention (c): toISOString() is the UTC calendar day", () => {
    it("shifts a local-midnight Date back to the previous calendar day", () => {
      expect(new Date(2026, 2, 15).toISOString().split("T")[0]).toBe("2026-03-14");
    });

    it("shifts any local time before 08:00 back to the previous calendar day", () => {
      expect(new Date(2026, 2, 15, 7, 59).toISOString().split("T")[0]).toBe("2026-03-14");
    });

    it("keeps the correct calendar day from 08:00 local onwards", () => {
      expect(new Date(2026, 2, 15, 8, 0).toISOString().split("T")[0]).toBe("2026-03-15");
      expect(new Date(2026, 2, 15, 20, 0).toISOString().split("T")[0]).toBe("2026-03-15");
      expect(new Date(2026, 2, 15, 23, 59).toISOString().split("T")[0]).toBe("2026-03-15");
    });

    it("disagrees with formatDate for the same local-midnight instant", () => {
      const localMidnight = new Date(2026, 2, 15);

      expect(formatDate(localMidnight)).toBe("2026-03-15");
      expect(localMidnight.toISOString().split("T")[0]).toBe("2026-03-14");
    });
  });
});

// ============================================================================
// 2. projectionMerger — view-window bounds
// ============================================================================

describe("mergeTransactionsWithProjections", () => {
  /** Monthly rule that fires on the 1st, anchored well before any window. */
  const firstOfMonthRule = makeExpenseRule({
    id: "rent",
    frequency: "monthly",
    startDate: "2026-01-01",
    amount: 1_200,
  });

  const merge = (start: string, end: string, rules = [firstOfMonthRule]) =>
    mergeTransactionsWithProjections([], [], rules, { start, end }, "user-1");

  describe("window boundaries", () => {
    it("includes an occurrence landing exactly on the last day of the window", () => {
      // `new Date("2026-05-01")` is 08:00 local on 2026-05-01, so the
      // local-midnight occurrence for that day still compares as <= the bound.
      const merged = merge("2026-03-01", "2026-05-01");

      expect(scheduledDates(merged)).toContain("2026-05-01");
    });

    it("excludes an occurrence falling the day after the window end", () => {
      const secondOfMonthRule = makeExpenseRule({
        id: "rent",
        frequency: "monthly",
        startDate: "2026-01-02",
      });
      const merged = merge("2026-03-01", "2026-05-01", [secondOfMonthRule]);

      // 2026-05-02 is outside the window and must not appear.
      expect(scheduledDates(merged)).toEqual(["2026-03-02", "2026-04-02"]);
    });

    it("returns every in-window occurrence when the bounds are LOCAL midnight", () => {
      // Control: the same rule and the same calendar window, but handed to
      // generateProjections with locally-parsed bounds. Proves the engine is
      // correct and the defect below lives purely in the merger's bound parse.
      const projections = generateProjections(
        [],
        [firstOfMonthRule],
        d("2026-03-01"),
        d("2026-05-01")
      );

      expect(scheduledDates(projections)).toEqual(["2026-03-01", "2026-04-01", "2026-05-01"]);
    });

    it("still merges an interior occurrence, so the window is not broken wholesale", () => {
      const merged = merge("2026-03-01", "2026-05-01");

      expect(scheduledDates(merged)).toContain("2026-04-01");
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT — app/contexts/FinancialContext/utils/projectionMerger.ts:31
     * The window bounds are parsed with `new Date(viewDateRange.start)`, which
     * is UTC midnight = 08:00 LOCAL at UTC+8, while occurrences are generated
     * at LOCAL midnight (occurrenceCalculator.ts:138). An occurrence landing on
     * the window's FIRST day is therefore 8 hours EARLIER than the lower bound
     * and is silently dropped by the `date >= viewStartDate` guard
     * (occurrenceCalculator.ts:141).
     * CORRECT: the occurrence on the first day of the window is included, so
     * the merge returns 2026-03-01, 2026-04-01 and 2026-05-01.
     */
    it.fails("KNOWN DEFECT: includes an occurrence landing on the first day of the window", () => {
      const merged = merge("2026-03-01", "2026-05-01");

      expect(scheduledDates(merged)).toEqual(["2026-03-01", "2026-04-01", "2026-05-01"]);
    });

    /**
     * DEFECT — app/contexts/FinancialContext/utils/projectionMerger.ts:31
     * Same root cause, isolated: the first day of the window is missing
     * entirely rather than merely mis-ordered.
     * CORRECT: "2026-03-01" appears in the merged output.
     */
    it.fails("KNOWN DEFECT: does not drop the first day of the window", () => {
      const merged = merge("2026-03-01", "2026-05-01");

      expect(scheduledDates(merged)).toContain("2026-03-01");
    });

    /**
     * DEFECT — app/contexts/FinancialContext/utils/projectionMerger.ts:31
     * A one-time rule dated exactly on the window start disappears completely,
     * which is the user-visible shape of the bug: a bill on the 1st of the
     * viewed month is invisible.
     * CORRECT: the one-time occurrence on the window start is returned.
     */
    it.fails("KNOWN DEFECT: keeps a one-time rule dated exactly on the window start", () => {
      const oneTime = makeExpenseRule({
        id: "insurance",
        frequency: "one-time",
        startDate: "2026-03-01",
      });
      const merged = merge("2026-03-01", "2026-03-31", [oneTime]);

      expect(scheduledDates(merged)).toEqual(["2026-03-01"]);
    });
  });
});

// ============================================================================
// 3. useViewDateRange — default window serialization
// ============================================================================

describe("useViewDateRange default window", () => {
  it("renders the real client hook and yields a YYYY-MM-DD window", () => {
    // Guard on the probe itself. The hook is a client module, but "use client"
    // is inert under Vitest/node so it imports fine; if that ever stops being
    // true, or the initializer stops returning strings, this goes red instead
    // of the it.fails cases below quietly "passing" on a crash.
    freezeAt("2026-03-15", 5);

    const window = readDefaultViewWindow();

    expect(window.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(window.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("produces a start string strictly before the end string", () => {
    freezeAt("2026-03-15", 5);

    const window = readDefaultViewWindow();

    // Ordering survives the offset because both bounds shift by the same day.
    expect(window.start < window.end).toBe(true);
  });

  describe("known defects", () => {
    /**
     * DEFECT — app/contexts/FinancialContext/hooks/useViewDateRange.ts:15-22
     * The `useState` initializer builds `startDate` with
     * `new Date(y, m - 2, 1)` — LOCAL midnight — and then serializes it with
     * `toISOString().split("T")[0]`, which reports the UTC calendar day. At
     * UTC+8 local midnight is 16:00 of the PREVIOUS day in UTC, so the window
     * start is stamped one day EARLY (here 2025-12-31).
     * CORRECT: "2026-01-01" — the 1st of the month two months back, in LOCAL
     * calendar terms.
     */
    it.fails("KNOWN DEFECT: stamps the window start as the intended local calendar day", () => {
      // 05:00 local on 2026-03-15 is 21:00 UTC on 2026-03-14, so the frozen
      // "today" itself already straddles the UTC/local day boundary.
      freezeAt("2026-03-15", 5);

      expect(readDefaultViewWindow().start).toBe("2026-01-01");
    });

    /**
     * DEFECT — app/contexts/FinancialContext/hooks/useViewDateRange.ts:15-22
     * Same root cause on the upper bound: `new Date(y, m + 4, 0)` is local
     * midnight of the last day of the +3 month, serialized as the previous UTC
     * day, so the window ends a day SHORT and the final day's projections fall
     * outside the requested range (here 2026-06-29).
     * CORRECT: "2026-06-30" — the last day of the month before the month four
     * months forward, in LOCAL calendar terms.
     */
    it.fails("KNOWN DEFECT: stamps the window end as the intended local calendar day", () => {
      freezeAt("2026-03-15", 5);

      expect(readDefaultViewWindow().end).toBe("2026-06-30");
    });

    /**
     * DEFECT — app/contexts/FinancialContext/hooks/useViewDateRange.ts:15-22
     * The month-boundary case makes the off-by-one unmistakable: with "today"
     * in January the start should be the 1st of November, not 31 October — the
     * whole window slides into the wrong month.
     * CORRECT: start "2025-11-01", end "2026-04-30".
     */
    it.fails("KNOWN DEFECT: does not roll the default window back into the previous month", () => {
      freezeAt("2026-01-20", 5);

      const window = readDefaultViewWindow();
      expect(window.start).toBe("2025-11-01");
      expect(window.end).toBe("2026-04-30");
    });
  });

  /**
   * These two document the `toISOString` shift in the abstract so the diffs in
   * the "known defects" block above are easy to read. They are NOT guards on
   * the app: the real-hook guard is the it.fails block above, which renders
   * `useViewDateRange` itself. If these two ever disagree with it, the date
   * arithmetic is what moved, not the hook.
   */
  describe("the toISOString shift, in the abstract", () => {
    it("documents that the month arithmetic lands on the intended local days", () => {
      freezeAt("2026-03-15", 5);

      const today = new Date();
      const startDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      const endDate = new Date(today.getFullYear(), today.getMonth() + 4, 0);

      // 2 months back from March is 1 January; month +4 with day 0 is the last
      // day of June. Read with LOCAL calendar fields both instants are right.
      expect(ymd(startDate)).toBe("2026-01-01");
      expect(ymd(endDate)).toBe("2026-06-30");

      // Serializing those SAME instants through toISOString loses a day.
      expect(startDate.toISOString().split("T")[0]).toBe("2025-12-31");
      expect(endDate.toISOString().split("T")[0]).toBe("2026-06-29");
    });

    it("documents that formatDate would serialize the same instants correctly", () => {
      freezeAt("2026-03-15", 5);

      const today = new Date();

      expect(formatDate(new Date(today.getFullYear(), today.getMonth() - 2, 1))).toBe("2026-01-01");
      expect(formatDate(new Date(today.getFullYear(), today.getMonth() + 4, 0))).toBe("2026-06-30");
    });
  });
});

// ============================================================================
// 4. forecastCalculator — day bucket keys
// ============================================================================

describe("calculateForecast", () => {
  const startDate = () => d("2026-03-15");
  const sameDayExpense = () =>
    makeProjectedTransaction({
      id: "txn-same-day",
      scheduledDate: "2026-03-15",
      type: "expense",
      projectedAmount: 500,
    });

  it("returns exactly daysToForecast points", () => {
    const forecast = calculateForecast(10_000, [sameDayExpense()], startDate(), 3);

    expect(forecast).toHaveLength(3);
  });

  it("returns strictly increasing, contiguous date strings", () => {
    const forecast = calculateForecast(10_000, [], startDate(), 4);
    const days = forecast.map((point) => point.date);

    expect(days[1] > days[0]).toBe(true);
    expect(new Set(days).size).toBe(4);
  });

  it("has applied a start-day transaction by the end of the forecast window", () => {
    const forecast = calculateForecast(10_000, [sameDayExpense()], startDate(), 3);

    // 10,000 - 500. True regardless of which bucket the expense lands in, so
    // this pins that the transaction is not lost outright.
    expect(forecast[forecast.length - 1].balance).toBe(9_500);
  });

  it("ignores non-projected transactions", () => {
    const completed = makeProjectedTransaction({
      id: "txn-done",
      scheduledDate: "2026-03-16",
      type: "expense",
      projectedAmount: 700,
      status: "completed",
    });
    const forecast = calculateForecast(10_000, [completed], startDate(), 5);

    expect(forecast.every((point) => point.balance === 10_000)).toBe(true);
  });

  describe("known defects", () => {
    /**
     * DEFECT — app/lib/logic/forecasting/forecastCalculator.ts:43
     * Day buckets are keyed with `currentDate.toISOString().split("T")[0]` while
     * transactions carry LOCAL "YYYY-MM-DD" scheduledDates. At UTC+8 the local
     * -midnight cursor serializes to the PREVIOUS calendar day, so every
     * returned `date` label is one day early: the first point of a forecast
     * started on 2026-03-15 is labelled "2026-03-14".
     * CORRECT: the labels are the local calendar days 2026-03-15..17.
     */
    it.fails("KNOWN DEFECT: labels forecast points with the local calendar days", () => {
      const forecast = calculateForecast(10_000, [sameDayExpense()], startDate(), 3);

      expect(forecast.map((point) => point.date)).toEqual([
        "2026-03-15",
        "2026-03-16",
        "2026-03-17",
      ]);
    });

    /**
     * DEFECT — app/lib/logic/forecasting/forecastCalculator.ts:26,43
     * Because the bucket key is the UTC day but `scheduledDate` is the local
     * day, a transaction scheduled on the forecast's start day only matches the
     * SECOND iteration. The first forecast point therefore still shows the
     * opening balance, understating the day's outflow by a full day.
     * CORRECT: 10,000 - 500 = 9,500 on the first point.
     */
    it.fails("KNOWN DEFECT: applies a start-day transaction to the first forecast point", () => {
      const forecast = calculateForecast(10_000, [sameDayExpense()], startDate(), 3);

      expect(forecast[0].balance).toBe(9_500);
    });

    /**
     * DEFECT — app/lib/logic/forecasting/forecastCalculator.ts:26
     * `todayStr` is also the shifted UTC day, so the "today onwards" filter
     * admits a transaction scheduled YESTERDAY in local terms — a stale expense
     * is charged against a balance that already reflects it.
     * CORRECT: a transaction dated the day before the forecast start is excluded,
     * leaving the balance flat.
     */
    it.fails("KNOWN DEFECT: excludes a transaction dated before the forecast start day", () => {
      const yesterday = makeProjectedTransaction({
        id: "txn-yesterday",
        scheduledDate: "2026-03-14",
        type: "expense",
        projectedAmount: 500,
      });
      const forecast = calculateForecast(10_000, [yesterday], startDate(), 3);

      expect(forecast.map((point) => point.balance)).toEqual([10_000, 10_000, 10_000]);
    });
  });
});

// ============================================================================
// 5. users.ts — balanceLastUpdatedAt stamping
// ============================================================================

describe("updateUserBalance", () => {
  beforeEach(() => store.__reset());

  const seedUser = () => store.__seed("users", "user-1", makeUserProfile({ uid: "user-1" }));

  const stampedDay = (): string | undefined =>
    store.__get<UserProfile>("users", "user-1")?.balanceLastUpdatedAt;

  it("stamps the local calendar day for a local-evening update", () => {
    // 20:00 local == 12:00 UTC the SAME day, so the UTC day happens to agree.
    freezeAt("2026-03-15", 20);
    seedUser();

    return updateUserBalance("user-1", 4_242).then(() => {
      expect(stampedDay()).toBe("2026-03-15");
    });
  });

  it("writes the new balance alongside the stamp", async () => {
    freezeAt("2026-03-15", 20);
    seedUser();

    await updateUserBalance("user-1", 4_242);

    expect(store.__get<UserProfile>("users", "user-1")?.currentBalance).toBe(4_242);
  });

  it("stamps the local calendar day at exactly 08:00 local, the UTC-day boundary", () => {
    freezeAt("2026-03-15", 8);
    seedUser();

    return updateUserBalance("user-1", 1).then(() => {
      expect(stampedDay()).toBe("2026-03-15");
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT — app/lib/firebase/firestore/users.ts:93
     * `balanceLastUpdatedAt` is stamped with
     * `new Date().toISOString().split("T")[0]`. At UTC+8 any local time before
     * 08:00 is still the PREVIOUS day in UTC, so an early-morning balance
     * update is recorded against yesterday. Every reader compares this string
     * to local "YYYY-MM-DD" dates, so the balance looks a day stale immediately
     * after being set.
     * CORRECT: the LOCAL calendar day, "2026-03-15".
     */
    it.fails(
      "KNOWN DEFECT: stamps the local calendar day for an early-morning update",
      async () => {
        // 05:00 local == 21:00 UTC on 2026-03-14.
        freezeAt("2026-03-15", 5);
        seedUser();

        await updateUserBalance("user-1", 4_242);

        expect(stampedDay()).toBe("2026-03-15");
      }
    );

    /**
     * DEFECT — app/lib/firebase/firestore/users.ts:93
     * The worst instant is local midnight, where the stamp is a full day behind
     * for the entire first 8 hours of the local day.
     * CORRECT: "2026-03-15".
     */
    it.fails("KNOWN DEFECT: stamps the local calendar day for a midnight update", async () => {
      freezeToday("2026-03-15");
      seedUser();

      await updateUserBalance("user-1", 4_242);

      expect(stampedDay()).toBe("2026-03-15");
    });

    /**
     * ADDITIONAL DEFECT — app/lib/firebase/firestore/users.ts:34
     * `createUserProfile` seeds `balanceLastUpdatedAt` with the same
     * `new Date().toISOString().split("T")[0]` expression, so a brand-new
     * account created before 08:00 local starts life with a yesterday stamp.
     * (The same expression also appears at migrations.ts:96 and :205.)
     * CORRECT: "2026-03-15".
     */
    it.fails("KNOWN DEFECT: createUserProfile seeds the local calendar day", async () => {
      freezeAt("2026-03-15", 5);

      const profile = await createUserProfile("user-new", "new@example.com", "New User");

      expect(profile.balanceLastUpdatedAt).toBe("2026-03-15");
    });
  });
});

// ============================================================================
// 6. projectionGenerator — sort key
// ============================================================================

describe("generateProjections sort order", () => {
  it("sorts interleaved income and expense occurrences by ascending date", () => {
    const income = makeIncomeSource({
      id: "salary",
      frequency: "monthly",
      startDate: "2026-01-20",
    });
    const expense = makeExpenseRule({ id: "rent", frequency: "monthly", startDate: "2026-01-05" });

    const projections = generateProjections([income], [expense], d("2026-03-01"), d("2026-05-31"));

    // Income is generated first, expenses second, so only the sort can produce
    // this interleaving.
    expect(scheduledDates(projections)).toEqual([
      "2026-03-05",
      "2026-03-20",
      "2026-04-05",
      "2026-04-20",
      "2026-05-05",
      "2026-05-20",
    ]);
  });

  it("orders correctly across a month boundary", () => {
    const income = makeIncomeSource({
      id: "salary",
      frequency: "monthly",
      startDate: "2026-01-01",
      scheduleConfig: { dayOfMonth: 1 },
    });
    const expense = makeExpenseRule({
      id: "rent",
      frequency: "monthly",
      startDate: "2026-01-31",
      scheduleConfig: { dayOfMonth: 31 },
    });

    const projections = generateProjections([income], [expense], d("2026-03-01"), d("2026-04-30"));

    expect(scheduledDates(projections)).toEqual([
      "2026-03-01",
      "2026-03-31",
      "2026-04-01",
      "2026-04-30",
    ]);
  });

  it("keeps the sort key monotonic because every value shifts by the same offset", () => {
    // Pins the property that makes projectionGenerator.ts:38-40 safe: the
    // `new Date(scheduledDate)` sort key is UTC midnight for EVERY row, so the
    // uniform +8h shift cancels out. A future mixed-format key would break this.
    expect(new Date("2026-03-31").getTime()).toBeLessThan(new Date("2026-04-01").getTime());
    expect(new Date("2026-12-31").getTime()).toBeLessThan(new Date("2027-01-01").getTime());
    expect(new Date("2026-03-15").getTime() - d("2026-03-15").getTime()).toBe(
      new Date("2026-09-15").getTime() - d("2026-09-15").getTime()
    );
  });

  it("returns a non-decreasing sequence over a long window", () => {
    const income = makeIncomeSource({ id: "salary", frequency: "weekly", startDate: "2026-01-01" });
    const expense = makeExpenseRule({ id: "rent", frequency: "monthly", startDate: "2026-01-10" });

    const dates = scheduledDates(
      generateProjections([income], [expense], d("2026-01-01"), d("2026-06-30"))
    );

    expect(dates.every((day, i) => i === 0 || dates[i - 1] <= day)).toBe(true);
  });
});

// ============================================================================
// 7. Occurrence engine — offset independence
// ============================================================================

describe("calculateOccurrences at UTC+8", () => {
  /**
   * Every expected array below is copied verbatim from the UTC suites in
   * tests/unit/projectionEngine/. Any divergence here would mean the pure
   * occurrence engine is offset-dependent, which would be a serious defect —
   * it is the source of truth for every scheduledDate the app stores.
   */

  describe("monthly", () => {
    it("uses dayOfMonth from scheduleConfig, identically to UTC", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-01-01", scheduleConfig: { dayOfMonth: 15 } },
          "2026-01-01",
          "2026-04-30"
        )
      ).toEqual(["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]);
    });

    it("clamps day 31 to each month's last day, identically to UTC", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-01-31", scheduleConfig: { dayOfMonth: 31 } },
          "2026-01-01",
          "2026-06-30"
        )
      ).toEqual([
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
        "2026-05-31",
        "2026-06-30",
      ]);
    });

    it("clamps day 29 to February 28 in the non-leap year 2026", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-01-01", scheduleConfig: { dayOfMonth: 29 } },
          "2026-01-01",
          "2026-03-31"
        )
      ).toEqual(["2026-01-29", "2026-02-28", "2026-03-29"]);
    });

    it("keeps day 29 on February 29 in the leap year 2028", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2028-01-01", scheduleConfig: { dayOfMonth: 29 } },
          "2028-01-01",
          "2028-03-31"
        )
      ).toEqual(["2028-01-29", "2028-02-29", "2028-03-29"]);
    });

    it("excludes occurrences before a locally-parsed viewStartDate", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-01-01", scheduleConfig: { dayOfMonth: 15 } },
          "2026-03-01",
          "2026-05-31"
        )
      ).toEqual(["2026-03-15", "2026-04-15", "2026-05-15"]);
    });

    it("emits the occurrence landing exactly on the local window start", () => {
      // The counterpart of the projectionMerger defect: with LOCAL bounds the
      // first day of the window is correctly included.
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-01-01", scheduleConfig: { dayOfMonth: 1 } },
          "2026-03-01",
          "2026-05-01"
        )
      ).toEqual(["2026-03-01", "2026-04-01", "2026-05-01"]);
    });
  });

  describe("semi-monthly", () => {
    it("defaults to the 15th and the 30th, clamping February, identically to UTC", () => {
      expect(
        occurrences(
          { frequency: "semi-monthly", startDate: "2026-01-01" },
          "2026-01-01",
          "2026-03-31"
        )
      ).toEqual([
        "2026-01-15",
        "2026-01-30",
        "2026-02-15",
        // February has no 30th in 2026 (non-leap) so day 30 clamps to the 28th
        "2026-02-28",
        "2026-03-15",
        "2026-03-30",
      ]);
    });

    it("honours a custom [1, 16] pair, identically to UTC", () => {
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2026-01-01",
            scheduleConfig: { specificDays: [1, 16] },
          },
          "2026-01-01",
          "2026-02-28"
        )
      ).toEqual(["2026-01-01", "2026-01-16", "2026-02-01", "2026-02-16"]);
    });
  });

  describe("weekly", () => {
    it("steps 7 days from startDate, identically to UTC", () => {
      expect(
        occurrences(
          { frequency: "weekly", startDate: "2026-01-01", scheduleConfig: {} },
          "2026-01-01",
          "2026-02-15"
        )
      ).toEqual([
        "2026-01-01",
        "2026-01-08",
        "2026-01-15",
        "2026-01-22",
        "2026-01-29",
        "2026-02-05",
        "2026-02-12",
      ]);
    });

    it("aligns forward to scheduleConfig.dayOfWeek, identically to UTC", () => {
      // startDate is Thu 2026-01-01; the first Monday on/after it is 2026-01-05.
      expect(
        occurrences(
          { frequency: "weekly", startDate: "2026-01-01", scheduleConfig: { dayOfWeek: 1 } },
          "2026-01-01",
          "2026-02-01"
        )
      ).toEqual(["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"]);
    });

    it("keeps a 7-day gap between consecutive occurrences at UTC+8", () => {
      const days = occurrences(
        { frequency: "weekly", startDate: "2026-01-01" },
        "2026-01-01",
        "2026-03-31"
      );
      const gaps = days
        .slice(1)
        .map((day, i) => Math.round((d(day).getTime() - d(days[i]).getTime()) / 86_400_000));

      // No DST in Manila, but this would also catch a 23/25-hour arithmetic slip.
      expect(gaps).toEqual(new Array(days.length - 1).fill(7));
    });
  });
});

describe("generateOccurrenceId at UTC+8", () => {
  it("produces the same monthly period ids as the UTC suite", () => {
    expect(idFor("monthly", "2026-03-15")).toBe("src_2026-03");
    expect(idFor("monthly", "2026-01-01")).toBe("src_2026-01");
    expect(idFor("monthly", "2026-12-31")).toBe("src_2026-12");
  });

  it("produces the same daily ids as the UTC suite", () => {
    expect(idFor("daily", "2026-03-09")).toBe("src_2026-03-09");
    expect(idFor("daily", "2026-01-05")).toBe("src_2026-01-05");
  });

  it("produces the same ISO-week ids as the UTC suite", () => {
    expect(idFor("weekly", "2026-01-01")).toBe("src_2026-W01");
    expect(idFor("weekly", "2026-01-05")).toBe("src_2026-W02");
    expect(idFor("weekly", "2026-06-15")).toBe("src_2026-W25");
    // ISO year rollover: the last days of 2025 belong to 2026 week 1.
    expect(idFor("weekly", "2025-12-29")).toBe("src_2026-W01");
    expect(idFor("weekly", "2025-12-28")).toBe("src_2025-W52");
  });

  it("produces the same bi-weekly indices as the UTC suite", () => {
    expect(idFor("bi-weekly", "2026-01-01", "2026-01-01")).toBe("src_BW1");
    expect(idFor("bi-weekly", "2026-01-14", "2026-01-01")).toBe("src_BW1");
    expect(idFor("bi-weekly", "2026-01-15", "2026-01-01")).toBe("src_BW2");
  });

  it("produces the same semi-monthly slot ids as the UTC suite", () => {
    expect(idFor("semi-monthly", "2026-03-15")).toBe("src_2026-03-1");
    expect(idFor("semi-monthly", "2026-03-30")).toBe("src_2026-03-2");
  });

  it("produces the same one-time, quarterly and yearly ids as the UTC suite", () => {
    expect(idFor("one-time", "2026-01-01")).toBe("src_once");
    expect(idFor("quarterly", "2026-05-10")).toBe("src_2026-Q2");
    expect(idFor("yearly", "2026-07-04")).toBe("src_2026");
  });

  it("is stable when the same occurrence is asked for twice", () => {
    expect(idFor("monthly", "2026-03-15")).toBe(idFor("monthly", "2026-03-15"));
  });
});

// ============================================================================
// 8. Bill coverage / runway — "today" boundary
// ============================================================================

describe("getBillCoverageReport", () => {
  const bill = (scheduledDate: string, projectedAmount = 100, id = `bill-${scheduledDate}`) =>
    makeProjectedTransaction({ id, scheduledDate, type: "expense", projectedAmount });

  it("treats a bill scheduled today as due today at 22:00 local", () => {
    // The window is built from formatDate(new Date()) — local — so the late
    // local evening (14:00 UTC) must not roll "today" forward.
    freezeAt("2026-03-15", 22);

    const report = getBillCoverageReport(1_000, [bill("2026-03-15")]);

    expect(report.upcomingBills).toHaveLength(1);
    expect(report.upcomingBills[0].daysUntilDue).toBe(0);
  });

  it("treats a bill scheduled today as due today at 05:00 local", () => {
    // 05:00 local is 21:00 UTC the PREVIOUS day; formatDate is immune.
    freezeAt("2026-03-15", 5);

    const report = getBillCoverageReport(1_000, [bill("2026-03-15")]);

    expect(report.upcomingBills).toHaveLength(1);
    expect(report.upcomingBills[0].daysUntilDue).toBe(0);
  });

  it("includes a bill on the last day of the default 14-day window", () => {
    freezeAt("2026-03-15", 22);

    // today + 14 days == 2026-03-29.
    const report = getBillCoverageReport(1_000, [bill("2026-03-29")]);

    expect(report.upcomingBills).toHaveLength(1);
    expect(report.upcomingBills[0].daysUntilDue).toBe(14);
  });

  it("excludes a bill one day past the 14-day window", () => {
    freezeAt("2026-03-15", 22);

    const report = getBillCoverageReport(1_000, [bill("2026-03-30")]);

    expect(report.upcomingBills).toEqual([]);
  });

  it("excludes a bill dated yesterday even at 05:00 local", () => {
    freezeAt("2026-03-15", 5);

    const report = getBillCoverageReport(1_000, [bill("2026-03-14")]);

    expect(report.upcomingBills).toEqual([]);
  });

  it("spans the whole window inclusively at 22:00 local", () => {
    freezeAt("2026-03-15", 22);

    const report = getBillCoverageReport(1_000, [
      bill("2026-03-15", 100),
      bill("2026-03-22", 100),
      bill("2026-03-29", 100),
    ]);

    expect(report.upcomingBills.map((entry) => entry.transaction.scheduledDate)).toEqual([
      "2026-03-15",
      "2026-03-22",
      "2026-03-29",
    ]);
    expect(report.totalUpcoming).toBe(300);
  });

  it("flags a today-dated bill as uncoverable when the balance is short", () => {
    freezeAt("2026-03-15", 22);

    const report = getBillCoverageReport(50, [bill("2026-03-15", 100)]);

    expect(report.canCoverAll).toBe(false);
    expect(report.firstShortfall).toEqual({
      date: "2026-03-15",
      amount: 50,
      billName: "Transaction",
    });
  });
});

describe("getRunway", () => {
  it("runs out on the local calendar day of a today-dated expense at 22:00 local", () => {
    freezeAt("2026-03-15", 22);

    const expense = makeProjectedTransaction({
      id: "big",
      scheduledDate: "2026-03-15",
      type: "expense",
      projectedAmount: 1_500,
    });

    expect(getRunway(1_000, [expense])).toEqual({ days: 0, runOutDate: "2026-03-15" });
  });

  it("runs out on the local calendar day of a today-dated expense at 05:00 local", () => {
    freezeAt("2026-03-15", 5);

    const expense = makeProjectedTransaction({
      id: "big",
      scheduledDate: "2026-03-15",
      type: "expense",
      projectedAmount: 1_500,
    });

    expect(getRunway(1_000, [expense])).toEqual({ days: 0, runOutDate: "2026-03-15" });
  });

  it("counts whole local days to a future run-out date", () => {
    freezeAt("2026-03-15", 22);

    const expense = makeProjectedTransaction({
      id: "big",
      scheduledDate: "2026-03-20",
      type: "expense",
      projectedAmount: 1_500,
    });

    // 2026-03-20 is 5 days after 2026-03-15.
    expect(getRunway(1_000, [expense])).toEqual({ days: 5, runOutDate: "2026-03-20" });
  });

  it("ignores an expense dated before today", () => {
    freezeAt("2026-03-15", 5);

    const expense = makeProjectedTransaction({
      id: "stale",
      scheduledDate: "2026-03-14",
      type: "expense",
      projectedAmount: 1_500,
    });

    expect(getRunway(1_000, [expense], 30)).toEqual({ days: 30, runOutDate: null });
  });
});
