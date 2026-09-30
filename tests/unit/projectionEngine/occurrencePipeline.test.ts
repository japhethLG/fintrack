import { describe, expect, it } from "vitest";
import type { IncomeFrequency, ScheduleConfig } from "@/lib/types";
import { calculateOccurrencesDetailed } from "@/lib/logic/projectionEngine/occurrenceCalculator";
import { generateOccurrenceId } from "@/lib/logic/projectionEngine/occurrenceIdGenerator";
import { d, ymd } from "../../helpers/dates";

/**
 * Differential + invariant tests for the occurrence pipeline
 * (generate logical dates -> weekend-adjust -> dedupe -> filter the ADJUSTED date to the window).
 *
 * The REFERENCE MODEL below is a brute-force day scan written from the product rules, sharing no
 * code with the engine (which steps periods and jumps to the window). It decides, for EVERY
 * calendar day from the rule start, whether that day is a logical occurrence, then applies the
 * weekend rule and the window. Dates are plain UTC-based day numbers, so the model itself is
 * immune to time zones.
 *
 * DECISIONS the reference model encodes (docs/audit/fixes/engine-dates.md):
 *  - rule startDate/endDate bound the LOGICAL date;
 *  - the view window bounds the ADJUSTED date;
 *  - a daily rule ignores weekend adjustment (it has an occurrence every day).
 */

// ---------------------------------------------------------------------------
// Reference model
// ---------------------------------------------------------------------------

const MS = 86_400_000;
const num = (s: string): number => {
  const [y, m, day] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, day) / MS;
};
const str = (n: number): string => new Date(n * MS).toISOString().slice(0, 10);
const weekdayOf = (n: number): number => new Date(n * MS).getUTCDay();
const parts = (n: number) => {
  const dt = new Date(n * MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, day: dt.getUTCDate() }; // m is 1-based
};
const lastDayOf = (y: number, m1: number): number => new Date(Date.UTC(y, m1, 0)).getUTCDate();

interface Rule {
  frequency: IncomeFrequency;
  start: string;
  end?: string;
  cfg: ScheduleConfig;
  adj: "none" | "before" | "after";
}

const isLogical = (r: Rule, n: number): boolean => {
  const start = num(r.start);
  if (n < start) return false;
  if (r.end && n > num(r.end)) return false;
  const p = parts(n);
  const s = parts(start);
  const dom = r.cfg.dayOfMonth ?? s.day;
  switch (r.frequency) {
    case "one-time":
      return n === start;
    case "daily":
      return true;
    case "weekly":
    case "bi-weekly": {
      const target = r.cfg.dayOfWeek ?? weekdayOf(start);
      if (weekdayOf(n) !== target) return false;
      if (r.frequency === "weekly") return true;
      const w =
        r.cfg.intervalWeeks !== undefined && r.cfg.intervalWeeks >= 1 ? r.cfg.intervalWeeks : 2;
      let first = start;
      while (weekdayOf(first) !== target) first++;
      return n >= first && (n - first) % (7 * w) === 0;
    }
    case "monthly":
      return p.day === Math.min(dom, lastDayOf(p.y, p.m));
    case "quarterly": {
      const monthsSince = p.y * 12 + p.m - (s.y * 12 + s.m);
      return (
        monthsSince >= 0 && monthsSince % 3 === 0 && p.day === Math.min(dom, lastDayOf(p.y, p.m))
      );
    }
    case "yearly": {
      const month1 = (r.cfg.monthOfYear ?? s.m - 1) + 1;
      return p.m === month1 && p.day === Math.min(dom, lastDayOf(p.y, p.m));
    }
    case "semi-monthly": {
      const days = Array.from(new Set(r.cfg.specificDays ?? [15, 30]));
      return days.some((x) => p.day === Math.min(x, lastDayOf(p.y, p.m)));
    }
    default:
      throw new Error("reference model: unknown frequency");
  }
};

const adjusted = (r: Rule, n: number): number => {
  if (r.frequency === "daily" || r.adj === "none") return n;
  const w = weekdayOf(n);
  if (w === 6) return r.adj === "before" ? n - 1 : n + 2;
  if (w === 0) return r.adj === "before" ? n - 2 : n + 1;
  return n;
};

/** Every (logical, adjusted) pair whose ADJUSTED date is inside [ws, we], ascending. */
const reference = (r: Rule, ws: string, we: string): { logical: string; date: string }[] => {
  const out: { logical: string; date: string }[] = [];
  for (let n = num(r.start); n <= num(we) + 3; n++) {
    if (!isLogical(r, n)) continue;
    const a = adjusted(r, n);
    if (a >= num(ws) && a <= num(we)) out.push({ logical: str(n), date: str(a) });
  }
  return out;
};

const engine = (r: Rule, ws: string, we: string): { logical: string; date: string }[] =>
  calculateOccurrencesDetailed(
    {
      frequency: r.frequency,
      startDate: r.start,
      endDate: r.end,
      scheduleConfig: r.cfg,
      weekendAdjustment: r.adj,
    },
    d(ws),
    d(we)
  ).map((o) => ({ logical: ymd(o.logicalDate), date: ymd(o.date) }));

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

const STARTS = [
  "2026-01-31", // Sat, month end
  "2026-02-01", // Sun, first of month
  "2026-03-15", // Sun
  "2026-01-03", // Sat
  "2028-02-29", // leap day (Tue)
  "2026-06-10", // Wed
];

const CONFIGS: Partial<Record<IncomeFrequency, ScheduleConfig[]>> = {
  "one-time": [{}],
  daily: [{}],
  weekly: [{}, { dayOfWeek: 0 }, { dayOfWeek: 3 }, { dayOfWeek: 6 }],
  "bi-weekly": [{}, { dayOfWeek: 5 }, { intervalWeeks: 3 }, { intervalWeeks: 1, dayOfWeek: 6 }],
  "semi-monthly": [
    {},
    { specificDays: [1, 15] },
    { specificDays: [31, 10, 10] },
    { specificDays: [30, 31] },
  ],
  monthly: [{}, { dayOfMonth: 1 }, { dayOfMonth: 15 }, { dayOfMonth: 31 }, { dayOfMonth: 29 }],
  quarterly: [{}, { dayOfMonth: 1 }, { dayOfMonth: 31 }],
  yearly: [
    {},
    { monthOfYear: 0 },
    { monthOfYear: 1, dayOfMonth: 29 },
    { monthOfYear: 11, dayOfMonth: 31 },
  ],
};

const WINDOWS: [string, string][] = [
  ["2026-01-01", "2026-03-31"],
  ["2026-02-28", "2026-09-05"],
  ["2025-12-01", "2026-01-15"],
  ["2026-05-30", "2026-06-01"],
  ["2026-03-01", "2026-03-01"],
  ["2028-01-01", "2028-12-31"], // under the 500-row cap even for a daily rule
];

const ENDS: (string | undefined)[] = [undefined, "2026-06-30"];
const ADJ = ["none", "before", "after"] as const;

function* sweep(): Generator<Rule> {
  for (const frequency of Object.keys(CONFIGS) as IncomeFrequency[]) {
    for (const start of STARTS) {
      for (const cfg of CONFIGS[frequency]!) {
        for (const end of ENDS) {
          for (const adj of ADJ) yield { frequency, start, end, cfg, adj };
        }
      }
    }
  }
}

const label = (r: Rule, w: [string, string]) =>
  `${r.frequency} start=${r.start} end=${r.end ?? "-"} cfg=${JSON.stringify(r.cfg)} adj=${r.adj} window=${w.join("..")}`;

describe("occurrence pipeline", () => {
  it("equals the brute-force reference model over the whole parameter sweep", () => {
    let checked = 0;
    const failures: string[] = [];
    for (const r of sweep()) {
      for (const w of WINDOWS) {
        const expected = reference(r, w[0], w[1]);
        const actual = engine(r, w[0], w[1]);
        checked++;
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          failures.push(
            `${label(r, w)}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`
          );
          if (failures.length >= 5) break;
        }
      }
      if (failures.length >= 5) break;
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(5_000); // the sweep really ran
  });

  it("is composable: a window equals the union of any partition of it", () => {
    const whole: [string, string] = ["2026-01-01", "2026-12-31"];
    const cuts = [
      "2026-01-02",
      "2026-02-01",
      "2026-03-01",
      "2026-06-06",
      "2026-06-07",
      "2026-12-31",
    ];
    const failures: string[] = [];
    for (const r of sweep()) {
      const all = engine(r, whole[0], whole[1]);
      for (const cut of cuts) {
        const left = engine(r, whole[0], str(num(cut) - 1));
        const right = engine(r, cut, whole[1]);
        if (JSON.stringify([...left, ...right]) !== JSON.stringify(all)) {
          failures.push(`${label(r, whole)} cut=${cut}`);
        }
      }
      if (failures.length >= 5) break;
    }
    expect(failures).toEqual([]);
  });

  it("returns dates that are strictly non-decreasing and always inside the window", () => {
    for (const r of sweep()) {
      for (const w of WINDOWS) {
        const dates = engine(r, w[0], w[1]).map((o) => o.date);
        expect([...dates].sort()).toEqual(dates);
        for (const day of dates) {
          expect(day >= w[0] && day <= w[1]).toBe(true);
        }
      }
    }
  });

  // Logical dates up to this cutoff all have their adjusted date inside WIDE (which runs to Jan 10
  // 2027), so the none/before/after variants can be compared one-to-one.
  const WIDE: [string, string] = ["2025-12-25", "2027-01-10"];
  const CUTOFF = "2026-12-31";
  const wideOccurrences = (r: Rule, adj: Rule["adj"]) =>
    calculateOccurrencesDetailed(
      {
        frequency: r.frequency,
        startDate: r.start,
        endDate: r.end,
        scheduleConfig: r.cfg,
        weekendAdjustment: adj,
      },
      d(WIDE[0]),
      d(WIDE[1])
    ).filter((o) => ymd(o.logicalDate) <= CUTOFF);

  it("gives every occurrence of a rule+window a unique id, and ids ignore weekendAdjustment", () => {
    const failures: string[] = [];
    let nonEmpty = 0;
    for (const r of sweep()) {
      if (r.adj !== "none") continue; // compare the three variants of each rule together
      const idsFor = (adj: Rule["adj"]) =>
        wideOccurrences(r, adj).map((o) =>
          generateOccurrenceId("src", r.frequency, o.logicalDate, r.start, r.cfg)
        );
      const none = idsFor("none");
      const before = idsFor("before");
      const after = idsFor("after");
      if (none.length > 0) nonEmpty++;
      if (new Set(none).size !== none.length) failures.push(`duplicate ids: ${label(r, WIDE)}`);
      if (
        JSON.stringify(none) !== JSON.stringify(before) ||
        JSON.stringify(none) !== JSON.stringify(after)
      ) {
        failures.push(`ids change with weekendAdjustment: ${label(r, WIDE)}`);
      }
      if (failures.length >= 5) break;
    }
    expect(failures).toEqual([]);
    expect(nonEmpty).toBeGreaterThan(100);
  });

  it("never loses a payment to weekend adjustment: the occurrence count is the same for none/before/after", () => {
    // D4 evidence. If the rule's own startDate/endDate were enforced on the ADJUSTED date, a first
    // payment moved before startDate ("before") or a last payment moved past endDate ("after")
    // would be dropped and these counts would differ.
    for (const r of sweep()) {
      if (r.adj !== "none") continue;
      const n = wideOccurrences(r, "none").length;
      expect(wideOccurrences(r, "before").length, label(r, WIDE)).toBe(n);
      expect(wideOccurrences(r, "after").length, label(r, WIDE)).toBe(n);
    }
  });
});

describe("occurrence pipeline: robustness", () => {
  const run = (cfg: ScheduleConfig, frequency: IncomeFrequency = "bi-weekly") =>
    engine({ frequency, start: "2026-01-01", cfg, adj: "none" }, "2026-01-01", "2026-03-01").map(
      (o) => o.date
    );

  it("terminates quickly and uses the default 2-week interval for a non-positive or non-numeric intervalWeeks", () => {
    // E2E-ROB-08: a negative interval used to spin for millions of iterations (frozen tab).
    // Thu Jan 1 + 14 days: Jan 1, Jan 15, Jan 29, Feb 12, Feb 26.
    const expected = ["2026-01-01", "2026-01-15", "2026-01-29", "2026-02-12", "2026-02-26"];
    const t0 = Date.now();
    for (const bad of [
      -2,
      -1,
      0,
      Number.NaN,
      null as unknown as number,
      "x" as unknown as number,
      Infinity,
    ]) {
      expect(run({ intervalWeeks: bad })).toEqual(expected);
    }
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("floors a fractional intervalWeeks and accepts a numeric string", () => {
    // 3.9 -> 3 weeks: Jan 1, Jan 22, Feb 12, Mar 5 is past the window.
    expect(run({ intervalWeeks: 3.9 })).toEqual(["2026-01-01", "2026-01-22", "2026-02-12"]);
    expect(run({ intervalWeeks: "3" as unknown as number })).toEqual([
      "2026-01-01",
      "2026-01-22",
      "2026-02-12",
    ]);
  });

  it("an ancient rule start does not slow a far-future window (the cursor jumps to the window)", () => {
    const t0 = Date.now();
    const out = engine(
      { frequency: "weekly", start: "1990-01-01", cfg: {}, adj: "none" },
      "2026-01-01",
      "2026-01-31"
    );
    // 1990-01-01 was a Monday; Mondays in Jan 2026: 5, 12, 19, 26.
    expect(out.map((o) => o.date)).toEqual([
      "2026-01-05",
      "2026-01-12",
      "2026-01-19",
      "2026-01-26",
    ]);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it("treats dayOfMonth 0 as a real (clamped) value, not as absent", () => {
    // `??` not `||`: 0 is present, so it is clamped up to day 1 rather than silently replaced by the
    // start day (the 10th).
    const out = engine(
      { frequency: "monthly", start: "2026-01-10", cfg: { dayOfMonth: 0 }, adj: "none" },
      "2026-01-01",
      "2026-04-30"
    ).map((o) => o.date);
    expect(out).toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]);
  });

  it("falls back to the start date's day of month for monthly, quarterly and yearly when absent or null", () => {
    const nulls = { dayOfMonth: null as unknown as number };
    for (const cfg of [{}, nulls]) {
      const monthly = engine(
        { frequency: "monthly", start: "2026-01-20", cfg, adj: "none" },
        "2026-01-01",
        "2026-03-31"
      );
      expect(monthly.map((o) => o.date)).toEqual(["2026-01-20", "2026-02-20", "2026-03-20"]);
      const quarterly = engine(
        { frequency: "quarterly", start: "2026-01-20", cfg, adj: "none" },
        "2026-01-01",
        "2026-12-31"
      );
      expect(quarterly.map((o) => o.date)).toEqual([
        "2026-01-20",
        "2026-04-20",
        "2026-07-20",
        "2026-10-20",
      ]);
      const yearly = engine(
        { frequency: "yearly", start: "2026-01-20", cfg, adj: "none" },
        "2026-01-01",
        "2028-12-31"
      );
      expect(yearly.map((o) => o.date)).toEqual(["2026-01-20", "2027-01-20", "2028-01-20"]);
    }
  });

  it("sorts and de-duplicates specificDays, and emits slots that clamp to one day once", () => {
    // [31, 10, 10] -> sorted unique [10, 31]. In Feb 2026 (28 days) 31 clamps to 28.
    const out = engine(
      {
        frequency: "semi-monthly",
        start: "2026-01-01",
        cfg: { specificDays: [31, 10, 10] },
        adj: "none",
      },
      "2026-01-01",
      "2026-03-31"
    ).map((o) => o.date);
    expect(out).toEqual([
      "2026-01-10",
      "2026-01-31",
      "2026-02-10",
      "2026-02-28",
      "2026-03-10",
      "2026-03-31",
    ]);
    // [30, 31] in Feb both clamp to Feb 28 and are ONE occurrence (they used to be two rows sharing an id).
    const clamped = engine(
      {
        frequency: "semi-monthly",
        start: "2026-02-01",
        cfg: { specificDays: [30, 31] },
        adj: "none",
      },
      "2026-02-01",
      "2026-02-28"
    ).map((o) => o.date);
    expect(clamped).toEqual(["2026-02-28"]);
  });

  it("ignores an invalid dayOfWeek (string, 7, null) instead of skipping a whole week", () => {
    for (const bad of ["tue", 7, -1, null]) {
      const out = engine(
        {
          frequency: "weekly",
          start: "2026-01-01",
          cfg: { dayOfWeek: bad as unknown as number },
          adj: "none",
        },
        "2026-01-01",
        "2026-01-22"
      ).map((o) => o.date);
      expect(out).toEqual(["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22"]);
    }
  });

  it("returns [] for an unparsable start date or window", () => {
    const base = { frequency: "monthly" as const, cfg: {}, adj: "none" as const };
    expect(engine({ ...base, start: "not-a-date" }, "2026-01-01", "2026-12-31")).toEqual([]);
    expect(
      calculateOccurrencesDetailed(
        {
          frequency: "monthly",
          startDate: "2026-01-01",
          scheduleConfig: {},
          weekendAdjustment: "none",
        },
        new Date(NaN),
        d("2026-12-31")
      )
    ).toEqual([]);
  });

  it("daily rules ignore weekend adjustment: one occurrence per calendar day, each its own id", () => {
    // DECISION (daily + weekend adjustment): Sat Feb 7 and Sun Feb 8 stay where they are.
    const r: Rule = { frequency: "daily", start: "2026-02-05", cfg: {}, adj: "after" };
    const out = engine(r, "2026-02-05", "2026-02-11");
    expect(out.map((o) => o.date)).toEqual([
      "2026-02-05",
      "2026-02-06",
      "2026-02-07",
      "2026-02-08",
      "2026-02-09",
      "2026-02-10",
      "2026-02-11",
    ]);
    expect(out.map((o) => o.logical)).toEqual(out.map((o) => o.date));
  });

  it("keeps an occurrence whose adjusted date is in the window even though its logical date is not", () => {
    // Sat Jan 3 "after" lands on Mon Jan 5. A window starting Jan 4 must hold it; the window ending Jan 4 must not.
    const r: Rule = { frequency: "one-time", start: "2026-01-03", cfg: {}, adj: "after" };
    expect(engine(r, "2026-01-04", "2026-01-10")).toEqual([
      { logical: "2026-01-03", date: "2026-01-05" },
    ]);
    expect(engine(r, "2026-01-01", "2026-01-04")).toEqual([]);
  });
});
