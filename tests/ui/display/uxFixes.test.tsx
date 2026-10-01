import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "@testing-library/react";
import { makeManualTransaction, renderApp, screen, within } from "../harness";

vi.setConfig({ testTimeout: 90_000 });

const TODAY = "2026-10-01";

describe("MANUAL-k: paying early records today, not the scheduled day", () => {
  const open = async (scheduledDate: string) => {
    const t = makeManualTransaction({
      id: "t1",
      name: "Car insurance",
      type: "expense",
      projectedAmount: 4_500,
      scheduledDate,
      status: "projected",
    });
    const app = await renderApp({ ui: <div />, today: TODAY, seed: { transactions: [t] } });
    await act(async () => {
      app.openModal("TransactionModal", { transaction: t });
    });
    const dialog = await screen.findByRole("dialog");
    return { app, dialog };
  };

  it("a bill due Oct 15 opens with Actual Date = Oct 1 (today)", async () => {
    const { dialog } = await open("2026-10-15");
    const input = (await within(dialog).findByLabelText(/Actual Date/)) as HTMLInputElement;
    expect(input.value).toBe("2026-10-01");
  });

  it("an overdue bill (Sep 20) keeps its scheduled date", async () => {
    const { dialog } = await open("2026-09-20");
    const input = (await within(dialog).findByLabelText(/Actual Date/)) as HTMLInputElement;
    expect(input.value).toBe("2026-09-20");
  });
});

describe("MANUAL cosmetic: the reset dialog uses human labels", () => {
  it("shows no internal names such as 'Type: income_sources'", async () => {
    const app = await renderApp({ route: "/settings", today: TODAY });
    await app.user.click(screen.getByRole("button", { name: "Selective Reset" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Income Sources");
    expect(dialog.textContent).not.toMatch(/Type:/);
    expect(dialog.textContent).not.toMatch(/income_sources|expense_rules|balance_history/);
    // the human labels are still there
    for (const label of ["All Financial Data", "Expense Rules", "Balance History", "Alerts"]) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
  });
});
