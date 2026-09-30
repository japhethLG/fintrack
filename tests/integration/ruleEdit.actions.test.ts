import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => import("../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../helpers/firebaseConfigMock"));

import type { ExpenseRule, ExpenseRuleFormData, IncomeSource, IncomeSourceFormData } from "@/lib/types";
import {
  buildExpenseRuleUpdate,
  editExpenseRuleAction,
  editIncomeSourceAction,
} from "@/contexts/FinancialContext/actions/sourceActions";
import * as store from "../helpers/firestoreEmulator";
import {
  makeCreditRule,
  makeExpenseRule,
  makeIncomeSource,
  makeInstallmentRule,
  makeLoanRule,
} from "../helpers/builders";

/**
 * THEME: editing a stored income source / expense rule must not destroy data.
 *
 * The edit wizard sends the WHOLE form. Expected documents are written by hand from what the user did
 * (renamed a loan, cleared a note, un-ticked "Set End Date") and compared to what the emulator stores.
 */

const USER = "user-1";

const storedRule = (id: string) => store.__get<ExpenseRule>("expense_rules", id)!;
const storedSource = (id: string) => store.__get<IncomeSource>("income_sources", id)!;

/** What the edit wizard sends for `rule` when nothing but the name changed (the fields it manages). */
const renameOnly = (rule: ExpenseRule, name: string): ExpenseRuleFormData => ({
  name,
  expenseType: rule.expenseType,
  category: rule.category,
  amount: rule.amount,
  isVariableAmount: rule.isVariableAmount,
  frequency: rule.frequency,
  startDate: rule.startDate,
  endDate: rule.endDate,
  scheduleConfig: rule.scheduleConfig,
  weekendAdjustment: rule.weekendAdjustment,
  notes: rule.notes,
  isPriority: rule.isPriority,
  isActive: true, // the wizard always sends true; the action must not apply it
  ...(rule.loanConfig ? { loanConfig: { ...rule.loanConfig, paymentsMade: 0 } } : {}),
  ...(rule.creditConfig ? { creditConfig: { ...rule.creditConfig } } : {}),
  ...(rule.installmentConfig ? { installmentConfig: { ...rule.installmentConfig, installmentsPaid: 0 } } : {}),
});

describe("editIncomeSourceAction", () => {
  beforeEach(() => {
    store.__seedEntities("income_sources", [
      makeIncomeSource({
        id: "s1",
        userId: USER,
        name: "Payroll",
        notes: "old note",
        endDate: "2026-03-01",
        isActive: false,
        color: "#123456",
      }),
    ]);
  });

  const form = (over: Partial<IncomeSourceFormData>): IncomeSourceFormData => ({
    name: "Payroll",
    sourceType: "salary",
    amount: 100,
    isVariableAmount: false,
    frequency: "monthly",
    startDate: "2026-01-10",
    scheduleConfig: { dayOfMonth: 10 },
    weekendAdjustment: "none",
    category: "Salary",
    color: "#123456",
    isActive: true,
    ...over,
  });

  it("a present-but-undefined endDate and notes REMOVE the stored values", async () => {
    await editIncomeSourceAction("s1", form({ endDate: undefined, notes: undefined }));
    const stored = storedSource("s1");
    expect(stored).not.toHaveProperty("endDate");
    expect(stored).not.toHaveProperty("notes");
    expect(stored.amount).toBe(100);
  });

  it("keys that are not in the payload are left alone", async () => {
    const { endDate, notes, ...without } = form({});
    void endDate;
    void notes;
    await editIncomeSourceAction("s1", without);
    expect(storedSource("s1").endDate).toBe("2026-03-01");
    expect(storedSource("s1").notes).toBe("old note");
  });

  it("an edit never changes activation: a deactivated source stays deactivated", async () => {
    await editIncomeSourceAction("s1", form({ name: "Payroll 2", isActive: true }));
    expect(storedSource("s1")).toMatchObject({ name: "Payroll 2", isActive: false });
  });
});

describe("editExpenseRuleAction", () => {
  it("renaming a loan keeps paymentsMade (5), the balance and every config field", async () => {
    const loan = makeLoanRule(
      { id: "l1", userId: USER, name: "Car Loan", amount: 564.88, startDate: "2026-02-10", scheduleConfig: { dayOfMonth: 10 } },
      { currentBalance: 9_000, paymentsMade: 5, termMonths: 24, monthlyPayment: 564.88 }
    );
    store.__seedEntities("expense_rules", [loan]);

    await editExpenseRuleAction("l1", renameOnly(loan, "Car Loan (renamed)"));

    const stored = storedRule("l1");
    expect(stored.name).toBe("Car Loan (renamed)");
    expect(stored.loanConfig).toEqual({ ...loan.loanConfig, paymentsMade: 5 });
  });

  it("renaming an installment plan keeps installmentsPaid (3)", async () => {
    const plan = makeInstallmentRule(
      { id: "i1", userId: USER, name: "Laptop", amount: 200 },
      { totalAmount: 1200, installmentCount: 6, installmentAmount: 200, installmentsPaid: 3 }
    );
    store.__seedEntities("expense_rules", [plan]);

    await editExpenseRuleAction("i1", renameOnly(plan, "Laptop (renamed)"));

    expect(storedRule("i1").installmentConfig).toEqual({ ...plan.installmentConfig, installmentsPaid: 3 });
  });

  it("config fields the form does not send survive (merged over the stored config)", async () => {
    const loan = makeLoanRule({ id: "l2", userId: USER }, { paymentsMade: 2, firstPaymentDate: "2026-02-10" });
    store.__seedEntities("expense_rules", [loan]);
    const payload = renameOnly(loan, "Renamed");
    // a form that omits firstPaymentDate and paymentsMade entirely
    const { firstPaymentDate, paymentsMade, ...partial } = payload.loanConfig!;
    void firstPaymentDate;
    void paymentsMade;
    await editExpenseRuleAction("l2", { ...payload, loanConfig: partial as never });

    expect(storedRule("l2").loanConfig).toMatchObject({ firstPaymentDate: "2026-02-10", paymentsMade: 2 });
  });

  it("an edit never reactivates a deactivated rule", async () => {
    const rule = makeExpenseRule({ id: "r1", userId: USER, name: "Old Sub", isActive: false });
    store.__seedEntities("expense_rules", [rule]);
    await editExpenseRuleAction("r1", renameOnly(rule, "Old Sub 2"));
    expect(storedRule("r1")).toMatchObject({ name: "Old Sub 2", isActive: false });
  });

  it("clearing the end date and the notes removes them; occurrence overrides and unmanaged fields are untouched", async () => {
    const rule = makeExpenseRule({
      id: "r2",
      userId: USER,
      name: "Gym",
      notes: "old",
      endDate: "2026-03-01",
      color: "#abcdef",
      occurrenceOverrides: { "r2_2026-02": { amount: 70 } },
    });
    store.__seedEntities("expense_rules", [rule]);

    await editExpenseRuleAction("r2", { ...renameOnly(rule, "Gym"), endDate: undefined, notes: undefined });

    const stored = storedRule("r2");
    expect(stored).not.toHaveProperty("endDate");
    expect(stored).not.toHaveProperty("notes");
    expect(stored.color).toBe("#abcdef");
    expect(stored.occurrenceOverrides).toEqual({ "r2_2026-02": { amount: 70 } });
  });

  it("a credit card that stops using a fixed payment loses the stale fixedPaymentAmount", async () => {
    const card = makeCreditRule(
      { id: "c1", userId: USER },
      { paymentStrategy: "fixed", fixedPaymentAmount: 300 }
    );
    store.__seedEntities("expense_rules", [card]);
    const payload = renameOnly(card, "Card");
    const { fixedPaymentAmount, ...noFixed } = payload.creditConfig!;
    void fixedPaymentAmount;
    await editExpenseRuleAction("c1", { ...payload, creditConfig: { ...noFixed, paymentStrategy: "minimum" } });
    expect(storedRule("c1").creditConfig).not.toHaveProperty("fixedPaymentAmount");
    expect(storedRule("c1").creditConfig?.paymentStrategy).toBe("minimum");
  });

  it("changing a loan into a fixed expense drops the loan config so it is not projected as a loan", async () => {
    const loan = makeLoanRule({ id: "l3", userId: USER }, { paymentsMade: 1 });
    store.__seedEntities("expense_rules", [loan]);
    await editExpenseRuleAction("l3", {
      ...renameOnly(loan, "Now fixed"),
      expenseType: "fixed",
      loanConfig: undefined,
    });
    expect(storedRule("l3").expenseType).toBe("fixed");
    expect(storedRule("l3")).not.toHaveProperty("loanConfig");
  });
});

describe("buildExpenseRuleUpdate (pure)", () => {
  it("takes progress from the stored rule even if the form carried a stale value", () => {
    const stored = makeLoanRule({ id: "x" }, { paymentsMade: 7 });
    const update = buildExpenseRuleUpdate(stored, {
      loanConfig: { ...stored.loanConfig!, paymentsMade: 0 },
    });
    expect((update.loanConfig as { paymentsMade: number }).paymentsMade).toBe(7);
  });

  it("uses the form's progress for a rule that has none stored (a type change into a loan)", () => {
    const update = buildExpenseRuleUpdate(makeExpenseRule({ id: "y" }), {
      loanConfig: { ...makeLoanRule({ id: "z" }).loanConfig!, paymentsMade: 0 },
    });
    expect((update.loanConfig as { paymentsMade: number }).paymentsMade).toBe(0);
  });
});
