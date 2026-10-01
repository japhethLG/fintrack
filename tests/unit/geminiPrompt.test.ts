import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCreditRule, makeExpenseRule, makeManualTransaction } from "../helpers/builders";
import { calculatePayoffSummary } from "@/lib/logic/creditCardCalculator";

/**
 * E2E-ROB-12: the prompt's "Upcoming (next 30 days)" list used to be the first 15 projected rows of whatever
 * list the page passed, so overdue rows were sent to the AI as upcoming. The real prompt is captured here by
 * replacing the Gemini SDK; "today" is frozen at 2026-03-10 (UTC), so the next 30 days are Mar 10 .. Apr 8 (30 days, today included: the one definition every
 * "next N days" window uses; MANUAL-L4).
 */

const sent: string[] = [];

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async ({ contents }: { contents: string }) => {
        sent.push(contents);
        return { text: "ok" };
      },
    };
  },
}));
vi.mock("@/lib/services/apiKeyService", () => ({
  getEffectiveApiKey: () => "test-key",
  isApiKeyConfigured: () => true,
  isProduction: () => false,
}));

const { analyzeBudget } = await import("@/lib/services/geminiService");

const projected = (id: string, name: string, scheduledDate: string, type: "income" | "expense" = "expense") =>
  makeManualTransaction({ id, name, scheduledDate, type, status: "projected", projectedAmount: 100 });

const prompt = async (transactions: ReturnType<typeof projected>[]) => {
  sent.length = 0;
  await analyzeBudget({
    transactions,
    incomeSources: [],
    expenseRules: [makeExpenseRule()],
    currentBalance: 1_000,
  });
  expect(sent).toHaveLength(1);
  return sent[0];
};

const section = (text: string, heading: string): string => {
  const start = text.indexOf(heading);
  if (start === -1) return "";
  const rest = text.slice(start + heading.length);
  const end = rest.search(/\n\n|\n## /);
  return end === -1 ? rest : rest.slice(0, end);
};

describe("the AI prompt's transaction lists", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("'Upcoming (next 30 days)' holds only rows due today and in the 29 days after it", async () => {
    // REWRITTEN (MANUAL-L4): the window was today..today+30 (31 days) while the Expense Manager's
    // "Next 30 days" was 30 days, so day 31 was in the prompt and not on the page.
    const text = await prompt([
      projected("o1", "Old Jan", "2026-01-05"),
      projected("o2", "Old Mar", "2026-03-09"), // yesterday: overdue
      projected("u1", "Due Today", "2026-03-10"),
      projected("u2", "Mid", "2026-03-25"),
      projected("u3", "Edge", "2026-04-08"), // today + 29 days: the 30th day, included
      projected("f1", "Far", "2026-04-09"), // today + 30 days: the 31st day, not in "next 30 days"
    ]);
    const upcoming = section(text, "Upcoming (next 30 days):");
    expect(upcoming).toContain("Due Today");
    expect(upcoming).toContain("Mid");
    expect(upcoming).toContain("Edge");
    expect(upcoming).not.toContain("Old Jan");
    expect(upcoming).not.toContain("Old Mar");
    expect(upcoming).not.toContain("Far");
  });

  it("overdue rows get their own labelled section, oldest first", async () => {
    const text = await prompt([
      projected("o2", "Old Mar", "2026-03-09"),
      projected("o1", "Old Jan", "2026-01-05"),
      projected("u1", "Due Today", "2026-03-10"),
    ]);
    const overdue = section(text, "Overdue (past due, still unpaid):");
    expect(overdue).toContain("Old Jan");
    expect(overdue).toContain("Old Mar");
    expect(overdue.indexOf("Old Jan")).toBeLessThan(overdue.indexOf("Old Mar"));
    expect(overdue).not.toContain("Due Today");
  });

  it("an overdue-only list sends no 'Upcoming' heading at all", async () => {
    const text = await prompt([projected("o1", "Old Jan", "2026-01-05")]);
    expect(text).not.toContain("Upcoming (next 30 days)");
    expect(text).toContain("Overdue (past due, still unpaid):");
  });

  it("takes the 15 NEAREST upcoming rows, not the first 15 in list order", async () => {
    // 20 rows due Mar 11..Mar 30 handed over in reverse order
    const rows = Array.from({ length: 20 }, (_, i) =>
      projected(`r${i}`, `Bill ${String(30 - i).padStart(2, "0")}`, `2026-03-${String(30 - i)}`)
    );
    const upcoming = section(await prompt(rows), "Upcoming (next 30 days):");
    const listed = upcoming.match(/Bill \d\d/g) ?? [];
    expect(listed).toHaveLength(15);
    // nearest 15 of Mar 11..Mar 30 are Mar 11..Mar 25
    expect(listed[0]).toBe("Bill 11");
    expect(listed[14]).toBe("Bill 25");
  });
});

describe("the AI prompt flags the credit-card minimum-payment trap (MANUAL-j)", () => {
  const promptFor = async (rules: ReturnType<typeof makeCreditRule>[]) => {
    sent.length = 0;
    await analyzeBudget({ transactions: [], incomeSources: [], expenseRules: rules, currentBalance: 1_000 });
    return sent[0];
  };

  it("a card whose payment barely covers its interest carries a WARNING line with the numbers", async () => {
    // 5,000 at 24% APR: interest 100.00 a month; the 2% minimum is also 100.00
    const trap = makeCreditRule({ id: "trap", name: "Trap Card" });
    expect(calculatePayoffSummary(trap.creditConfig!).isMinimumPaymentTrap).toBe(true); // the app's own detection
    const text = await promptFor([trap]);
    expect(text).toContain("Trap Card");
    expect(text).toContain("minimum-payment trap");
    expect(text).toMatch(/payment of \D?100\.00 barely covers the monthly interest of \D?100\.00/);
    expect(text).toContain("never be paid off");
  });

  it("a card paid down properly gets no warning", async () => {
    const fine = makeCreditRule(
      { id: "fine", name: "Fine Card" },
      { paymentStrategy: "fixed", fixedPaymentAmount: 1_000 }
    );
    expect(calculatePayoffSummary(fine.creditConfig!).isMinimumPaymentTrap).toBe(false);
    expect(await promptFor([fine])).not.toContain("minimum-payment trap");
  });
});
