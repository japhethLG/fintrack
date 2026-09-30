/**
 * JOURNEY 1 - brand-new user, UI only (sign up -> Settings -> wizards -> pages),
 * then several simulated days (clock moved + hard reload each time).
 *
 * Invariant after EVERY step (SPECIFICATION 3.4 "Balance Updates" + accounting):
 *   users/{uid}.currentBalance == initialBalance + sum(signed completed transactions)
 * and Dashboard, Calendar (closing balance of TODAY), Forecast and Settings all
 * display that same figure. A new user's default currency is PHP (US$ never appears).
 *
 * Household (all typed through the wizards, "No adjustment" for weekends):
 *   initial balance            10,000.00
 *   Acme Payroll  semi-monthly 15th & 30th, start 2026-03-10, +2,000.00
 *   Rent          monthly day 12,           start 2026-03-10, -1,200.00
 *   Groceries     weekly Saturday,          start 2026-03-10, -150.00 (variable)
 *   Car Loan      12,000 @12% x12, first payment 2026-03-15, PMT 1,066.19
 *   Visa          5,000 @24%, due day 25, minimum 2% (=100.00), tracking from 2026-03-10
 *   Phone Plan    1,200 / 6 = 200.00, first payment 2026-03-20
 * March 2026 occurrences: income 15th+30th = 4,000.00;
 *   expenses = Rent 1,200 + Groceries (14,21,28) 450 + Loan 1,066.19 + Visa 100 + Phone 200 = 3,016.19
 */
import { test, expect } from "../../index";
import * as S from "./support";

const INITIAL = 10_000;

test.describe("new user onboarding journey", () => {
  test("sign up -> starting balance -> six wizards -> multi-day completions keep every page in agreement", async ({ page }) => {
    test.setTimeout(300_000);

    // --- sign up + starting balance -------------------------------------
    await S.signUpViaForm(page, "newcomer@example.com");
    expect((await S.readUser(page)).currentBalance).toBe(0);
    await S.gotoPage(page, "Settings");
    await S.setInitialBalanceViaSettings(page, INITIAL);
    await expect(page.getByText("Balance updated successfully!")).toBeVisible();
    const u0 = await S.readUser(page);
    expect(u0.initialBalance).toBe(INITIAL);
    expect(u0.currentBalance).toBe(INITIAL);
    expect(u0.preferences.currency).toBe("PHP");

    // --- wizards ---------------------------------------------------------
    await S.gotoPage(page, "Income Manager");
    await S.addIncomeViaWizardFull(page, {
      name: "Acme Payroll", amount: 2000, frequency: "Semi-monthly", startDate: "2026-03-10", weekendAdjustment: "No adjustment",
    });
    await S.gotoPage(page, "Expense Manager");
    await S.addFixedExpenseViaWizard(page, { name: "Rent", amount: 1200, frequency: "Monthly", startDate: "2026-03-10", dayOfMonth: 12, weekendAdjustment: "No adjustment" });
    await S.addFixedExpenseViaWizard(page, { name: "Groceries", amount: 150, variable: true, frequency: "Weekly", startDate: "2026-03-10", weekday: "Saturday", weekendAdjustment: "No adjustment" });
    await S.addLoanViaWizard(page, { name: "Car Loan", principal: 12000, ratePct: 12, termMonths: 12, firstPayment: "2026-03-15", loanStart: "2026-03-10", weekendAdjustment: "No adjustment" });
    await S.addCreditCardViaWizard(page, { name: "Visa", limit: 10000, balance: 5000, aprPct: 24, dueDay: 25, startDate: "2026-03-10", weekendAdjustment: "No adjustment" });
    await S.addInstallmentViaWizard(page, { name: "Phone Plan", total: 1200, count: 6, firstPayment: "2026-03-20", weekendAdjustment: "No adjustment" });

    // --- every page, day 0 ------------------------------------------------
    await S.gotoPage(page, "Dashboard");
    const main = page.locator("main");
    await expect(main.getByText("+₱4,000.00")).toBeVisible(); // Period Summary: Total Income (Mar 15 + Mar 30)
    await expect(main.getByText("-₱3,016.19").first()).toBeVisible(); // Total Expenses (see header)
    await expect(main.getByText("+₱983.81")).toBeVisible(); // Net Flow 4,000 - 3,016.19
    await S.gotoPage(page, "Financial Calendar");
    await expect(main.getByText("Transactions").locator("xpath=following-sibling::p")).toContainText("0"); // 0 completed / 9
    await expect(main.getByText("/ 9")).toBeVisible(); // 2 payroll + rent + 3 groceries + loan + visa + phone
    await S.gotoPage(page, "Income Manager");
    await expect(main.getByText("₱4,000").first()).toBeVisible(); // 2 x 2,000 monthly recurring
    await S.gotoPage(page, "Expense Manager");
    await expect(main.getByText("Active Expenses").locator("xpath=following-sibling::p")).toHaveText("5");
    await S.gotoPage(page, "Transactions");
    await expect(main.getByText(/^Transactions \(\d+\)$/)).toBeVisible();
    await S.expectBalanceInvariant(page, { initial: INITIAL, expected: 10_000, completedCount: 0 });

    // --- day 2: Thu 2026-03-12, Rent due -> complete --------------------------
    // 10,000 - 1,200 = 8,800
    await S.moveClockAndLoad(page, "2026-03-12T12:00:00Z", "/calendar", "Financial Calendar");
    await S.openCalendarTxn(page, 12, "Rent");
    await S.completeInDialog(page);
    await S.expectBalanceInvariant(page, { initial: INITIAL, expected: 8_800, completedCount: 1 });

    // --- day 5: Sun 2026-03-15 -----------------------------------------------
    // skip Groceries (Mar 14): no money; complete Payroll +2,000 -> 10,800;
    // partially pay Car Loan 500 of 1,066.19 -> 10,300
    await S.moveClockAndLoad(page, "2026-03-15T12:00:00Z", "/calendar", "Financial Calendar");
    await S.openCalendarTxn(page, 14, "Groceries");
    await S.skipInDialog(page);
    await S.openCalendarTxn(page, 15, "Acme Payroll");
    await S.completeInDialog(page);
    await S.openCalendarTxn(page, 15, "Car Loan");
    await S.completeInDialog(page, 500);
    await S.expectBalanceInvariant(page, { initial: INITIAL, expected: 10_300, completedCount: 3 });
    const skipped = (await S.readTxns(page)).filter((t) => t.status === "skipped");
    expect(skipped.map((t) => `${t.name}@${t.scheduledDate}`)).toEqual(["Groceries@2026-03-14"]);

    // --- day 10: Fri 2026-03-20, Phone Plan 200 -> 10,100 -------------------------
    await S.moveClockAndLoad(page, "2026-03-20T12:00:00Z", "/calendar", "Financial Calendar");
    await S.openCalendarTxn(page, 20, "Phone Plan");
    await S.completeInDialog(page);
    await S.expectBalanceInvariant(page, { initial: INITIAL, expected: 10_100, completedCount: 4 });

    // --- day 15: Wed 2026-03-25, Groceries(21) 150 + Visa 100 -> 9,850 --------------
    await S.moveClockAndLoad(page, "2026-03-25T12:00:00Z", "/calendar", "Financial Calendar");
    await S.openCalendarTxn(page, 21, "Groceries");
    await S.completeInDialog(page);
    await S.openCalendarTxn(page, 25, "Visa");
    await S.completeInDialog(page);
    await S.expectBalanceInvariant(page, { initial: INITIAL, expected: 9_850, completedCount: 6 });

    // --- day 20: Mon 2026-03-30, Groceries(28) actual 120 (variance) -> 9,730; Payroll +2,000 -> 11,730
    await S.moveClockAndLoad(page, "2026-03-30T12:00:00Z", "/calendar", "Financial Calendar");
    await S.openCalendarTxn(page, 28, "Groceries");
    await S.completeInDialog(page, 120);
    await S.openCalendarTxn(page, 30, "Acme Payroll");
    await S.completeInDialog(page);
    const shown = await S.expectBalanceInvariant(page, { initial: INITIAL, expected: 11_730, completedCount: 8 });
    // exact text on the two screens that print cents: Dashboard and Settings
    expect(shown.dashboard).toBe("₱11,730.00");
    expect(shown.settings).toBe("₱11,730.00");
    expect(shown.settingsComputed).toBe("₱11,730.00");

    // Settings: no "mismatch" banner when the two agree
    await expect(page.getByText(/Balance mismatch detected/)).toHaveCount(0);
  });
});
