import { describe, expect, it } from "vitest";
import { knownDefect, makeExpenseRule, makeIncomeSource } from "../harness";
import {
  balanceOf,
  chipNamesOnDay,
  completeTx,
  dragToDate,
  expectInvariants,
  merged,
  mountAll,
  nth,
  revertTx,
  rowMoney,
  selectDay,
  sidebarPanel,
  skipTx,
  storedRule,
  storedTxs,
  displayedBalance,
} from "./kit";
import type { ExpenseRule } from "@/lib/types";

/**
 * Reschedule (drag a chip on the real Calendar onto another day) and what it does to overrides,
 * completion and revert. Hosts the real Calendar + Transactions list on one context (kit.mountAll).
 * Calendar shows January 2026 (today 2026-01-15); Jan 1 2026 is a Thursday, so the grid also shows
 * Dec 28-31 and Feb 1-7.
 */

const T = 90_000;

const rent = (over: Partial<ExpenseRule> = {}) =>
  makeExpenseRule({
    id: "rent",
    name: "Rent",
    amount: 1_200,
    startDate: "2026-01-12",
    endDate: "2026-02-12",
    ...over,
  });

const overrides = (app: Parameters<typeof storedRule>[0]) => storedRule(app, "rent").occurrenceOverrides;

describe("reschedule a projected rule occurrence (drag on the calendar)", () => {
  it("writes an override for THAT occurrence only, keeps it projected, and moves the chip", async () => {
    const app = await mountAll({ expenseRules: [rent()] });
    expect(chipNamesOnDay(12)).toEqual(["Rent"]);
    const jan = nth(app, "Rent", 0);
    await dragToDate(app, jan.id, "2026-01-20");

    expect(overrides(app)).toEqual({ "rent_2026-01": { scheduledDate: "2026-01-20" } });
    const rows = merged(app).filter((t) => t.sourceId === "rent");
    expect(rows.map((t) => [t.scheduledDate, t.status])).toEqual([
      ["2026-01-20", "projected"],
      ["2026-02-12", "projected"],
    ]);
    expect(storedTxs(app)).toHaveLength(0); // a reschedule of a projection creates no transaction
    expect(balanceOf(app)).toBe(10_000);
    expect(chipNamesOnDay(12)).toEqual([]);
    expect(chipNamesOnDay(20)).toEqual(["Rent"]);
    expectInvariants(app, ["drag Jan12 -> Jan20"]);
  }, T);

  it("dropping a chip on its own day writes nothing", async () => {
    const app = await mountAll({ expenseRules: [rent()] });
    const before = app.store.__ops.length;
    await dragToDate(app, nth(app, "Rent", 0).id, "2026-01-12");
    expect(app.store.__ops.length).toBe(before);
    expect(overrides(app)).toBeUndefined();
  }, T);

  it("a chip can be dropped on a next-month cell of the grid (Feb 2) without touching the Feb occurrence", async () => {
    const app = await mountAll({ expenseRules: [rent()] });
    await dragToDate(app, nth(app, "Rent", 0).id, "2026-02-02");
    const rows = merged(app).filter((t) => t.sourceId === "rent");
    expect(rows.map((t) => t.scheduledDate)).toEqual(["2026-02-02", "2026-02-12"]);
    expect(new Set(rows.map((t) => t.id)).size).toBe(2);
    expectInvariants(app, ["drag Jan12 -> Feb2"]);
  }, T);

  it("the sidebar for the target day lists the moved item once", async () => {
    const app = await mountAll({ expenseRules: [rent()] });
    await dragToDate(app, nth(app, "Rent", 0).id, "2026-01-20");
    await selectDay(app, 20);
    expect(sidebarPanel().textContent).toContain("Transactions (1)");
    expect(sidebarPanel().textContent).toContain("Rent");
  }, T);
});

describe("reschedule a stored (completed / skipped) transaction", () => {
  it("dragging a COMPLETED row moves both scheduledDate and actualDate and never touches the balance", async () => {
    const app = await mountAll({ expenseRules: [rent()] });
    await completeTx(app, nth(app, "Rent", 0).id, { amount: 1_250 });
    expect(balanceOf(app)).toBe(8_750);
    const done = storedTxs(app)[0];
    await dragToDate(app, done.id, "2026-01-27");
    expect(storedTxs(app)[0]).toMatchObject({
      scheduledDate: "2026-01-27",
      actualDate: "2026-01-27",
      status: "completed",
      actualAmount: 1_250,
    });
    expect(balanceOf(app)).toBe(8_750);
    expect(displayedBalance()).toBe(8_750);
    expectInvariants(app, ["complete", "drag"]);
  }, T);

  it("dragging a SKIPPED row moves it and keeps it skipped", async () => {
    const app = await mountAll({ expenseRules: [rent()] });
    await skipTx(app, nth(app, "Rent", 0).id);
    await dragToDate(app, storedTxs(app)[0].id, "2026-01-22");
    expect(storedTxs(app)[0]).toMatchObject({ scheduledDate: "2026-01-22", status: "skipped" });
    expect(balanceOf(app)).toBe(10_000);
  }, T);
});

describe("revert keeps a custom date (the modal promises it)", () => {
  it("monthly rule: reschedule -> complete -> revert puts the occurrence back on the MOVED day", async () => {
    const app = await mountAll({ expenseRules: [rent()] });
    await dragToDate(app, nth(app, "Rent", 0).id, "2026-01-22");
    await completeTx(app, nth(app, "Rent", 0).id);
    expect(storedTxs(app)[0]).toMatchObject({ scheduledDate: "2026-01-22", occurrenceId: "rent_2026-01" });
    expect(overrides(app)?.["rent_2026-01"]).toBeUndefined(); // realised occurrences drop their override
    await revertTx(app, storedTxs(app)[0].id);
    expect(storedTxs(app)).toHaveLength(0);
    expect(merged(app).filter((t) => t.sourceId === "rent").map((t) => t.scheduledDate)).toEqual([
      "2026-01-22",
      "2026-02-12",
    ]);
    expect(balanceOf(app)).toBe(10_000);
  }, T);

  it("daily rule: the moved day survives complete -> revert", async () => {
    const app = await mountAll({
      expenseRules: [
        rent({ id: "rent", name: "Coffee run", frequency: "daily", startDate: "2026-01-10", endDate: "2026-01-11", amount: 5 }),
      ],
    });
    const first = nth(app, "Coffee run", 0);
    await dragToDate(app, first.id, "2026-01-24");
    await completeTx(app, merged(app).find((t) => t.scheduledDate === "2026-01-24")!.id);
    await revertTx(app, storedTxs(app)[0].id);
    expect(merged(app).some((t) => t.scheduledDate === "2026-01-24" && t.status === "projected")).toBe(true);
  }, T);

  knownDefect(
    "UI-LIFE-25",
    "weekly rule: reschedule -> complete -> revert forgets the moved date (the modal says it will be preserved)",
    async () => {
      // Gym every Monday: Jan 5, 12, 19. Move Jan 12 to Thu Jan 22, complete it, revert it.
      // observed: the row is back on Jan 12 (no override is written for week-based occurrence ids).
      const app = await mountAll({
        expenseRules: [
          rent({ id: "rent", name: "Gym", frequency: "weekly", startDate: "2026-01-05", endDate: "2026-01-20", amount: 20, scheduleConfig: { dayOfWeek: 1 } }),
        ],
      });
      expect(merged(app).map((t) => t.scheduledDate)).toEqual(["2026-01-05", "2026-01-12", "2026-01-19"]);
      await dragToDate(app, nth(app, "Gym", 1).id, "2026-01-22");
      await completeTx(app, merged(app).find((t) => t.scheduledDate === "2026-01-22")!.id);
      expect(storedTxs(app)[0]).toMatchObject({ scheduledDate: "2026-01-22", status: "completed" });
      await revertTx(app, storedTxs(app)[0].id);
      expect(storedTxs(app)).toHaveLength(0);
      expect(merged(app).map((t) => t.scheduledDate)).toEqual(["2026-01-05", "2026-01-19", "2026-01-22"]);
    },
    T
  );

  knownDefect(
    "UI-LIFE-25b",
    "bi-weekly rule: the moved date is also lost on revert",
    async () => {
      // Payroll every 2 weeks from Fri Jan 2 (Jan 2, 16, 30). Move Jan 16 -> Jan 20, complete, revert.
      const app = await mountAll({
        incomeSources: [
          makeIncomeSource({ id: "pay", name: "Payroll", amount: 1_000, frequency: "bi-weekly", startDate: "2026-01-02", endDate: "2026-01-30", scheduleConfig: { intervalWeeks: 2 } }),
        ],
      });
      expect(merged(app).map((t) => t.scheduledDate)).toEqual(["2026-01-02", "2026-01-16", "2026-01-30"]);
      await dragToDate(app, nth(app, "Payroll", 1).id, "2026-01-20");
      await completeTx(app, merged(app).find((t) => t.scheduledDate === "2026-01-20")!.id);
      await revertTx(app, storedTxs(app)[0].id);
      expect(storedTxs(app)).toHaveLength(0);
      expect(merged(app).map((t) => t.scheduledDate)).toEqual(["2026-01-02", "2026-01-20", "2026-01-30"]);
    },
    T
  );
});

describe("reschedule and the other override fields", () => {
  /** an amount + note override such as a future 'this month it is 1,300' feature (or old data) would store */
  const withOverride = () =>
    rent({ occurrenceOverrides: { "rent_2026-01": { amount: 1_300, notes: "includes parking" } } });

  it("precondition: an amount override is honoured by the projection (row prints -1,300)", async () => {
    const app = await mountAll({ expenseRules: [withOverride()] });
    expect(-rowMoney(app, nth(app, "Rent", 0).id)[0]).toBe(1_300);
  }, T);

  knownDefect(
    "UI-LIFE-26",
    "dragging an occurrence REPLACES its override: an amount/notes override is silently dropped",
    async () => {
      // observed: after the drag occurrenceOverrides['rent_2026-01'] = { scheduledDate } only, the row
      // goes back to -1,200. Correct: date changes, amount 1,300 and the note stay.
      const app = await mountAll({ expenseRules: [withOverride()] });
      expect(-rowMoney(app, nth(app, "Rent", 0).id)[0]).toBe(1_300); // precondition
      await dragToDate(app, nth(app, "Rent", 0).id, "2026-01-20");
      expect(merged(app).find((t) => t.sourceId === "rent")!.scheduledDate).toBe("2026-01-20"); // precondition: it moved
      expect(overrides(app)?.["rent_2026-01"]).toMatchObject({ scheduledDate: "2026-01-20", amount: 1_300 });
    },
    T
  );

  knownDefect(
    "UI-LIFE-14b",
    "completing an occurrence that has an amount override stores the RULE's amount as projectedAmount, not the 1,300 the row showed",
    async () => {
      // observed: stored projectedAmount 1200 (source.amount). The row said -1,300.
      const app = await mountAll({ expenseRules: [withOverride()] });
      const jan = nth(app, "Rent", 0);
      expect(-rowMoney(app, jan.id)[0]).toBe(1_300); // precondition
      await completeTx(app, jan.id);
      expect(storedTxs(app)[0].actualAmount).toBe(1_300);
      expect(storedTxs(app)[0].projectedAmount).toBe(1_300);
    },
    T
  );

  it("completing an occurrence removes its override (the stored row takes over)", async () => {
    const app = await mountAll({ expenseRules: [withOverride()] });
    await completeTx(app, nth(app, "Rent", 0).id);
    expect(overrides(app)?.["rent_2026-01"]).toBeUndefined();
    expect(balanceOf(app)).toBe(8_700);
    expectInvariants(app, ["complete overridden occurrence"]);
  }, T);
});
