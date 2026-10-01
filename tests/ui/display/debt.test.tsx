import { describe, expect, it, vi } from "vitest";
import { makeCreditRule, makeInstallmentRule, makeLoanRule } from "../harness";
import { card, money, renderPages, within } from "./screens";

vi.setConfig({ testTimeout: 90_000 });

const TODAY = "2026-10-01";

// A 25,000 phone over 12 months: 2,083.33 x 12 = 24,999.96, so the last installment is 2,083.37.
const phone = () =>
  makeInstallmentRule(
    { id: "phone", name: "Phone", amount: 2_083.33, startDate: "2026-10-31" },
    { totalAmount: 25_000, installmentCount: 12, installmentAmount: 2_083.33, installmentsPaid: 0 }
  );

const seed = () => ({
  profile: { currentBalance: 50_000, initialBalance: 50_000 },
  expenseRules: [
    phone(),
    makeLoanRule({ id: "loan", name: "Car Loan" }, { principalAmount: 100_000, currentBalance: 100_000 }),
    makeCreditRule({ id: "card", name: "Visa" }, { currentBalance: 30_000 }),
  ],
});

describe("MANUAL-L1 / L6: Total Debt is exact and on one stated basis", () => {
  it("installment Remaining keeps the rounding residual (25,000, not 24,999.96)", async () => {
    const { app, page } = await renderPages(["expenses"], { today: TODAY, seed: seed() });
    const ex = page("expenses");
    await app.user.click(within(ex).getAllByText("Phone")[0]);
    const remaining = (await within(ex).findByText("Remaining")).nextElementSibling!;
    expect(remaining.textContent).toBe("$25,000.00");
  });

  it("Expenses and Forecast print the same Total Debt (principal + card + remaining installments) with the same basis note", async () => {
    const { page } = await renderPages(["expenses", "forecast"], { today: TODAY, seed: seed() });
    // hand: loan principal 100,000 + card 30,000 + installments 25,000 = 155,000
    expect(money(page("expenses"), "Total Debt")).toBe(155_000);
    expect(money(card(page("forecast"), "Total Debt"), "Total Debt")).toBe(155_000);
    for (const p of ["expenses", "forecast"] as const) {
      expect(page(p).textContent).toContain("Loan interest is not included");
    }
  });
});
