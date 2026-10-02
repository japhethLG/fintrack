import { describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import {
  renderApp,
  screen,
  within,
  makeCreditRule,
  makeExpenseRule,
  makeInstallmentRule,
  makeLoanRule,
  spacedText,
} from "../harness";
import * as d from "./driver";

vi.setConfig({ testTimeout: 90_000 });

/**
 * Decision 2026-10-02: a loan / credit card / installment payment is owed, so the transaction dialog offers
 * no Skip for it (it is moved, or left unpaid and shown as overdue); income and ordinary bills keep Skip.
 * And the weekend defaults stay different, each explained under its field.
 */

const TODAY = "2026-01-15";
const HINT = /Can't pay on this date\? Drag it to the day you'll pay/;

const openDialogFor = async (rule: ReturnType<typeof makeExpenseRule>) => {
  const app = await renderApp({ route: "/calendar", today: TODAY, seed: { expenseRules: [rule] } });
  const txn = app.financial().transactions.find((t) => t.sourceId === rule.id && t.status === "projected")!;
  await act(async () => {
    app.openModal("TransactionModal", { transaction: txn });
  });
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByRole("button", { name: /Mark Complete/ });
  return dialog;
};
const hasSkip = (dialog: HTMLElement) =>
  within(dialog).queryAllByRole("button").some((b) => /(^|\s)Skip$/.test(spacedText(b)));

describe("the transaction dialog", () => {
  it.each([
    ["loan", makeLoanRule({ id: "loan-1", startDate: "2026-01-20" })],
    ["credit card", makeCreditRule({ id: "card-1", startDate: "2026-01-01" })],
    ["installment", makeInstallmentRule({ id: "inst-1", startDate: "2026-01-20" })],
  ])("a %s payment offers no Skip, and says how to handle a payment you can't make", async (_kind, rule) => {
    const dialog = await openDialogFor(rule);
    expect(hasSkip(dialog)).toBe(false);
    expect(within(dialog).getByText(HINT)).toBeInTheDocument();
  });

  it("an ordinary bill still offers Skip, with no debt hint", async () => {
    const dialog = await openDialogFor(makeExpenseRule({ id: "gym", name: "Gym", startDate: "2026-01-20" }));
    expect(hasSkip(dialog)).toBe(true);
    expect(within(dialog).queryByText(HINT)).toBeNull();
  });
});

describe("weekend defaults are explained under the field", () => {
  it("income: starts on 'Pay on Friday if weekend', and says why", async () => {
    const app = await renderApp({ route: "/income", today: TODAY });
    await d.fillIncomeToSchedule(app, { frequency: "Monthly" });
    expect(screen.getByText(/Income starts on "Pay on Friday if weekend"/)).toBeInTheDocument();
  });

  it("expenses: start on 'No adjustment', and say what that means", async () => {
    const app = await renderApp({ route: "/expenses", today: TODAY });
    await d.fillExpenseToSchedule(app, { frequency: "Monthly" });
    expect(screen.getByText(/Bills start on "No adjustment": a payment is shown on its due date/)).toBeInTheDocument();
  });
});
