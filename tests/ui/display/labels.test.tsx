import { describe, expect, it, vi } from "vitest";
import { makeManualTransaction } from "../harness";
import type { AppSeed } from "../harness";
import { renderPages, screen, within, card } from "./screens";

vi.setConfig({ testTimeout: 90_000 });

const TODAY = "2026-03-20";

const manual = (
  id: string,
  type: "income" | "expense",
  amount: number,
  date: string,
  extra: Record<string, unknown> = {}
) =>
  makeManualTransaction({
    id,
    name: id,
    type,
    projectedAmount: amount,
    scheduledDate: date,
    status: "projected",
    ...extra,
  });

const dash = async (seed: AppSeed) => {
  const r = await renderPages(["dashboard"], { today: TODAY, seed });
  return { ...r, d: r.page("dashboard") };
};

describe("MANUAL-M5: the overdue dialog does not add unpaid bills to missed income", () => {
  it("shows overdue bills and unrecorded income as two separate totals", async () => {
    const { app, d } = await dash({
      profile: { currentBalance: 5_000, initialBalance: 5_000 },
      transactions: [
        manual("Rent", "expense", 13_000, "2026-03-10"),
        manual("Payday", "income", 20_000, "2026-03-15"),
      ],
    });
    await app.user.click(within(d).getByRole("button", { name: "Review" }));
    const dialog = await screen.findByRole("dialog");

    const bills = (await within(dialog).findByText("Overdue Bills")).parentElement!;
    const income = within(dialog).getByText("Income Not Yet Recorded").parentElement!;
    expect(bills.textContent).toContain("$13,000.00");
    expect(income.textContent).toContain("$20,000.00");
    // the sum of the two must be printed nowhere, and the old combined label is gone
    expect(dialog.textContent).not.toContain("33,000");
    expect(within(dialog).queryByText("Total Overdue")).toBeNull();
  });

  it("with only bills overdue there is no income total", async () => {
    const { app, d } = await dash({
      profile: { currentBalance: 5_000, initialBalance: 5_000 },
      transactions: [manual("Rent", "expense", 13_000, "2026-03-10")],
    });
    await app.user.click(within(d).getByRole("button", { name: "Review" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Overdue Bills")).toBeInTheDocument();
    expect(within(dialog).queryByText("Income Not Yet Recorded")).toBeNull();
  });
});

describe("MANUAL cosmetic: category codes read as labels", () => {
  it("the overdue dialog and the dashboard legend say 'Debt Payment', not the stored code", async () => {
    const { app, d } = await dash({
      profile: { currentBalance: 5_000, initialBalance: 5_000 },
      transactions: [
        manual("Car loan", "expense", 4_000, "2026-03-10", { category: "debt_payment" }),
        manual("Card", "expense", 900, "2026-03-12", { category: "Debt_payment" }),
      ],
    });
    // legend (the chart groups by stored code)
    const pie = card(d, /by Category/);
    expect(pie.textContent).toContain("Debt Payment");
    expect(pie.textContent).not.toMatch(/debt_payment/i);

    await app.user.click(within(d).getByRole("button", { name: "Review" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findAllByText("Debt Payment");
    expect(dialog.textContent).toContain("Debt Payment");
    expect(dialog.textContent).not.toMatch(/debt_payment/i);
  });
});
