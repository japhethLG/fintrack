import { describe, expect, it } from "vitest";
import {
  describeDataIssues,
  sanitizeExpenseRules,
  sanitizeIncomeSources,
  sanitizeTransactions,
} from "@/lib/utils/sanitizeData";
import {
  makeExpenseRule,
  makeIncomeSource,
  makeLoanRule,
  makeManualTransaction,
} from "../helpers/builders";

/**
 * Ingestion guard for hostile / legacy documents (E2E-ROB-09/10).
 *
 * Policy under test: a record whose money field is null, NaN, missing or non-numeric is NOT dropped
 * silently and never reaches a calculator as NaN. It is kept (so the user can find, fix or delete it),
 * its bad numbers become 0, rules and sources are set inactive (so they project nothing), and the
 * record is reported as an issue for the "N items have invalid data" notice.
 * A numeric string such as "12.50" is a legacy way of storing a number and is coerced, not reported.
 */

const bad = (v: unknown) => v as never;

describe("sanitizeIncomeSources", () => {
  it("leaves valid sources untouched (same object) and reports nothing", () => {
    const a = makeIncomeSource({ id: "a", amount: 3000 });
    const { items, issues } = sanitizeIncomeSources([a]);
    expect(items).toEqual([a]);
    expect(items[0]).toBe(a);
    expect(issues).toEqual([]);
  });

  it.each([
    ["null", null],
    ["NaN", NaN],
    ["a non-numeric string", "abc"],
    ["an empty string", ""],
    ["undefined", undefined],
    ["Infinity", Infinity],
    ["an object", {}],
  ])("a source whose amount is %s becomes amount 0, inactive, and is reported", (_n, amount) => {
    const { items, issues } = sanitizeIncomeSources([
      makeIncomeSource({ id: "a", name: "Payroll", amount: bad(amount) }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].amount).toBe(0);
    expect(items[0].isActive).toBe(false);
    expect(issues).toEqual([{ kind: "income_source", id: "a", name: "Payroll", fields: ["amount"] }]);
  });

  it("coerces a numeric string without reporting it", () => {
    const { items, issues } = sanitizeIncomeSources([makeIncomeSource({ id: "a", amount: bad("1250.50") })]);
    expect(items[0].amount).toBe(1250.5);
    expect(items[0].isActive).toBe(true);
    expect(issues).toEqual([]);
  });

  it("drops a NaN occurrence-override amount and reports the field", () => {
    const { items, issues } = sanitizeIncomeSources([
      makeIncomeSource({
        id: "a",
        name: "Payroll",
        occurrenceOverrides: { "a_2026-01": { amount: bad("x"), notes: "keep" } },
      }),
    ]);
    expect(items[0].occurrenceOverrides?.["a_2026-01"]).toEqual({ notes: "keep" });
    expect(items[0].isActive).toBe(true); // the rule itself is sound
    expect(issues).toEqual([
      { kind: "income_source", id: "a", name: "Payroll", fields: ["occurrenceOverrides.a_2026-01.amount"] },
    ]);
  });

  it("does not mutate its input", () => {
    const input = makeIncomeSource({ id: "a", amount: bad(null) });
    sanitizeIncomeSources([input]);
    expect(input.amount).toBeNull();
    expect(input.isActive).toBe(true);
  });
});

describe("sanitizeExpenseRules", () => {
  it("leaves valid rules untouched", () => {
    const a = makeExpenseRule({ id: "a", amount: 100 });
    const l = makeLoanRule({ id: "l" });
    const { items, issues } = sanitizeExpenseRules([a, l]);
    expect(items[0]).toBe(a);
    expect(items[1]).toBe(l);
    expect(issues).toEqual([]);
  });

  it("a rule with a null amount becomes 0 and inactive, reported once", () => {
    const { items, issues } = sanitizeExpenseRules([
      makeExpenseRule({ id: "e1", name: "NullAmt", amount: bad(null) }),
      makeExpenseRule({ id: "e2", name: "StrAmt", amount: bad("abc") }),
    ]);
    expect(items.map((r) => [r.amount, r.isActive])).toEqual([
      [0, false],
      [0, false],
    ]);
    expect(issues.map((i) => [i.id, i.name, i.fields])).toEqual([
      ["e1", "NullAmt", ["amount"]],
      ["e2", "StrAmt", ["amount"]],
    ]);
  });

  it("a loan with a NaN principal is zeroed in that field and deactivated; absent optional fields are not issues", () => {
    const loan = makeLoanRule({ id: "l", name: "Car" });
    const broken = {
      ...loan,
      loanConfig: { ...loan.loanConfig!, principalAmount: NaN, currentBalance: bad("n/a") },
    };
    const { items, issues } = sanitizeExpenseRules([broken]);
    expect(items[0].loanConfig?.principalAmount).toBe(0);
    expect(items[0].loanConfig?.currentBalance).toBe(0);
    expect(items[0].isActive).toBe(false);
    expect(issues).toEqual([
      {
        kind: "expense_rule",
        id: "l",
        name: "Car",
        fields: ["loanConfig.principalAmount", "loanConfig.currentBalance"],
      },
    ]);
    // a legacy loan that simply lacks an optional counter is fine
    const legacy = { ...loan, loanConfig: { ...loan.loanConfig!, paymentsMade: undefined as never } };
    expect(sanitizeExpenseRules([legacy]).issues).toEqual([]);
  });
});

describe("sanitizeTransactions", () => {
  it("leaves valid rows untouched", () => {
    const t = makeManualTransaction({ id: "t", projectedAmount: 50 });
    const { items, issues } = sanitizeTransactions([t]);
    expect(items[0]).toBe(t);
    expect(issues).toEqual([]);
  });

  it("a row with a bad projectedAmount becomes 0 and is reported; its status is kept", () => {
    const { items, issues } = sanitizeTransactions([
      makeManualTransaction({ id: "t", name: "Odd", status: "completed", projectedAmount: bad(null) }),
    ]);
    expect(items[0].projectedAmount).toBe(0);
    expect(items[0].status).toBe("completed");
    expect(issues).toEqual([{ kind: "transaction", id: "t", name: "Odd", fields: ["projectedAmount"] }]);
  });

  it("a bad actualAmount or variance is removed (a null means 'no value' and is not reported)", () => {
    const { items, issues } = sanitizeTransactions([
      makeManualTransaction({ id: "a", status: "completed", projectedAmount: 10, actualAmount: bad(NaN), variance: bad("x") }),
      makeManualTransaction({ id: "b", status: "completed", projectedAmount: 10, actualAmount: bad(null) }),
    ]);
    expect(items[0].actualAmount).toBeUndefined();
    expect(items[0].variance).toBeUndefined();
    expect(items[1].actualAmount).toBeUndefined();
    expect(issues.map((i) => [i.id, i.fields])).toEqual([["a", ["actualAmount", "variance"]]]);
  });
});

describe("describeDataIssues", () => {
  it("is empty for no issues", () => {
    expect(describeDataIssues([])).toBeNull();
  });

  it("counts items, singular and plural, and names a few", () => {
    const one = describeDataIssues([{ kind: "expense_rule", id: "1", name: "Rent", fields: ["amount"] }]);
    expect(one?.title).toBe("1 item has invalid data");
    expect(one?.names).toEqual(["Rent"]);
    const many = describeDataIssues(
      ["A", "B", "C", "D", "E"].map((name, i) => ({ kind: "transaction" as const, id: String(i), name, fields: ["projectedAmount"] }))
    );
    expect(many?.title).toBe("5 items have invalid data");
    expect(many?.names).toEqual(["A", "B", "C"]);
    expect(many?.more).toBe(2);
  });
});
