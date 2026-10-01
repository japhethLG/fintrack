import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeExpenseRule, makeManualTransaction } from "../helpers/builders";

/**
 * E2E-ROB-12: the prompt's "Upcoming (next 30 days)" list used to be the first 15 projected rows of whatever
 * list the page passed, so overdue rows were sent to the AI as upcoming. The real prompt is captured here by
 * replacing the Gemini SDK; "today" is frozen at 2026-03-10 (UTC), so the next 30 days are Mar 10 .. Apr 9.
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

  it("'Upcoming (next 30 days)' holds only rows due from today to today + 30 days", async () => {
    const text = await prompt([
      projected("o1", "Old Jan", "2026-01-05"),
      projected("o2", "Old Mar", "2026-03-09"), // yesterday: overdue
      projected("u1", "Due Today", "2026-03-10"),
      projected("u2", "Mid", "2026-03-25"),
      projected("u3", "Edge", "2026-04-09"), // today + 30 days: included
      projected("f1", "Far", "2026-04-10"), // beyond the window
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
