import { describe, it, expect } from "vitest";
import type { Transaction } from "@/lib/types";
import { createProjectedTransaction } from "@/lib/logic/projectionEngine/transactionFactory";
import { generateIncomeProjections } from "@/lib/logic/projectionEngine/incomeProjections";
import { generateExpenseProjections } from "@/lib/logic/projectionEngine/expenseProjections";
import {
  cents,
  makeCreditRule,
  makeExpenseRule,
  makeIncomeSource,
  makeInstallmentRule,
  makeLoanRule,
  makeOverride,
  makePaymentBreakdown,
} from "../../helpers/builders";
import { d } from "../../helpers/dates";

/**
 * `createProjectedTransaction` (the single place every projection is minted) plus
 * the two thin generators that wrap it: `generateIncomeProjections` and
 * `generateExpenseProjections`.
 *
 * Reference calendar (2026):
 *   2026-01-01 Thu   2026-02-01 Sun   2026-03-01 Sun
 *
 * Occurrence ids are produced by `generateOccurrenceId`, so for a monthly rule
 * with id "inc-1" they are "inc-1_2026-01", "inc-1_2026-02", ... These literal
 * ids are what a stored `occurrenceOverrides` map is keyed by, so the tests use
 * the literals rather than re-deriving them through the generator.
 */

/** The generators and the factory share this return shape. */
type Proj = Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">;

// ----------------------------------------------------------------------------
// Local projection helpers.
//
// `tests/helpers/*` has no accessors for projection lists (only date helpers,
// which take Dates — projections carry "YYYY-MM-DD" strings), so these live
// here. Whole-array assertions catch a wrong date AND a wrong count.
// ----------------------------------------------------------------------------

const scheduledDates = (list: Proj[]): string[] => list.map((t) => t.scheduledDate);
const amounts = (list: Proj[]): number[] => list.map((t) => t.projectedAmount);
const occurrenceIds = (list: Proj[]): (string | undefined)[] => list.map((t) => t.occurrenceId);

/** Q1 2026 — wide enough for three monthly occurrences. */
const Q1_START = d("2026-01-01");
const Q1_END = d("2026-03-31");

// ============================================================================
// createProjectedTransaction
// ============================================================================

describe("createProjectedTransaction", () => {
  describe("field mapping", () => {
    it("copies name, category, notes and id from the source and stamps status projected", () => {
      const rule = makeExpenseRule({
        id: "exp-42",
        name: "Gym",
        category: "personal",
        amount: 45,
        notes: "annual contract",
      });

      const result = createProjectedTransaction(
        rule,
        d("2026-02-09"),
        "expense",
        "expense_rule",
        undefined,
        "exp-42_2026-02"
      );

      expect(result).toEqual({
        name: "Gym",
        type: "expense",
        category: "personal",
        sourceType: "expense_rule",
        sourceId: "exp-42",
        projectedAmount: 45,
        scheduledDate: "2026-02-09",
        status: "projected",
        paymentBreakdown: undefined,
        occurrenceId: "exp-42_2026-02",
        notes: "annual contract",
      });
    });

    it("takes type and sourceType from its arguments, not from the source shape", () => {
      const source = makeIncomeSource({ id: "inc-7", name: "Salary", category: "salary" });

      const result = createProjectedTransaction(source, d("2026-01-15"), "income", "income_source");

      expect(result?.type).toBe("income");
      expect(result?.sourceType).toBe("income_source");
      expect(result?.sourceId).toBe("inc-7");
    });

    it("formats scheduledDate as zero-padded YYYY-MM-DD from the passed date", () => {
      const result = createProjectedTransaction(
        makeExpenseRule(),
        d("2026-03-05"),
        "expense",
        "expense_rule"
      );

      expect(result?.scheduledDate).toBe("2026-03-05");
    });

    it("keeps the calendar day when the date carries a time component", () => {
      const noon = new Date(2026, 6, 4, 12, 30, 0, 0);

      const result = createProjectedTransaction(makeExpenseRule(), noon, "expense", "expense_rule");

      expect(result?.scheduledDate).toBe("2026-07-04");
    });
  });

  describe("skipped overrides", () => {
    it("returns null when the override is skipped", () => {
      const result = createProjectedTransaction(
        makeExpenseRule(),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        undefined,
        "exp-1_2026-01",
        makeOverride({ skipped: true })
      );

      expect(result).toBeNull();
    });

    it("returns null even when the skipped override also carries an amount and a date", () => {
      const result = createProjectedTransaction(
        makeExpenseRule(),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        makePaymentBreakdown(),
        "exp-1_2026-01",
        makeOverride({ skipped: true, amount: 999, scheduledDate: "2026-01-20" })
      );

      expect(result).toBeNull();
    });

    it("still projects when skipped is explicitly false", () => {
      const result = createProjectedTransaction(
        makeExpenseRule({ amount: 1_200 }),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        undefined,
        "exp-1_2026-01",
        makeOverride({ skipped: false })
      );

      expect(result?.projectedAmount).toBe(1_200);
    });
  });

  describe("amount resolution", () => {
    it("uses source.amount when there is neither an override nor a breakdown", () => {
      const result = createProjectedTransaction(
        makeExpenseRule({ amount: 1_200 }),
        d("2026-01-01"),
        "expense",
        "expense_rule"
      );

      expect(result?.projectedAmount).toBe(1_200);
    });

    it("prefers override.amount over source.amount", () => {
      const result = createProjectedTransaction(
        makeExpenseRule({ amount: 1_200 }),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        undefined,
        "exp-1_2026-01",
        makeOverride({ amount: 1_350 })
      );

      expect(result?.projectedAmount).toBe(1_350);
    });

    it("prefers override.amount over a breakdown-derived amount", () => {
      // Breakdown would give 400 + 100 = 500; the user's edit of 620 must win.
      const result = createProjectedTransaction(
        makeExpenseRule({ amount: 1_200 }),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        makePaymentBreakdown({ principalPaid: 400, interestPaid: 100 }),
        "exp-1_2026-01",
        makeOverride({ amount: 620 })
      );

      expect(result?.projectedAmount).toBe(620);
    });

    it("honours an override amount of 0 instead of falling back to source.amount", () => {
      // The factory uses `??`, so a deliberate "this month is free" edit of 0
      // must survive rather than being treated as absent.
      const result = createProjectedTransaction(
        makeExpenseRule({ amount: 1_200 }),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        undefined,
        "exp-1_2026-01",
        makeOverride({ amount: 0 })
      );

      expect(result?.projectedAmount).toBe(0);
    });

    it("honours an override amount of 0 over a breakdown-derived amount", () => {
      const result = createProjectedTransaction(
        makeExpenseRule({ amount: 1_200 }),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        makePaymentBreakdown({ principalPaid: 444.88, interestPaid: 120 }),
        "exp-1_2026-01",
        makeOverride({ amount: 0 })
      );

      expect(result?.projectedAmount).toBe(0);
    });

    it("derives the amount from the breakdown when principal was paid down", () => {
      // 444.88 principal + 120 interest = 564.88 — the breakdown wins over the
      // rule's stale 1,200 amount.
      const result = createProjectedTransaction(
        makeExpenseRule({ amount: 1_200 }),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        makePaymentBreakdown({ principalPaid: 444.88, interestPaid: 120 }),
        "exp-1_2026-01"
      );

      expect(result?.projectedAmount).toBeCloseTo(564.88, 2);
    });

    it("derives the amount from the breakdown even when interest is 0", () => {
      // A 0% installment plan: 200 principal + 0 interest = 200.
      const result = createProjectedTransaction(
        makeExpenseRule({ amount: 1_200 }),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        makePaymentBreakdown({ principalPaid: 200, interestPaid: 0 }),
        "exp-1_2026-01"
      );

      expect(result?.projectedAmount).toBe(200);
    });
  });

  describe("scheduledDate resolution", () => {
    it("prefers override.scheduledDate over the passed date", () => {
      const result = createProjectedTransaction(
        makeExpenseRule(),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        undefined,
        "exp-1_2026-01",
        makeOverride({ scheduledDate: "2026-01-20" })
      );

      expect(result?.scheduledDate).toBe("2026-01-20");
    });

    it("keeps the occurrence id of the logical period when the date is overridden", () => {
      // Moving January's rent to February must not re-key the occurrence,
      // otherwise the override would stop matching its own occurrence.
      const result = createProjectedTransaction(
        makeExpenseRule(),
        d("2026-01-31"),
        "expense",
        "expense_rule",
        undefined,
        "exp-1_2026-01",
        makeOverride({ scheduledDate: "2026-02-02" })
      );

      expect(result?.occurrenceId).toBe("exp-1_2026-01");
      expect(result?.scheduledDate).toBe("2026-02-02");
    });

    it("falls back to the passed date when the override carries only an amount", () => {
      const result = createProjectedTransaction(
        makeExpenseRule(),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        undefined,
        "exp-1_2026-01",
        makeOverride({ amount: 50 })
      );

      expect(result?.scheduledDate).toBe("2026-01-01");
    });
  });

  describe("notes resolution", () => {
    it("prefers override.notes over source.notes", () => {
      const result = createProjectedTransaction(
        makeExpenseRule({ notes: "rule note" }),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        undefined,
        "exp-1_2026-01",
        makeOverride({ notes: "this month only" })
      );

      expect(result?.notes).toBe("this month only");
    });

    it("falls back to source.notes when the override has no notes", () => {
      const result = createProjectedTransaction(
        makeExpenseRule({ notes: "rule note" }),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        undefined,
        "exp-1_2026-01",
        makeOverride({ amount: 50 })
      );

      expect(result?.notes).toBe("rule note");
    });

    it("leaves notes undefined when neither the override nor the source has any", () => {
      const result = createProjectedTransaction(
        makeExpenseRule(),
        d("2026-01-01"),
        "expense",
        "expense_rule"
      );

      expect(result?.notes).toBeUndefined();
    });
  });

  describe("pass-through fields", () => {
    it("passes the payment breakdown onto the transaction unchanged", () => {
      const breakdown = makePaymentBreakdown({
        principalPaid: 444.88,
        interestPaid: 120,
        remainingBalance: 11_555.12,
        paymentNumber: 1,
        totalPayments: 24,
      });

      const result = createProjectedTransaction(
        makeLoanRule(),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        breakdown,
        "loan-1_2026-01"
      );

      expect(result?.paymentBreakdown).toEqual({
        principalPaid: 444.88,
        interestPaid: 120,
        remainingBalance: 11_555.12,
        paymentNumber: 1,
        totalPayments: 24,
      });
    });

    it("passes the occurrence id through untouched", () => {
      const result = createProjectedTransaction(
        makeIncomeSource(),
        d("2026-01-01"),
        "income",
        "income_source",
        undefined,
        "inc-1_2026-01"
      );

      expect(result?.occurrenceId).toBe("inc-1_2026-01");
    });

    it("leaves breakdown and occurrence id undefined when they are not supplied", () => {
      const result = createProjectedTransaction(
        makeExpenseRule(),
        d("2026-01-01"),
        "expense",
        "expense_rule"
      );

      expect(result?.paymentBreakdown).toBeUndefined();
      expect(result?.occurrenceId).toBeUndefined();
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: transactionFactory.ts:37-41 tests `paymentBreakdown?.principalPaid ?`
     * for TRUTHINESS, so a legitimate interest-only / negative-amortization month
     * (principalPaid === 0) is indistinguishable from "no breakdown" and the amount
     * silently falls back to the rule's own `amount`.
     * CORRECT: whenever a breakdown exists the amount should be
     * principalPaid + interestPaid — here 0 + 100 = 100, not the rule's 500.
     */
    it.fails("KNOWN DEFECT: derives the amount from the breakdown when principalPaid is 0", () => {
      const result = createProjectedTransaction(
        makeExpenseRule({ amount: 500 }),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        makePaymentBreakdown({
          principalPaid: 0,
          interestPaid: 100,
          remainingBalance: 12_100,
        }),
        "exp-1_2026-01"
      );

      expect(result?.projectedAmount).toBe(100);
    });

    /**
     * DEFECT: transactionFactory.ts:37-41 lets `override.amount` replace the amount
     * while line 54 passes the ORIGINAL breakdown straight through, so a user who
     * edits one loan payment gets a transaction whose principal/interest split no
     * longer sums to the amount charged (400 + 100 = 500, amount 700).
     * CORRECT: the breakdown must either be re-split against the overridden amount
     * or dropped, so the persisted numbers stay internally consistent.
     */
    it.fails("KNOWN DEFECT: keeps the breakdown consistent with an overridden amount", () => {
      const result = createProjectedTransaction(
        makeLoanRule(),
        d("2026-01-01"),
        "expense",
        "expense_rule",
        makePaymentBreakdown({ principalPaid: 400, interestPaid: 100 }),
        "loan-1_2026-01",
        makeOverride({ amount: 700 })
      );

      expect(result?.projectedAmount).toBe(700);
      const breakdown = result?.paymentBreakdown;
      expect(cents((breakdown?.principalPaid ?? 0) + (breakdown?.interestPaid ?? 0))).toBe(700);
    });
  });
});

// ============================================================================
// generateIncomeProjections
// ============================================================================

describe("generateIncomeProjections", () => {
  describe("activation", () => {
    it("returns nothing for an inactive source even though occurrences exist", () => {
      const overrides = { startDate: "2026-01-01", frequency: "monthly" } as const;

      // Same schedule, only isActive differs — proves the guard, not an empty schedule.
      expect(
        generateIncomeProjections(
          makeIncomeSource({ ...overrides, isActive: true }),
          Q1_START,
          Q1_END
        )
      ).toHaveLength(3);
      expect(
        generateIncomeProjections(
          makeIncomeSource({ ...overrides, isActive: false }),
          Q1_START,
          Q1_END
        )
      ).toEqual([]);
    });
  });

  describe("plain recurring income", () => {
    it("emits one income transaction per occurrence", () => {
      const result = generateIncomeProjections(makeIncomeSource(), Q1_START, Q1_END);

      expect(scheduledDates(result)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
      expect(amounts(result)).toEqual([3_000, 3_000, 3_000]);
      expect(result.map((t) => t.type)).toEqual(["income", "income", "income"]);
      expect(result.map((t) => t.sourceType)).toEqual([
        "income_source",
        "income_source",
        "income_source",
      ]);
    });

    it("carries the source's name, category and notes onto every occurrence", () => {
      const result = generateIncomeProjections(
        makeIncomeSource({ name: "Freelance", category: "freelance", notes: "retainer" }),
        Q1_START,
        Q1_END
      );

      expect(result.map((t) => t.name)).toEqual(["Freelance", "Freelance", "Freelance"]);
      expect(result.map((t) => t.category)).toEqual(["freelance", "freelance", "freelance"]);
      expect(result.map((t) => t.notes)).toEqual(["retainer", "retainer", "retainer"]);
    });

    it("marks every occurrence projected with no payment breakdown", () => {
      const result = generateIncomeProjections(makeIncomeSource(), Q1_START, Q1_END);

      expect(result.map((t) => t.status)).toEqual(["projected", "projected", "projected"]);
      expect(result.map((t) => t.paymentBreakdown)).toEqual([undefined, undefined, undefined]);
    });

    it("threads a monthly occurrence id onto each transaction", () => {
      const result = generateIncomeProjections(makeIncomeSource(), Q1_START, Q1_END);

      expect(occurrenceIds(result)).toEqual(["inc-1_2026-01", "inc-1_2026-02", "inc-1_2026-03"]);
    });

    it("threads frequency-specific occurrence ids for a bi-weekly source", () => {
      // Bi-weekly ids are sequence-numbered from startDate, not month-keyed.
      const result = generateIncomeProjections(
        makeIncomeSource({ frequency: "bi-weekly" }),
        Q1_START,
        d("2026-02-28")
      );

      expect(scheduledDates(result)).toEqual([
        "2026-01-01",
        "2026-01-15",
        "2026-01-29",
        "2026-02-12",
        "2026-02-26",
      ]);
      expect(occurrenceIds(result)).toEqual([
        "inc-1_BW1",
        "inc-1_BW2",
        "inc-1_BW3",
        "inc-1_BW4",
        "inc-1_BW5",
      ]);
    });
  });

  describe("occurrence overrides", () => {
    it("applies an amount override to only the matching occurrence", () => {
      const result = generateIncomeProjections(
        makeIncomeSource({
          occurrenceOverrides: { "inc-1_2026-02": makeOverride({ amount: 2_500 }) },
        }),
        Q1_START,
        Q1_END
      );

      expect(amounts(result)).toEqual([3_000, 2_500, 3_000]);
      expect(scheduledDates(result)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    });

    it("applies a date override to only the matching occurrence", () => {
      const result = generateIncomeProjections(
        makeIncomeSource({
          occurrenceOverrides: {
            "inc-1_2026-02": makeOverride({ scheduledDate: "2026-02-14" }),
          },
        }),
        Q1_START,
        Q1_END
      );

      expect(scheduledDates(result)).toEqual(["2026-01-01", "2026-02-14", "2026-03-01"]);
      expect(amounts(result)).toEqual([3_000, 3_000, 3_000]);
      expect(occurrenceIds(result)).toEqual(["inc-1_2026-01", "inc-1_2026-02", "inc-1_2026-03"]);
    });

    it("applies amount, date and notes together on one occurrence and leaves siblings untouched", () => {
      const result = generateIncomeProjections(
        makeIncomeSource({
          notes: "base note",
          occurrenceOverrides: {
            "inc-1_2026-03": makeOverride({
              amount: 3_450,
              scheduledDate: "2026-03-04",
              notes: "includes bonus",
            }),
          },
        }),
        Q1_START,
        Q1_END
      );

      expect(scheduledDates(result)).toEqual(["2026-01-01", "2026-02-01", "2026-03-04"]);
      expect(amounts(result)).toEqual([3_000, 3_000, 3_450]);
      expect(result.map((t) => t.notes)).toEqual(["base note", "base note", "includes bonus"]);
    });

    it("removes a skipped occurrence from the output entirely", () => {
      const result = generateIncomeProjections(
        makeIncomeSource({
          occurrenceOverrides: { "inc-1_2026-02": makeOverride({ skipped: true }) },
        }),
        Q1_START,
        Q1_END
      );

      expect(result).toHaveLength(2);
      expect(occurrenceIds(result)).toEqual(["inc-1_2026-01", "inc-1_2026-03"]);
      expect(scheduledDates(result)).toEqual(["2026-01-01", "2026-03-01"]);
    });

    it("removes every skipped occurrence when all of them are skipped", () => {
      const result = generateIncomeProjections(
        makeIncomeSource({
          occurrenceOverrides: {
            "inc-1_2026-01": makeOverride({ skipped: true }),
            "inc-1_2026-02": makeOverride({ skipped: true }),
            "inc-1_2026-03": makeOverride({ skipped: true }),
          },
        }),
        Q1_START,
        Q1_END
      );

      expect(result).toEqual([]);
    });

    it("ignores overrides keyed by an id that matches no occurrence", () => {
      const baseline = generateIncomeProjections(makeIncomeSource(), Q1_START, Q1_END);
      const result = generateIncomeProjections(
        makeIncomeSource({
          occurrenceOverrides: {
            // Keyed by scheduled date and by an out-of-window month — neither is
            // a live occurrence id for this window.
            "inc-1_2026-01-01": makeOverride({ amount: 1 }),
            "inc-1_2026-09": makeOverride({ skipped: true }),
          },
        }),
        Q1_START,
        Q1_END
      );

      expect(result).toEqual(baseline);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: incomeProjections.ts:47-55 applies `override.scheduledDate` after the
     * window filter in `calculateOccurrences`, and neither the generator nor
     * projectionGenerator.ts re-filters, so a moved occurrence escapes the window
     * the caller asked for. January's salary dragged to 2026-02-15 is still returned
     * for a January-only request (and the February window will never see it either,
     * because it is keyed to the January occurrence) — the amount is lost from one
     * period and double-counted in the other by any consumer that trusts the window.
     * CORRECT: every returned transaction's scheduledDate lies inside the requested
     * window.
     */
    it.fails("KNOWN DEFECT: keeps overridden dates inside the requested window", () => {
      const result = generateIncomeProjections(
        makeIncomeSource({
          occurrenceOverrides: {
            "inc-1_2026-01": makeOverride({ scheduledDate: "2026-02-15" }),
          },
        }),
        d("2026-01-01"),
        d("2026-01-31")
      );

      for (const projection of result) {
        expect(projection.scheduledDate >= "2026-01-01").toBe(true);
        expect(projection.scheduledDate <= "2026-01-31").toBe(true);
      }
    });
  });
});

// ============================================================================
// generateExpenseProjections
// ============================================================================

describe("generateExpenseProjections", () => {
  describe("activation", () => {
    it("returns nothing for an inactive rule even though occurrences exist", () => {
      expect(
        generateExpenseProjections(makeExpenseRule({ isActive: true }), Q1_START, Q1_END)
      ).toHaveLength(3);
      expect(
        generateExpenseProjections(makeExpenseRule({ isActive: false }), Q1_START, Q1_END)
      ).toEqual([]);
    });

    it("returns nothing for an inactive loan rule without consulting the amortization path", () => {
      expect(
        generateExpenseProjections(makeLoanRule({ isActive: false }), Q1_START, Q1_END)
      ).toEqual([]);
    });
  });

  describe("dispatch on expenseType plus config", () => {
    it("routes a cash_loan WITH loanConfig to the amortization path", () => {
      const result = generateExpenseProjections(makeLoanRule(), Q1_START, Q1_END);

      expect(scheduledDates(result)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
      // Amortization drives the amount: PMT for 12,000 at 1%/month over 24 months
      // = 12000 * 0.01 * 1.01^24 / (1.01^24 - 1) = 564.88, not the rule's 565.
      expect(result.every((t) => t.paymentBreakdown !== undefined)).toBe(true);
      expect(result[0].paymentBreakdown?.paymentNumber).toBe(1);
      expect(result[0].paymentBreakdown?.interestPaid).toBeCloseTo(120, 2); // 12,000 * 1%
      expect(result[0].paymentBreakdown?.principalPaid).toBeCloseTo(444.88, 2);
      expect(result[0].projectedAmount).toBeCloseTo(564.88, 2);
    });

    it("routes a cash_loan WITHOUT loanConfig to the standard recurring path", () => {
      const result = generateExpenseProjections(
        makeExpenseRule({ expenseType: "cash_loan", amount: 565 }),
        Q1_START,
        Q1_END
      );

      expect(scheduledDates(result)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
      expect(amounts(result)).toEqual([565, 565, 565]);
      expect(result.map((t) => t.paymentBreakdown)).toEqual([undefined, undefined, undefined]);
    });

    it("routes a credit_card WITH creditConfig to the credit payoff path", () => {
      const result = generateExpenseProjections(makeCreditRule(), Q1_START, Q1_END);

      // Credit payments land on the configured due date (15th), not the rule's
      // startDate day.
      expect(scheduledDates(result)).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
      expect(result.every((t) => t.paymentBreakdown !== undefined)).toBe(true);
      // Minimum payment 2% of 5,000 = 100 exactly equals the monthly interest
      // (24% APR / 12 = 2% of 5,000), so nothing is paid down.
      expect(result[0].paymentBreakdown?.interestPaid).toBeCloseTo(100, 2);
      expect(result[0].paymentBreakdown?.principalPaid).toBeCloseTo(0, 2);
      expect(result[0].projectedAmount).toBeCloseTo(100, 2);
    });

    it("routes a credit_card WITHOUT creditConfig to the standard recurring path", () => {
      const result = generateExpenseProjections(
        makeExpenseRule({ expenseType: "credit_card", amount: 100 }),
        Q1_START,
        Q1_END
      );

      // Standard path uses the rule's own schedule (startDate 2026-01-01), so
      // there is no due-date shift and no breakdown.
      expect(scheduledDates(result)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
      expect(amounts(result)).toEqual([100, 100, 100]);
      expect(result.map((t) => t.paymentBreakdown)).toEqual([undefined, undefined, undefined]);
    });

    it("routes an installment WITH installmentConfig to the installment path", () => {
      const result = generateExpenseProjections(makeInstallmentRule(), Q1_START, Q1_END);

      expect(scheduledDates(result)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
      expect(result.every((t) => t.paymentBreakdown !== undefined)).toBe(true);
      // 0% BNPL: the whole 200 is principal, and 6 - 1 = 5 payments of 200 remain.
      expect(result[0].paymentBreakdown).toEqual({
        principalPaid: 200,
        interestPaid: 0,
        remainingBalance: 1_000,
        paymentNumber: 1,
        totalPayments: 6,
      });
      expect(amounts(result)).toEqual([200, 200, 200]);
    });

    it("routes an installment WITHOUT installmentConfig to the standard recurring path", () => {
      const result = generateExpenseProjections(
        makeExpenseRule({ expenseType: "installment", amount: 200 }),
        Q1_START,
        Q1_END
      );

      expect(scheduledDates(result)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
      expect(amounts(result)).toEqual([200, 200, 200]);
      expect(result.map((t) => t.paymentBreakdown)).toEqual([undefined, undefined, undefined]);
    });

    it("ignores a loanConfig attached to a non-loan expense type", () => {
      // The guard is on the pair, not on the presence of a config: a "fixed"
      // rule that still carries a stale loanConfig must not amortize.
      const result = generateExpenseProjections(
        makeLoanRule({ expenseType: "fixed", amount: 1_200 }),
        Q1_START,
        Q1_END
      );

      expect(amounts(result)).toEqual([1_200, 1_200, 1_200]);
      expect(result.map((t) => t.paymentBreakdown)).toEqual([undefined, undefined, undefined]);
    });
  });

  describe("standard recurring path", () => {
    it.each(["fixed", "variable", "one-time"] as const)(
      "uses the standard recurring path for expenseType %s",
      (expenseType) => {
        const result = generateExpenseProjections(
          makeExpenseRule({ expenseType, amount: 1_200 }),
          Q1_START,
          Q1_END
        );

        expect(scheduledDates(result)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
        expect(amounts(result)).toEqual([1_200, 1_200, 1_200]);
        expect(result.map((t) => t.paymentBreakdown)).toEqual([undefined, undefined, undefined]);
      }
    );

    it("stamps every standard occurrence as a projected expense from its rule", () => {
      const result = generateExpenseProjections(
        makeExpenseRule({ name: "Rent", category: "housing" }),
        Q1_START,
        Q1_END
      );

      expect(result.map((t) => t.type)).toEqual(["expense", "expense", "expense"]);
      expect(result.map((t) => t.sourceType)).toEqual([
        "expense_rule",
        "expense_rule",
        "expense_rule",
      ]);
      expect(result.map((t) => t.sourceId)).toEqual(["exp-1", "exp-1", "exp-1"]);
      expect(result.map((t) => t.status)).toEqual(["projected", "projected", "projected"]);
      expect(occurrenceIds(result)).toEqual(["exp-1_2026-01", "exp-1_2026-02", "exp-1_2026-03"]);
    });

    it("emits a single occurrence for a one-time schedule", () => {
      const result = generateExpenseProjections(
        makeExpenseRule({
          expenseType: "one-time",
          frequency: "one-time",
          startDate: "2026-02-10",
          amount: 350,
        }),
        Q1_START,
        Q1_END
      );

      expect(scheduledDates(result)).toEqual(["2026-02-10"]);
      expect(occurrenceIds(result)).toEqual(["exp-1_once"]);
      expect(amounts(result)).toEqual([350]);
    });

    it("applies an amount override to only the matching occurrence", () => {
      const result = generateExpenseProjections(
        makeExpenseRule({
          occurrenceOverrides: { "exp-1_2026-02": makeOverride({ amount: 1_275 }) },
        }),
        Q1_START,
        Q1_END
      );

      expect(amounts(result)).toEqual([1_200, 1_275, 1_200]);
      expect(scheduledDates(result)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    });

    it("honours an amount override of 0 on a standard occurrence", () => {
      const result = generateExpenseProjections(
        makeExpenseRule({
          occurrenceOverrides: { "exp-1_2026-02": makeOverride({ amount: 0 }) },
        }),
        Q1_START,
        Q1_END
      );

      expect(amounts(result)).toEqual([1_200, 0, 1_200]);
    });

    it("applies a date override to only the matching occurrence", () => {
      const result = generateExpenseProjections(
        makeExpenseRule({
          occurrenceOverrides: {
            "exp-1_2026-03": makeOverride({ scheduledDate: "2026-03-05" }),
          },
        }),
        Q1_START,
        Q1_END
      );

      expect(scheduledDates(result)).toEqual(["2026-01-01", "2026-02-01", "2026-03-05"]);
    });

    it("removes a skipped occurrence from the output entirely", () => {
      const result = generateExpenseProjections(
        makeExpenseRule({
          occurrenceOverrides: { "exp-1_2026-01": makeOverride({ skipped: true }) },
        }),
        Q1_START,
        Q1_END
      );

      expect(result).toHaveLength(2);
      expect(occurrenceIds(result)).toEqual(["exp-1_2026-02", "exp-1_2026-03"]);
      expect(scheduledDates(result)).toEqual(["2026-02-01", "2026-03-01"]);
    });

    it("ignores overrides keyed by an id that matches no occurrence", () => {
      const baseline = generateExpenseProjections(makeExpenseRule(), Q1_START, Q1_END);
      const result = generateExpenseProjections(
        makeExpenseRule({
          occurrenceOverrides: { "exp-1_2026-02-01": makeOverride({ skipped: true }) },
        }),
        Q1_START,
        Q1_END
      );

      expect(result).toEqual(baseline);
    });
  });
});
