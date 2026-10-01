import { describe, expect, it, vi } from "vitest";
import { knownDefect, makeCreditRule, makeExpenseRule, makeIncomeSource } from "../harness";
import { H1_TODAY } from "./households";
import { card, money, renderPages, screen, stat, within } from "./screens";

// Load-tolerant: a cold first render can exceed the default 20s on a busy machine.
vi.setConfig({ testTimeout: 90_000 });

describe("Expense / Income manager totals vs the calendar's occurrence counts", () => {
  it("weekly 100 (Saturdays): the managers count this month's real occurrences, so they agree with the calendar", async () => {
    // REWRITTEN (occurrence counting; it pinned the 433 estimate against the calendar's real counts).
    // Saturdays from Mar 7. March 2026: 7, 14, 21, 28 -> 4 x 100 = 400 on the Dashboard, the
    // Expenses page AND the calendar's March. May 2026: 2, 9, 16, 23, 30 -> 5 x 100 = 500 (calendar).
    const { app, page } = await renderPages(["calendar", "dashboard", "expenses"], {
      today: H1_TODAY,
      timeZone: "UTC",
      seed: {
        profile: { currentBalance: 5_000, initialBalance: 5_000 },
        expenseRules: [
          makeExpenseRule({ id: "g", name: "Groceries", amount: 100, frequency: "weekly", startDate: "2026-03-07", scheduleConfig: { dayOfWeek: 6 } }),
        ],
      },
    });
    expect(money(card(page("dashboard"), "Recurring Summary"), "Monthly Expenses")).toBe(400);
    expect(money(page("expenses"), "Monthly Recurring")).toBe(400);
    const cal = page("calendar");
    expect(money(cal, "Expenses", { occurrence: 0 })).toBe(-400); // March on the calendar
    for (let i = 0; i < 2; i += 1) await app.user.click(within(cal).getByText("chevron_right").closest("button")!);
    expect(within(cal).getByText("May 2026")).toBeInTheDocument();
    expect(money(cal, "Expenses", { occurrence: 0 })).toBe(-500);
  });

  it("deactivating a rule from the list drops it from Active count, monthly recurring and priority count", async () => {
    const { app, page } = await renderPages(["expenses"], {
      today: H1_TODAY,
      seed: { expenseRules: [makeExpenseRule({ id: "r", name: "Rent", amount: 1_200, isPriority: true })] },
    });
    expect(stat(page("expenses"), "Active Expenses")).toBe("1");
    await app.user.click(within(page("expenses")).getAllByText("Rent")[0]);
    await app.user.click(await screen.findByRole("button", { name: /Deactivate/ }));
    await app.settle();
    expect(stat(page("expenses"), "Active Expenses")).toBe("0");
    expect(money(page("expenses"), "Monthly Recurring")).toBe(0);
    expect(stat(page("expenses"), "Priority Bills")).toBe("0");
  });

  it("income page: inactive source is badged and excluded from Monthly Recurring", async () => {
    const { page } = await renderPages(["income"], {
      today: H1_TODAY,
      seed: {
        incomeSources: [
          makeIncomeSource({ id: "a", name: "Salary", amount: 2_000 }),
          makeIncomeSource({ id: "b", name: "Old gig", amount: 900, isActive: false }),
        ],
      },
    });
    expect(stat(page("income"), "Active Sources")).toBe("1");
    expect(money(page("income"), "Monthly Recurring")).toBe(2_000);
    expect(within(page("income")).getByText("Inactive")).toBeInTheDocument();
  });

  it("UI-DISP-44 — a settled credit card (balance $0) is shown as 'Never (payment too low)' with infinite payments remaining",
    async () => {
      // observed: Time to Pay Off 'Never (payment too low)', Payments Remaining '∞', Total Interest 'Accumulating'.
      const { app, page } = await renderPages(["expenses"], {
        today: H1_TODAY,
        seed: { expenseRules: [makeCreditRule({ id: "c", name: "Old Visa", startDate: "2026-01-05" }, { currentBalance: 0 })] },
      });
      await app.user.click(within(page("expenses")).getByText("Old Visa"));
      const text = (await screen.findByText("Credit Card Overview")).closest(".rounded-2xl")!.parentElement!.textContent!;
      expect(text).toContain("Current Balance$0"); // precondition
      expect(text).not.toContain("Never (payment too low)");
      expect(text).not.toContain("∞");
    }
  );
});
