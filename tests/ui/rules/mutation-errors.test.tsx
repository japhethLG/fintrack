import { describe, expect, it } from "vitest";
import { renderApp, screen, waitFor, makeExpenseRule, makeIncomeSource } from "../harness";

/**
 * E2E-ROB-04: a rejected delete or deactivate of a rule used to be an unhandled promise rejection: no message,
 * and the "Yes, Delete" confirmation stayed on screen. Now the user is told, the confirmation resolves and
 * the rule is untouched.
 */

const REJECTED = "Write rejected by the server";

describe("expense rules", () => {
  const seed = () => ({
    expenseRules: [makeExpenseRule({ id: "r1", name: "Gym", amount: 40, startDate: "2026-01-20" })],
  });

  it("a rejected delete shows the error, resolves the confirmation and keeps the rule", async () => {
    const app = await renderApp({ route: "/expenses", today: "2026-01-15", seed: seed() });
    await app.user.click(screen.getAllByText("Gym")[0]);
    await app.user.click(await screen.findByRole("button", { name: /Delete/ }));
    app.store.__injectFault({ collection: "expense_rules", error: new Error(REJECTED) });
    await app.user.click(screen.getByRole("button", { name: "Yes, Delete" }));

    expect(await screen.findByText(REJECTED)).toBeInTheDocument();
    // the confirmation resolved: no "Are you sure?" left, the Delete button is back
    expect(screen.queryByRole("button", { name: "Yes, Delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete/ })).toBeInTheDocument();
    // nothing was deleted
    expect(app.store.__all("expense_rules")).toHaveLength(1);
    expect(app.financial().expenseRules.map((r) => r.id)).toEqual(["r1"]);
  }, 30_000);

  it("a rejected deactivate shows the error and the rule stays active", async () => {
    const app = await renderApp({ route: "/expenses", today: "2026-01-15", seed: seed() });
    await app.user.click(screen.getAllByText("Gym")[0]);
    const toggle = await screen.findByRole("button", { name: /Deactivate/ });
    app.store.__injectFault({ collection: "expense_rules", error: new Error(REJECTED) });
    await app.user.click(toggle);

    expect(await screen.findByText(REJECTED)).toBeInTheDocument();
    expect(app.store.__get<{ isActive: boolean }>("expense_rules", "r1")?.isActive).toBe(true);
    expect(screen.getByRole("button", { name: /Deactivate/ })).toBeInTheDocument();
  }, 30_000);

  it("a delete that works still removes the rule and shows no error", async () => {
    const app = await renderApp({ route: "/expenses", today: "2026-01-15", seed: seed() });
    await app.user.click(screen.getAllByText("Gym")[0]);
    await app.user.click(await screen.findByRole("button", { name: /Delete/ }));
    await app.user.click(screen.getByRole("button", { name: "Yes, Delete" }));
    await waitFor(() => expect(app.store.__all("expense_rules")).toHaveLength(0));
    expect(screen.queryByText(REJECTED)).not.toBeInTheDocument();
  }, 30_000);

  it("the error clears once the next action succeeds", async () => {
    const app = await renderApp({ route: "/expenses", today: "2026-01-15", seed: seed() });
    await app.user.click(screen.getAllByText("Gym")[0]);
    app.store.__injectFault({ collection: "expense_rules", error: new Error(REJECTED) });
    await app.user.click(await screen.findByRole("button", { name: /Deactivate/ }));
    expect(await screen.findByText(REJECTED)).toBeInTheDocument();
    await app.user.click(screen.getByRole("button", { name: /Deactivate/ })); // fault used up: succeeds
    await waitFor(() => expect(app.store.__get<{ isActive: boolean }>("expense_rules", "r1")?.isActive).toBe(false));
    await waitFor(() => expect(screen.queryByText(REJECTED)).not.toBeInTheDocument());
  }, 30_000);
});

describe("income sources", () => {
  const seed = () => ({
    incomeSources: [makeIncomeSource({ id: "s1", name: "Side Gig", amount: 300, startDate: "2026-01-20" })],
  });

  it("a rejected delete shows the error, resolves the confirmation and keeps the source", async () => {
    const app = await renderApp({ route: "/income", today: "2026-01-15", seed: seed() });
    await app.user.click(screen.getAllByText("Side Gig")[0]);
    await app.user.click(await screen.findByRole("button", { name: /Delete/ }));
    app.store.__injectFault({ collection: "income_sources", error: new Error(REJECTED) });
    await app.user.click(screen.getByRole("button", { name: "Yes, Delete" }));

    expect(await screen.findByText(REJECTED)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes, Delete" })).not.toBeInTheDocument();
    expect(app.store.__all("income_sources")).toHaveLength(1);
  }, 30_000);

  it("a rejected deactivate shows the error and the source stays active", async () => {
    const app = await renderApp({ route: "/income", today: "2026-01-15", seed: seed() });
    await app.user.click(screen.getAllByText("Side Gig")[0]);
    const toggle = await screen.findByRole("button", { name: /Deactivate/ });
    app.store.__injectFault({ collection: "income_sources", error: new Error(REJECTED) });
    await app.user.click(toggle);

    expect(await screen.findByText(REJECTED)).toBeInTheDocument();
    expect(app.store.__get<{ isActive: boolean }>("income_sources", "s1")?.isActive).toBe(true);
  }, 30_000);
});
