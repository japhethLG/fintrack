/**
 * Drag-and-drop rescheduling (dnd-kit) of projected occurrences, in a real browser.
 *
 * Fixture (today = Tue 2026-03-10; March 2026 starts on a Sunday):
 *   Payday  income  +500  monthly on the 13th (Fri 3/13), start 3/13
 *   Rent    expense -200  monthly on the 18th (Wed 3/18), start 3/18
 *   Payday already carries overrides for OTHER occurrences:
 *     payday_2026-04 = { scheduledDate: 2026-04-17, amount: 777 }
 *     payday_2026-05 = { amount: 111, notes: "may" }
 *   currentBalance 1000, nothing completed, nothing overdue (both rules start in the future).
 *
 * Hand-derived March figures (before any drag): income +500, expenses -200, net +300,
 * opening (Mar 1) 1000, closing (Mar 31) 1300.
 * April (before any drag): Payday 4/17 (+777, overridden), Rent 4/18 (-200)
 *   -> opening 1300, closing 1300 + 777 - 200 = 1877.
 */
import { test, expect, seedAndLogin, userProfile, incomeSource, fixedExpense, completedTransaction, knownDefect, readStore } from "../../index";
import {
  completeInDialog,
  dragTo,
  gridCells,
  monthCell,
  monthChipNames,
  money,
  navigateToMonth,
  openTxnFromCell,
  overridesOf,
  periodFigure,
  revertInDialog,
  selectDay,
  sidebar,
  storedTxns,
  summaryTile,
  txnDialog,
  userBalance,
  viewedHeading,
  weekCell,
  weekChipNames,
} from "./_support";

test.use({ viewport: { width: 1440, height: 1500 } }); // whole calendar in view => dnd-kit never auto-scrolls mid-drag

const OTHER_OVERRIDES = {
  "payday_2026-04": { scheduledDate: "2026-04-17", amount: 777 },
  "payday_2026-05": { amount: 111, notes: "may" },
};

const payday = (o: Parameters<typeof incomeSource>[0] = {}) =>
  incomeSource({
    id: "payday",
    name: "Payday",
    amount: 500,
    frequency: "monthly",
    startDate: "2026-03-13",
    scheduleConfig: { dayOfMonth: 13 },
    occurrenceOverrides: { ...OTHER_OVERRIDES },
    ...o,
  });
const rent = () =>
  fixedExpense({ id: "rent", name: "Rent", amount: 200, frequency: "monthly", startDate: "2026-03-18", scheduleConfig: { dayOfMonth: 18 } });

const boot = async (page: import("@playwright/test").Page, extra: Parameters<typeof seedAndLogin>[1] = {}, waitFor = "Payday") => {
  await seedAndLogin(
    page,
    { user: userProfile({ currentBalance: 1000, initialBalance: 1000 }), incomeSources: [payday()], expenseRules: [rent()], ...extra },
    { path: "/calendar" }
  );
  await expect(viewedHeading(page)).toHaveText("March 2026");
  await expect(monthCell(page, "2026-03", "2026-03-13").getByText(waitFor)).toBeVisible();
};

/** Every chip named `name` in the whole visible month grid (should be exactly the days we expect). */
const daysShowing = async (page: import("@playwright/test").Page, viewMonth: string, name: string): Promise<string[]> => {
  const out: string[] = [];
  const count = await gridCells(page).count();
  const first = `${viewMonth}-01`;
  const dow = new Date(`${first}T00:00:00Z`).getUTCDay();
  for (let i = 0; i < count; i++) {
    const n = await gridCells(page).nth(i).getByText(name, { exact: true }).count();
    for (let k = 0; k < n; k++) out.push(new Date(Date.UTC(+viewMonth.slice(0, 4), +viewMonth.slice(5) - 1, 1 - dow + i)).toISOString().slice(0, 10));
  }
  return out;
};

test.describe("drag a projected occurrence to another day", () => {
  test("same week, weekday: Rent 3/18 -> 3/20", async ({ page }) => {
    await boot(page);
    await dragTo(page, monthCell(page, "2026-03", "2026-03-18").getByText("Rent"), monthCell(page, "2026-03", "2026-03-20"));
    await expect(monthCell(page, "2026-03", "2026-03-20").getByText("Rent")).toBeVisible();
    expect(await daysShowing(page, "2026-03", "Rent")).toEqual(["2026-03-20"]); // exactly once, not on 3/18
    expect(await overridesOf(page, "expense_rules", "rent")).toEqual({ "rent_2026-03": { scheduledDate: "2026-03-20" } });
    // A projected occurrence is not "materialised" by moving it.
    expect(await storedTxns(page)).toEqual([]);
    expect(await userBalance(page)).toBe(1000);
    // Totals for the month are unchanged by a move inside the month.
    await expect(summaryTile(page, "Expenses")).toHaveText("-$200.00");
    await expect(periodFigure(page, "Closing")).toHaveText("$1,300.00");
    // No drag side effect: dialog not opened, nothing selected.
    await expect(txnDialog(page)).toBeHidden();
  });

  test("cross-week: Payday 3/13 -> 3/25, day balances follow the item", async ({ page }) => {
    await boot(page);
    // Before: Fri 3/13 closing = 1000 + 500 = 1500 ; Wed 3/18 closing = 1500 - 200 = 1300.
    await expect(monthCell(page, "2026-03", "2026-03-13")).toContainText("$1,500");
    await dragTo(page, monthCell(page, "2026-03", "2026-03-13").getByText("Payday"), monthCell(page, "2026-03", "2026-03-25"));
    await expect(monthCell(page, "2026-03", "2026-03-25").getByText("Payday")).toBeVisible();
    expect(await daysShowing(page, "2026-03", "Payday")).toEqual(["2026-03-25"]);
    // After: 3/13 closing 1000 ; 3/18 closing 1000 - 200 = 800 ; 3/25 closing 800 + 500 = 1300 ; 3/31 closing 1300.
    await expect(monthCell(page, "2026-03", "2026-03-13")).toContainText("$1,000");
    await expect(monthCell(page, "2026-03", "2026-03-18")).toContainText("$800");
    await expect(monthCell(page, "2026-03", "2026-03-25")).toContainText("$1,300");
    await expect(summaryTile(page, "Income")).toHaveText("+$500.00");
    expect(await overridesOf(page, "income_sources", "payday")).toEqual({
      ...OTHER_OVERRIDES,
      "payday_2026-03": { scheduledDate: "2026-03-25" },
    });
  });

  test("into a weekend (Saturday 3/21): stays on the Saturday the user picked", async ({ page }) => {
    await boot(page);
    await dragTo(page, monthCell(page, "2026-03", "2026-03-13").getByText("Payday"), monthCell(page, "2026-03", "2026-03-21"));
    await expect(monthCell(page, "2026-03", "2026-03-21").getByText("Payday")).toBeVisible();
    expect(await daysShowing(page, "2026-03", "Payday")).toEqual(["2026-03-21"]);
    expect((await overridesOf(page, "income_sources", "payday"))?.["payday_2026-03"]).toEqual({ scheduledDate: "2026-03-21" });
  });

  test("a moved item survives a reload and can be moved a second time (one override key, one chip)", async ({ page }) => {
    await boot(page);
    await dragTo(page, monthCell(page, "2026-03", "2026-03-13").getByText("Payday"), monthCell(page, "2026-03", "2026-03-24"));
    await expect(monthCell(page, "2026-03", "2026-03-24").getByText("Payday")).toBeVisible();
    await page.reload();
    await expect(viewedHeading(page)).toHaveText("March 2026");
    expect(await daysShowing(page, "2026-03", "Payday")).toEqual(["2026-03-24"]);
    await dragTo(page, monthCell(page, "2026-03", "2026-03-24").getByText("Payday"), monthCell(page, "2026-03", "2026-03-02"));
    await expect(monthCell(page, "2026-03", "2026-03-02").getByText("Payday")).toBeVisible();
    expect(await daysShowing(page, "2026-03", "Payday")).toEqual(["2026-03-02"]);
    expect(await overridesOf(page, "income_sources", "payday")).toEqual({
      ...OTHER_OVERRIDES,
      "payday_2026-03": { scheduledDate: "2026-03-02" },
    });
  });

  test("dropping with the POINTER on a day cell lands on that cell, not its right-hand neighbour", async ({ page }) => {
    knownDefect(
      "E2E-CAL-03",
      "drop target is chosen from the 221px-wide floating overlay rect (dnd-kit rectIntersection), not from the pointer: releasing over Fri 3/20 files Rent under Sat 3/21"
    );
    await boot(page);
    await dragTo(page, monthCell(page, "2026-03", "2026-03-18").getByText("Rent"), monthCell(page, "2026-03", "2026-03-20"), "pointer");
    await expect.poll(async () => (await overridesOf(page, "expense_rules", "rent"))?.["rent_2026-03"] !== undefined).toBe(true);
    expect((await overridesOf(page, "expense_rules", "rent"))?.["rent_2026-03"]).toEqual({ scheduledDate: "2026-03-20" });
  });

  test("dropping on the day it already occupies writes nothing", async ({ page }) => {
    await boot(page);
    const opsBefore = (await readStore(page)).ops.length;
    await dragTo(page, monthCell(page, "2026-03", "2026-03-13").getByText("Payday"), monthCell(page, "2026-03", "2026-03-13"));
    await expect(txnDialog(page)).toBeHidden();
    expect(await daysShowing(page, "2026-03", "Payday")).toEqual(["2026-03-13"]);
    expect((await readStore(page)).ops.length).toBe(opsBefore);
  });

  test("a short wiggle (< 8px) is a click, not a drag: it opens the transaction dialog and moves nothing", async ({ page }) => {
    await boot(page);
    const chip = monthCell(page, "2026-03", "2026-03-13").getByText("Payday");
    const b = (await chip.boundingBox())!;
    await page.mouse.move(b.x + 5, b.y + 5);
    await page.mouse.down();
    await page.mouse.move(b.x + 9, b.y + 5, { steps: 3 });
    await page.mouse.up();
    await expect(txnDialog(page)).toBeVisible();
    expect(await overridesOf(page, "income_sources", "payday")).toEqual(OTHER_OVERRIDES);
  });

  test("across a month boundary: drop on the trailing 4/1 cell moves it out of March and into April", async ({ page }) => {
    await boot(page);
    await dragTo(page, monthCell(page, "2026-03", "2026-03-13").getByText("Payday"), monthCell(page, "2026-03", "2026-04-01"));
    // Gone from March (March income is now 0; chips are not drawn on trailing cells).
    await expect(summaryTile(page, "Income")).toHaveText("+$0.00");
    expect(await daysShowing(page, "2026-03", "Payday")).toEqual([]);
    // March closing = 1000 - 200.
    await expect(periodFigure(page, "Closing")).toHaveText("$800.00");
    expect((await overridesOf(page, "income_sources", "payday"))?.["payday_2026-03"]).toEqual({ scheduledDate: "2026-04-01" });

    await navigateToMonth(page, "2026-03", "2026-04");
    // April: moved March payday on 4/1, native April payday on 4/17 (overridden amount 777), rent 4/18.
    expect(await daysShowing(page, "2026-04", "Payday")).toEqual(["2026-04-01", "2026-04-17"]);
    // Opening chain: April opening == March closing == 800.
    await expect(periodFigure(page, "Opening")).toHaveText("$800.00");
    // 800 + 500 + 777 - 200
    await expect(periodFigure(page, "Closing")).toHaveText("$1,877.00");
    await expect(summaryTile(page, "Income")).toHaveText("+$1,277.00");
    await page.reload();
    await navigateToMonth(page, "2026-03", "2026-04");
    expect(await daysShowing(page, "2026-04", "Payday")).toEqual(["2026-04-01", "2026-04-17"]);
  });

  test("dropping on a leading previous-month cell (3/31 on the April grid) moves April's Rent into March", async ({ page }) => {
    await boot(page);
    await navigateToMonth(page, "2026-03", "2026-04");
    // April grid starts Wed 4/1, so 3/29..3/31 are the leading (previous-month) cells. Drop Rent 4/18 on 3/31.
    await dragTo(page, monthCell(page, "2026-04", "2026-04-18").getByText("Rent"), monthCell(page, "2026-04", "2026-03-31"));
    await expect(summaryTile(page, "Expenses")).toHaveText("$0.00");
    expect((await overridesOf(page, "expense_rules", "rent"))?.["rent_2026-04"]).toEqual({ scheduledDate: "2026-03-31" });
    await navigateToMonth(page, "2026-04", "2026-03");
    // March now has Rent on 3/18 (native) and 3/31 (April's rent).
    expect(await daysShowing(page, "2026-03", "Rent")).toEqual(["2026-03-18", "2026-03-31"]);
    await expect(summaryTile(page, "Expenses")).toHaveText("-$400.00");
  });

  test("moving one occurrence never touches other occurrences' overrides (April/May stay exactly as seeded)", async ({ page }) => {
    await boot(page);
    await dragTo(page, monthCell(page, "2026-03", "2026-03-13").getByText("Payday"), monthCell(page, "2026-03", "2026-03-16"));
    await expect(monthCell(page, "2026-03", "2026-03-16").getByText("Payday")).toBeVisible();
    const ov = (await overridesOf(page, "income_sources", "payday"))!;
    expect(ov["payday_2026-04"]).toEqual(OTHER_OVERRIDES["payday_2026-04"]);
    expect(ov["payday_2026-05"]).toEqual(OTHER_OVERRIDES["payday_2026-05"]);
    await navigateToMonth(page, "2026-03", "2026-04");
    expect(await daysShowing(page, "2026-04", "Payday")).toEqual(["2026-04-17"]);
  });

  test("the same occurrence's other overrides (amount, notes) survive being moved", async ({ page }) => {
    await boot(page, {
      incomeSources: [payday({ occurrenceOverrides: { ...OTHER_OVERRIDES, "payday_2026-03": { amount: 650, notes: "bonus" } } })],
    });
    // Precondition: the overridden amount is what the calendar shows before the drag (income tile = 650).
    await expect(summaryTile(page, "Income")).toHaveText("+$650.00");
    await dragTo(page, monthCell(page, "2026-03", "2026-03-13").getByText("Payday"), monthCell(page, "2026-03", "2026-03-24"));
    await expect(monthCell(page, "2026-03", "2026-03-24").getByText("Payday")).toBeVisible();
    expect((await overridesOf(page, "income_sources", "payday"))?.["payday_2026-03"]).toEqual({
      scheduledDate: "2026-03-24",
      amount: 650,
      notes: "bonus",
    });
    await expect(summaryTile(page, "Income")).toHaveText("+$650.00");
  });
});

test.describe("drag from the day-detail sidebar and from the week view", () => {
  test("sidebar list item (selected day) can be dragged onto a grid cell", async ({ page }) => {
    await boot(page);
    await selectDay(monthCell(page, "2026-03", "2026-03-13")); // select 3/13 -> sidebar lists Payday
    await expect(sidebar(page)).toContainText("Friday, Mar 13");
    const item = sidebar(page).getByText("Payday", { exact: true });
    await expect(item).toBeVisible();
    await dragTo(page, item, monthCell(page, "2026-03", "2026-03-27"));
    await expect(monthCell(page, "2026-03", "2026-03-27").getByText("Payday")).toBeVisible();
    expect(await daysShowing(page, "2026-03", "Payday")).toEqual(["2026-03-27"]);
    expect((await overridesOf(page, "income_sources", "payday"))?.["payday_2026-03"]).toEqual({ scheduledDate: "2026-03-27" });
    // The sidebar still shows the selected day (3/13) and it is now empty.
    await expect(sidebar(page)).toContainText("No transactions");
  });

  test("week view: drag between days of the same week and into next week's cell after navigating", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "Week", exact: true }).click();
    // Today is Tue 3/10, week = Sun 3/8 .. Sat 3/14.  Payday (Fri 3/13) -> Sat 3/14.
    await expect(page.getByRole("heading", { level: 2 })).toContainText("Mar 8");
    await dragTo(page, weekCell(page, "2026-03-13").getByText("Payday"), weekCell(page, "2026-03-14"));
    await expect(weekCell(page, "2026-03-14").getByText("Payday")).toBeVisible();
    expect(await weekChipNames(weekCell(page, "2026-03-13"))).toEqual([]);
    expect((await overridesOf(page, "income_sources", "payday"))?.["payday_2026-03"]).toEqual({ scheduledDate: "2026-03-14" });
    // Move to the next week (3/15..3/21): Rent (Wed 3/18) is there; move it to Sunday 3/15.
    await page.getByRole("button", { name: "chevron_right" }).click();
    await expect(page.getByRole("heading", { level: 2 })).toContainText("Mar 15");
    await dragTo(page, weekCell(page, "2026-03-18").getByText("Rent"), weekCell(page, "2026-03-15"));
    await expect(weekCell(page, "2026-03-15").getByText("Rent")).toBeVisible();
    expect((await overridesOf(page, "expense_rules", "rent"))?.["rent_2026-03"]).toEqual({ scheduledDate: "2026-03-15" });
  });
});

test.describe("drag a stored (completed) transaction", () => {
  test("moving a completed rule-based transaction updates scheduledDate AND actualDate, not the balance", async ({ page }) => {
    await boot(page, {
      user: userProfile({ currentBalance: 1500, initialBalance: 1000 }),
      transactions: [
        completedTransaction({
          id: "done-payday",
          name: "Payday",
          type: "income",
          sourceType: "income_source",
          sourceId: "payday",
          occurrenceId: "payday_2026-03",
          scheduledDate: "2026-03-13",
          projectedAmount: 500,
          actualAmount: 500,
        }),
      ],
    });
    await dragTo(page, monthCell(page, "2026-03", "2026-03-13").getByText("Payday"), monthCell(page, "2026-03", "2026-03-26"));
    await expect(monthCell(page, "2026-03", "2026-03-26").getByText("Payday")).toBeVisible();
    expect(await daysShowing(page, "2026-03", "Payday")).toEqual(["2026-03-26"]);
    const [t] = await storedTxns(page);
    expect([t.scheduledDate, t.actualDate, t.status]).toEqual(["2026-03-26", "2026-03-26", "completed"]);
    expect(await userBalance(page)).toBe(1500);
    // No projection was resurrected on the original date and no override was written.
    expect(await overridesOf(page, "income_sources", "payday")).toEqual(OTHER_OVERRIDES);
  });
});

test.describe("complete and revert a rescheduled occurrence", () => {
  test("monthly: complete keeps the moved date; revert restores the projection on the moved date", async ({ page }) => {
    await boot(page);
    await dragTo(page, monthCell(page, "2026-03", "2026-03-13").getByText("Payday"), monthCell(page, "2026-03", "2026-03-25"));
    await expect(monthCell(page, "2026-03", "2026-03-25").getByText("Payday")).toBeVisible();

    const dialog = await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-25"), "Payday");
    await expect(dialog).toContainText("Wed, Mar 25, 2026"); // scheduled date shown = the moved date
    await completeInDialog(page);

    const [done] = await storedTxns(page);
    expect([done.status, done.scheduledDate, done.actualDate, done.occurrenceId, done.actualAmount]).toEqual([
      "completed",
      "2026-03-25",
      "2026-03-25",
      "payday_2026-03",
      500,
    ]);
    expect(await userBalance(page)).toBe(1500);
    // Its override is consumed; the other occurrences' overrides are intact.
    expect(await overridesOf(page, "income_sources", "payday")).toEqual(OTHER_OVERRIDES);
    expect(await daysShowing(page, "2026-03", "Payday")).toEqual(["2026-03-25"]); // exactly one, not a stored + a projected

    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-25"), "Payday");
    await revertInDialog(page);
    await expect.poll(() => storedTxns(page)).toEqual([]);
    expect(await userBalance(page)).toBe(1000);
    expect(await daysShowing(page, "2026-03", "Payday")).toEqual(["2026-03-25"]); // kept its custom date
    expect((await overridesOf(page, "income_sources", "payday"))?.["payday_2026-03"]).toEqual({ scheduledDate: "2026-03-25" });
  });

  test("weekly: reverting a completed, moved occurrence keeps its custom date", async ({ page }) => {
    // Weekly income on Fridays (dayOfWeek 5), start 3/13: Fridays 3/13, 3/20, 3/27. ISO weeks W11, W12, W13.
    await boot(page, {
      incomeSources: [
        incomeSource({
          id: "weekly",
          name: "Weekly Gig",
          amount: 100,
          frequency: "weekly",
          startDate: "2026-03-13",
          scheduleConfig: { dayOfWeek: 5 },
        }),
      ],
      expenseRules: [],
    }, "Weekly Gig");
    await dragTo(page, monthCell(page, "2026-03", "2026-03-13").getByText("Weekly Gig"), monthCell(page, "2026-03", "2026-03-24"));
    await expect(monthCell(page, "2026-03", "2026-03-24").getByText("Weekly Gig")).toBeVisible();
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-24"), "Weekly Gig");
    await completeInDialog(page);
    await expect(monthCell(page, "2026-03", "2026-03-24").getByText("Weekly Gig")).toBeVisible();
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-24"), "Weekly Gig");
    await revertInDialog(page);
    await expect.poll(() => storedTxns(page)).toEqual([]);
    // Correct: the user's date is preserved. Observed: it reappears on Fri 3/13.
    await expect(monthCell(page, "2026-03", "2026-03-13").getByText("Weekly Gig")).toHaveCount(0);
    await expect(monthCell(page, "2026-03", "2026-03-24").getByText("Weekly Gig")).toBeVisible();
  });

  test("complete + revert of a NEVER-moved monthly occurrence leaves no override behind", async ({ page }) => {
    // Rule starts on the 1st but pays on the 13th: the March item sits on its pattern date (3/13).
    await boot(page, { incomeSources: [payday({ startDate: "2026-03-01", occurrenceOverrides: {} })] });
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-13"), "Payday");
    await completeInDialog(page);
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-13"), "Payday");
    await revertInDialog(page);
    await expect.poll(() => storedTxns(page)).toEqual([]);
    await expect(monthCell(page, "2026-03", "2026-03-13").getByText("Payday")).toBeVisible();
    // nothing was moved => nothing to remember. REWRITTEN (write-path stream): was
    // `toBeUndefined()`, but this scenario seeds `occurrenceOverrides: {}` and completing the
    // occurrence deletes its key from that map (Firestore's deleteField leaves the empty map),
    // so the stored value is `{}`, never undefined. The intent is "no entries", asserted exactly.
    expect(Object.keys((await overridesOf(page, "income_sources", "payday")) ?? {})).toEqual([]);
  });

  test("an occurrence moved into the next month keeps its own identity when completed there", async ({ page }) => {
    await boot(page);
    await dragTo(page, monthCell(page, "2026-03", "2026-03-13").getByText("Payday"), monthCell(page, "2026-03", "2026-04-01"));
    await expect(summaryTile(page, "Income")).toHaveText("+$0.00");
    await navigateToMonth(page, "2026-03", "2026-04");
    await openTxnFromCell(page, monthCell(page, "2026-04", "2026-04-01"), "Payday");
    await completeInDialog(page);
    const [done] = await storedTxns(page);
    // It is still MARCH's payday (identity), realised on 4/1 ...
    expect([done.occurrenceId, done.scheduledDate, done.actualDate]).toEqual(["payday_2026-03", "2026-04-01", "2026-04-01"]);
    // ... and April's own payday (4/17, override amount 777) is untouched and still projected.
    expect(await daysShowing(page, "2026-04", "Payday")).toEqual(["2026-04-01", "2026-04-17"]);
    await expect(summaryTile(page, "Transactions")).toHaveText("1 / 3"); // completed 1 (moved March payday) of 3 (+ April payday + Rent)
  });
});

test.describe("keyboard", () => {
  test("a chip can be picked up and rescheduled with the keyboard", async ({ page }) => {
    test.fixme(
      true,
      "DECISION: only MouseSensor and TouchSensor are registered (no KeyboardSensor) and the transaction dialog has no 'reschedule' field, so rescheduling is mouse/touch only although chips are focusable role=button. Decide whether keyboard rescheduling is required."
    );
    await boot(page);
    const chip = monthCell(page, "2026-03", "2026-03-18").getByText("Rent");
    await chip.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await expect(monthCell(page, "2026-03", "2026-03-19").getByText("Rent")).toBeVisible();
  });
});
