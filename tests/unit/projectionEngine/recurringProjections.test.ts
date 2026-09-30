import { describe, expect, it } from "vitest";
import { generateIncomeProjections } from "@/lib/logic/projectionEngine/incomeProjections";
import { generateExpenseProjections } from "@/lib/logic/projectionEngine/expenseProjections";
import { generateProjections } from "@/lib/logic/projectionEngine/projectionGenerator";
import { makeExpenseRule, makeIncomeSource } from "../../helpers/builders";
import { d, duplicates } from "../../helpers/dates";

/**
 * Generators: identity from the LOGICAL date, windows applied to each row's FINAL date
 * (an override may relocate a row), and composability across windows.
 */

const rows = (list: { scheduledDate: string; occurrenceId?: string }[]) =>
  list.map((p) => `${p.scheduledDate} ${p.occurrenceId}`);

describe("income projections: identity and weekend adjustment", () => {
  const semi = (adj: "none" | "before" | "after") =>
    makeIncomeSource({
      id: "semi",
      frequency: "semi-monthly",
      startDate: "2026-01-01",
      scheduleConfig: { specificDays: [15, 30] },
      weekendAdjustment: adj,
    });

  it("gives every projection of a year a unique id, and the ids do not depend on weekendAdjustment", () => {
    const idsFor = (adj: "none" | "before" | "after") =>
      generateIncomeProjections(semi(adj), d("2026-01-01"), d("2026-12-31")).map(
        (p) => p.occurrenceId
      );
    const none = idsFor("none");
    expect(none).toHaveLength(24); // 12 months x 2 slots, none dropped
    expect(duplicates(none)).toEqual([]);
    expect(idsFor("before")).toEqual(none);
    expect(idsFor("after")).toEqual(none);
    // spot check against hand-derived ids: slot 1 = the 15th, slot 2 = the 30th (Feb clamps to the 28th).
    expect(none.slice(0, 4)).toEqual([
      "semi_2026-01-1",
      "semi_2026-01-2",
      "semi_2026-02-1",
      "semi_2026-02-2",
    ]);
  });

  it("March 2026 'after': Sun 15th is paid Mon 16th under slot 1, Mon 30th stays under slot 2, and Feb's Sat 28th lands Mon Mar 2 under FEBRUARY's id", () => {
    const march = generateIncomeProjections(semi("after"), d("2026-03-01"), d("2026-03-31"));
    // Hand-derived (Feb 1 2026 is a Sunday): Feb 28 is a Saturday, so February's slot 2 is paid Mon Mar 2, and that
    // row keeps its own logical id `semi_2026-02-2` even though it is shown in March. Mar 15 is a Sunday -> Mon 16.
    expect(rows(march)).toEqual([
      "2026-03-02 semi_2026-02-2",
      "2026-03-16 semi_2026-03-1",
      "2026-03-30 semi_2026-03-2",
    ]);
  });
});

describe("recurring projections: overrides and windows", () => {
  const rent = (overrides = {}) =>
    makeExpenseRule({ id: "exp-1", frequency: "monthly", startDate: "2026-01-15", ...overrides });

  it("an override's scheduledDate relocates the row: out of its natural window, into the window it lands in", () => {
    // March's rent (logical Mar 15) is dragged to Sat May 2.
    const moved = rent({
      occurrenceOverrides: { "exp-1_2026-03": { scheduledDate: "2026-05-02" } },
    });
    const march = generateExpenseProjections(moved, d("2026-03-01"), d("2026-03-31"));
    expect(march).toEqual([]); // no longer in March

    const may = generateExpenseProjections(moved, d("2026-05-01"), d("2026-05-31"));
    // May holds its own rent (May 15) AND the relocated March rent, in date order.
    expect(rows(may)).toEqual(["2026-05-02 exp-1_2026-03", "2026-05-15 exp-1_2026-05"]);
  });

  it("is composable with overrides: two adjacent windows together equal the window spanning both", () => {
    const moved = rent({
      occurrenceOverrides: {
        "exp-1_2026-03": { scheduledDate: "2026-05-02" },
        "exp-1_2026-06": { scheduledDate: "2026-04-20" },
        "exp-1_2026-04": { amount: 99 },
      },
    });
    const whole = rows(generateExpenseProjections(moved, d("2026-03-01"), d("2026-07-31")));
    const left = rows(generateExpenseProjections(moved, d("2026-03-01"), d("2026-04-30")));
    const right = rows(generateExpenseProjections(moved, d("2026-05-01"), d("2026-07-31")));
    expect([...left, ...right]).toEqual(whole);
    // Hand-derived: Mar 15's rent was dragged to May 2, Jun 15's to Apr 20; Apr (amount override only) stays Apr 15.
    expect(whole).toEqual([
      "2026-04-15 exp-1_2026-04",
      "2026-04-20 exp-1_2026-06",
      "2026-05-02 exp-1_2026-03",
      "2026-05-15 exp-1_2026-05",
      "2026-07-15 exp-1_2026-07",
    ]);
  });

  it("a skipped override removes the occurrence, and only that occurrence", () => {
    const skipped = rent({ occurrenceOverrides: { "exp-1_2026-02": { skipped: true } } });
    const out = generateExpenseProjections(skipped, d("2026-01-01"), d("2026-03-31"));
    expect(rows(out)).toEqual(["2026-01-15 exp-1_2026-01", "2026-03-15 exp-1_2026-03"]);
  });

  it("an override keyed to an id that matches nothing is ignored", () => {
    const stray = rent({
      occurrenceOverrides: { "exp-1_1999-01": { scheduledDate: "2026-02-02" } },
    });
    const out = generateExpenseProjections(stray, d("2026-02-01"), d("2026-02-28"));
    expect(rows(out)).toEqual(["2026-02-15 exp-1_2026-02"]);
  });

  it("generateProjections sorts interleaved sources by date without parsing dates", () => {
    const out = generateProjections(
      [makeIncomeSource({ id: "pay", frequency: "monthly", startDate: "2026-01-20" })],
      [rent()],
      d("2026-01-01"),
      d("2026-02-28")
    );
    expect(out.map((p) => p.scheduledDate)).toEqual([
      "2026-01-15",
      "2026-01-20",
      "2026-02-15",
      "2026-02-20",
    ]);
  });
});
