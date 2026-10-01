import { describe, expect, it, vi } from "vitest";
import { makeManualTransaction } from "../harness";
import { buildAnalysisPrompt } from "@/lib/services/analysisPrompt";
import { renderPages, within } from "./screens";

vi.setConfig({ testTimeout: 90_000 });

const TODAY = "2026-10-01";

const bill = (name: string, date: string) =>
  makeManualTransaction({
    id: name,
    name,
    type: "expense",
    category: "other",
    projectedAmount: 100,
    scheduledDate: date,
    status: "projected",
  });

describe("MANUAL-L4: 'Next 30 days' is one window everywhere", () => {
  it("the Expense Manager and the AI prompt agree: Oct 1 .. Oct 30, not Oct 31", async () => {
    const rows = [bill("Day 30 bill", "2026-10-30"), bill("Day 31 bill", "2026-10-31")];
    const { page } = await renderPages(["expenses"], {
      today: TODAY,
      seed: { profile: { currentBalance: 10_000, initialBalance: 10_000 }, transactions: rows },
    });
    const widget = within(page("expenses"));
    // the Expense Manager's widget defaults to "Next 30 days"
    expect(widget.getByText("Day 30 bill")).toBeInTheDocument();
    expect(widget.queryByText("Day 31 bill")).toBeNull();

    // the AI prompt (same rows, same clock) lists exactly the same rows
    const prompt = buildAnalysisPrompt({
      transactions: rows,
      incomeSources: [],
      expenseRules: [],
      currentBalance: 10_000,
    });
    const upcoming = prompt.slice(prompt.indexOf("Upcoming (next 30 days):"));
    expect(upcoming).toContain("Day 30 bill");
    expect(upcoming).not.toContain("Day 31 bill");
  });
});
