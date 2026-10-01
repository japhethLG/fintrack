import { describe, expect, it, vi } from "vitest";
import { consoleCalls, makeExpenseRule } from "../harness";
import { card, colorToken, renderPages, yAxisLabels } from "./screens";
import { within } from "../harness";

vi.setConfig({ testTimeout: 90_000 });

const TODAY = "2026-10-01";

describe("MANUAL cosmetic: empty and flat charts", () => {
  it("an empty account's cash-flow chart does not print a 0..4 axis", async () => {
    const { page } = await renderPages(["dashboard"], {
      today: TODAY,
      seed: { profile: { currentBalance: 0, initialBalance: 0 } },
    });
    const labels = yAxisLabels(card(page("dashboard"), /Projected Cash Flow/));
    expect(labels.length).toBeGreaterThan(2); // precondition: the axis is drawn
    // it used to be $0, $1, $2, $3, $4
    expect(labels).not.toContain("$4");
    expect(labels).not.toContain("$1");
    expect(labels).toContain("$0");
    expect(labels).toContain("$1k");
  });

  it("Recharts does not log the width(-1) / height(-1) warning on first render", async () => {
    await renderPages(["dashboard"], {
      today: TODAY,
      seed: {
        profile: { currentBalance: 1_000, initialBalance: 1_000 },
        expenseRules: [makeExpenseRule({ id: "rent", name: "Rent", amount: 400, startDate: "2026-10-05" })],
      },
    });
    const sizeWarnings = consoleCalls().filter((c) => /width\(-1\) and height\(-1\)/.test(c.message));
    expect(sizeWarnings).toEqual([]);
  });
});

describe("MANUAL cosmetic: zero is neutral, never red", () => {
  const kpiValue = (root: HTMLElement, label: string) =>
    within(card(root, "Period Summary")).getByText(label).parentElement!.nextElementSibling as HTMLElement;

  it("Total Expenses of $0.00 is not danger-coloured; a real expense still is", async () => {
    const { page } = await renderPages(["dashboard", "expenses"], {
      today: TODAY,
      seed: { profile: { currentBalance: 1_000, initialBalance: 1_000 } },
    });
    const expenses = kpiValue(page("dashboard"), "Total Expenses");
    expect(expenses.textContent).toBe("$0.00"); // precondition: it really is zero
    expect(colorToken(expenses)).toBe("gray-400");
    // Total Debt and Monthly Recurring on the Expenses page are zero too
    const debt = within(page("expenses")).getByText("Total Debt").nextElementSibling as HTMLElement;
    expect(debt.textContent).toBe("$0.00");
    expect(colorToken(debt)).toBe("gray-400");
  });

  it("with a bill in the period the expense figure is danger-coloured", async () => {
    const { page } = await renderPages(["dashboard"], {
      today: TODAY,
      seed: {
        profile: { currentBalance: 1_000, initialBalance: 1_000 },
        expenseRules: [makeExpenseRule({ id: "rent", name: "Rent", amount: 400, startDate: "2026-10-05" })],
      },
    });
    const expenses = kpiValue(page("dashboard"), "Total Expenses");
    expect(expenses.textContent).toBe("-$400.00");
    expect(colorToken(expenses)).toBe("danger");
  });
});
