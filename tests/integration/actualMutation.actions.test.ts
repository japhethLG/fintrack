import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => import("../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../helpers/firebaseConfigMock"));

import type { ExpenseRule, IncomeSource, Transaction, UserProfile } from "@/lib/types";
import {
  addManualTransactionAction,
  markTransactionCompleteAction,
  markTransactionSkippedAction,
  rescheduleTransactionAction,
  removeTransactionAction,
  revertTransactionToProjectedAction,
  updateManualTransactionAction,
} from "@/contexts/FinancialContext/actions/transactionActions";
import { generateCreditProjections, generateLoanProjections } from "@/lib/logic/projectionEngine";
import * as store from "../helpers/firestoreEmulator";
import {
  makeCompletedTransaction,
  makeCreditRule,
  makeExpenseRule,
  makeIncomeSource,
  makeInstallmentConfig,
  makeInstallmentRule,
  makeLoanRule,
  makeManualTransaction,
  makePaymentBreakdown,
  makeSkippedTransaction,
  makeTransaction,
  makeUserProfile,
} from "../helpers/builders";
import { d } from "../helpers/dates";
import { freezeToday } from "../helpers/time";

/**
 * THEME: the action layer that turns a user gesture ("mark this done", "move
 * it", "delete it") into a persisted mutation.
 *
 * The interesting half is the `proj_*` path. A projection exists only in
 * memory: the merger computes it on the fly from a rule, so there is no
 * document to update. Acting on one must MATERIALIZE it — parse the synthetic
 * id, find the rule it came from, invent a stored transaction, move the user's
 * balance and clean up the occurrence override. Every one of those steps is a
 * chance to record something different from what the user was looking at.
 *
 * The real firestore repo code runs underneath (firestore emulator), so each
 * test pins the persisted documents — transaction rows, the user balance, and
 * the rule's occurrenceOverrides map — rather than mocked call arguments.
 */

// ============================================================================
// LOCAL HELPERS
//
// Gaps in tests/helpers/* covered here:
//   - no helper seeds a user profile / reads the persisted balance back out;
//   - no helper builds the `proj_${sourceId}::${date}::${occurrenceId}` id from
//     its parts (makeProjectedTransaction builds one, but only for a
//     Transaction it also fabricates, and it emits a trailing "::" when the
//     occurrenceId is absent — which is a different id shape from the one the
//     merger produces for an occurrence without an id).
// ============================================================================

const USER = "user-1";
const TODAY = "2026-03-05";

/** `proj_` id exactly as the merger emits it. */
const projId = (sourceId: string, scheduledDate: string, occurrenceId?: string): string =>
  occurrenceId === undefined
    ? `proj_${sourceId}::${scheduledDate}`
    : `proj_${sourceId}::${scheduledDate}::${occurrenceId}`;

const seedUser = (overrides: Partial<UserProfile> = {}): UserProfile => {
  const profile = makeUserProfile({ uid: USER, ...overrides });
  store.__seed("users", USER, profile as unknown as Record<string, unknown>);
  return profile;
};

/** The persisted balance — the number the user actually sees. */
const balance = (): number => store.__get<UserProfile>("users", USER)!.currentBalance;

const seedIncome = (source: IncomeSource): IncomeSource => {
  store.__seedEntities("income_sources", [source]);
  return source;
};

const seedRule = (rule: ExpenseRule): ExpenseRule => {
  store.__seedEntities("expense_rules", [rule]);
  return rule;
};

const seedTxn = (txn: Transaction): Transaction => {
  store.__seedEntities("transactions", [txn]);
  return txn;
};

const rows = (): (Transaction & { id: string })[] => store.__all<Transaction>("transactions");

/** The single stored transaction — fails loudly if the action wrote 0 or 2. */
const onlyRow = (): Transaction & { id: string } => {
  const all = rows();
  expect(all).toHaveLength(1);
  return all[0];
};

const ruleOverrides = (id: string): Record<string, unknown> | undefined =>
  store.__get<ExpenseRule>("expense_rules", id)?.occurrenceOverrides as
    | Record<string, unknown>
    | undefined;

const incomeOverrides = (id: string): Record<string, unknown> | undefined =>
  store.__get<IncomeSource>("income_sources", id)?.occurrenceOverrides as
    | Record<string, unknown>
    | undefined;

const loanOf = (id: string) => store.__get<ExpenseRule>("expense_rules", id)!.loanConfig!;
const creditOf = (id: string) => store.__get<ExpenseRule>("expense_rules", id)!.creditConfig!;
const installmentOf = (id: string) =>
  store.__get<ExpenseRule>("expense_rules", id)!.installmentConfig!;

beforeEach(() => {
  store.__reset();
  freezeToday(TODAY);
});

// ============================================================================
// markTransactionCompleteAction
// ============================================================================

describe("markTransactionCompleteAction", () => {
  describe("projection id parsing", () => {
    it("rejects an id with no scheduled-date segment", async () => {
      seedUser();
      seedRule(makeExpenseRule());

      await expect(
        markTransactionCompleteAction("proj_exp-1", { actualAmount: 100 }, USER, [], [])
      ).rejects.toThrow("Invalid projection ID format");
      expect(rows()).toEqual([]);
    });

    it("rejects a bare proj_ prefix", async () => {
      await expect(
        markTransactionCompleteAction("proj_", { actualAmount: 100 }, USER, [], [])
      ).rejects.toThrow("Invalid projection ID format");
    });

    it("materializes the occurrence when the id omits the optional occurrenceId segment", async () => {
      seedUser();
      const rule = seedRule(makeExpenseRule({ amount: 1_200 }));

      await markTransactionCompleteAction(
        projId("exp-1", "2026-03-10"),
        { actualAmount: 1_200 },
        USER,
        [],
        [rule]
      );

      // Monthly occurrence id for March 2026 is regenerated from the rule.
      expect(onlyRow()).toMatchObject({
        status: "completed",
        scheduledDate: "2026-03-10",
        occurrenceId: "exp-1_2026-03",
      });
    });

    it("names the missing source when the id belongs to neither an income source nor an expense rule", async () => {
      seedUser();

      await expect(
        markTransactionCompleteAction(
          projId("ghost-9", "2026-03-10", "ghost-9_2026-03"),
          { actualAmount: 100 },
          USER,
          [makeIncomeSource()],
          [makeExpenseRule()]
        )
      ).rejects.toThrow("Source not found for projection. ID: ghost-9");
      expect(rows()).toEqual([]);
      expect(balance()).toBe(10_000);
    });
  });

  describe("materializing an expense projection", () => {
    it("stores one completed transaction with the fields derived from the rule", async () => {
      seedUser();
      const rule = seedRule(makeExpenseRule({ amount: 1_200 }));

      await markTransactionCompleteAction(
        projId("exp-1", "2026-03-01", "exp-1_2026-03"),
        { actualAmount: 1_250, notes: "landlord raised it" },
        USER,
        [],
        [rule]
      );

      expect(onlyRow()).toMatchObject({
        userId: USER,
        name: "Rent",
        type: "expense",
        category: "housing",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        projectedAmount: 1_200,
        actualAmount: 1_250,
        scheduledDate: "2026-03-01",
        // actualDate defaults to the scheduled date when the user gives none.
        actualDate: "2026-03-01",
        status: "completed",
        notes: "landlord raised it",
        occurrenceId: "exp-1_2026-03",
      });
    });

    it("records an explicit actualDate without moving the scheduled date", async () => {
      seedUser();
      const rule = seedRule(makeExpenseRule());

      await markTransactionCompleteAction(
        projId("exp-1", "2026-03-01", "exp-1_2026-03"),
        { actualAmount: 1_200, actualDate: "2026-03-04" },
        USER,
        [],
        [rule]
      );

      expect(onlyRow()).toMatchObject({
        scheduledDate: "2026-03-01",
        actualDate: "2026-03-04",
      });
    });

    it("subtracts the actual amount from the balance", async () => {
      seedUser({ currentBalance: 10_000 });
      const rule = seedRule(makeExpenseRule({ amount: 1_200 }));

      await markTransactionCompleteAction(
        projId("exp-1", "2026-03-01", "exp-1_2026-03"),
        { actualAmount: 1_250 },
        USER,
        [],
        [rule]
      );

      // The ACTUAL is what leaves the account, not the projected 1,200.
      expect(balance()).toBe(8_750);
      expect(store.__get<UserProfile>("users", USER)!.balanceLastUpdatedAt).toBe(TODAY);
    });

    it("omits actualAmount-adjacent fields the user did not supply", async () => {
      seedUser();
      const rule = seedRule(makeExpenseRule({ amount: 1_200 }));

      await markTransactionCompleteAction(
        projId("exp-1", "2026-03-01", "exp-1_2026-03"),
        { actualAmount: 1_200 },
        USER,
        [],
        [rule]
      );

      expect("notes" in onlyRow()).toBe(false);
    });
  });

  describe("materializing an income projection", () => {
    it("stores an income-typed transaction sourced from the income source", async () => {
      seedUser();
      const source = seedIncome(makeIncomeSource({ amount: 3_000 }));

      await markTransactionCompleteAction(
        projId("inc-1", "2026-03-01", "inc-1_2026-03"),
        { actualAmount: 2_950 },
        USER,
        [source],
        []
      );

      expect(onlyRow()).toMatchObject({
        name: "Salary",
        type: "income",
        category: "salary",
        sourceType: "income_source",
        sourceId: "inc-1",
        projectedAmount: 3_000,
        actualAmount: 2_950,
        status: "completed",
      });
    });

    it("adds the actual amount to the balance", async () => {
      seedUser({ currentBalance: 10_000 });
      const source = seedIncome(makeIncomeSource({ amount: 3_000 }));

      await markTransactionCompleteAction(
        projId("inc-1", "2026-03-01", "inc-1_2026-03"),
        { actualAmount: 2_950 },
        USER,
        [source],
        []
      );

      expect(balance()).toBe(12_950);
    });

    it("prefers an income source over an expense rule that shares the id", async () => {
      seedUser();
      const source = seedIncome(makeIncomeSource({ id: "dup-1", amount: 500 }));
      const rule = seedRule(makeExpenseRule({ id: "dup-1", amount: 900 }));

      await markTransactionCompleteAction(
        projId("dup-1", "2026-03-01", "dup-1_2026-03"),
        { actualAmount: 500 },
        USER,
        [source],
        [rule]
      );

      expect(onlyRow()).toMatchObject({ type: "income", projectedAmount: 500 });
      expect(balance()).toBe(10_500);
    });
  });

  describe("regenerating a missing occurrenceId", () => {
    it("derives the monthly occurrence id from the year and month of the scheduled date", async () => {
      seedUser();
      const rule = seedRule(makeExpenseRule({ frequency: "monthly" }));

      await markTransactionCompleteAction(
        projId("exp-1", "2026-11-30"),
        { actualAmount: 1_200 },
        USER,
        [],
        [rule]
      );

      expect(onlyRow().occurrenceId).toBe("exp-1_2026-11");
    });

    it("derives the daily occurrence id from the full scheduled date", async () => {
      seedUser();
      const rule = seedRule(makeExpenseRule({ frequency: "daily", amount: 12 }));

      await markTransactionCompleteAction(
        projId("exp-1", "2026-03-12"),
        { actualAmount: 12 },
        USER,
        [],
        [rule]
      );

      expect(onlyRow().occurrenceId).toBe("exp-1_2026-03-12");
    });

    it("keeps the occurrence id carried by the projection id verbatim", async () => {
      seedUser();
      // A weekend-adjusted occurrence keeps the id of its logical period even
      // though the date moved, so the id in the projection must win.
      const rule = seedRule(makeExpenseRule({ frequency: "monthly" }));

      await markTransactionCompleteAction(
        projId("exp-1", "2026-03-02", "exp-1_2026-02"),
        { actualAmount: 1_200 },
        USER,
        [],
        [rule]
      );

      expect(onlyRow().occurrenceId).toBe("exp-1_2026-02");
    });
  });

  describe("occurrence overrides", () => {
    it("removes the override for the realized occurrence and leaves other occurrences alone", async () => {
      seedUser();
      const rule = seedRule(
        makeExpenseRule({
          occurrenceOverrides: {
            "exp-1_2026-03": { scheduledDate: "2026-03-09" },
            "exp-1_2026-04": { amount: 1_500 },
          },
        })
      );

      await markTransactionCompleteAction(
        projId("exp-1", "2026-03-09", "exp-1_2026-03"),
        { actualAmount: 1_200 },
        USER,
        [],
        [rule]
      );

      expect(ruleOverrides("exp-1")).toEqual({ "exp-1_2026-04": { amount: 1_500 } });
    });

    it("removes the override from the income source document for an income occurrence", async () => {
      seedUser();
      const source = seedIncome(
        makeIncomeSource({
          occurrenceOverrides: {
            "inc-1_2026-03": { scheduledDate: "2026-03-02" },
            "inc-1_2026-05": { skipped: true },
          },
        })
      );

      await markTransactionCompleteAction(
        projId("inc-1", "2026-03-02", "inc-1_2026-03"),
        { actualAmount: 3_000 },
        USER,
        [source],
        []
      );

      expect(incomeOverrides("inc-1")).toEqual({ "inc-1_2026-05": { skipped: true } });
    });

    it("leaves overrides untouched when the projection id omits the occurrenceId segment", async () => {
      seedUser();
      const rule = seedRule(
        makeExpenseRule({
          occurrenceOverrides: { "exp-1_2026-03": { scheduledDate: "2026-03-09" } },
        })
      );

      await markTransactionCompleteAction(
        projId("exp-1", "2026-03-09"),
        { actualAmount: 1_200 },
        USER,
        [],
        [rule]
      );

      // No occurrenceId segment => the remover is never called, so the stale
      // date override survives the occurrence being realized.
      expect(ruleOverrides("exp-1")).toEqual({ "exp-1_2026-03": { scheduledDate: "2026-03-09" } });
    });
  });

  describe("debt source tracking", () => {
    it("increments paymentsMade on a loan rule", async () => {
      seedUser();
      const rule = seedRule(makeLoanRule({}, { paymentsMade: 4 }));

      await markTransactionCompleteAction(
        projId("loan-1", "2026-03-01", "loan-1_2026-03"),
        { actualAmount: 565 },
        USER,
        [],
        [rule]
      );

      expect(loanOf("loan-1").paymentsMade).toBe(5);
    });

    it("increments installmentsPaid on an installment rule", async () => {
      seedUser();
      const rule = seedRule(makeInstallmentRule({}, { installmentsPaid: 2 }));

      await markTransactionCompleteAction(
        projId("inst-1", "2026-03-01", "inst-1_2026-03"),
        { actualAmount: 200 },
        USER,
        [],
        [rule]
      );

      expect(installmentOf("inst-1").installmentsPaid).toBe(3);
    });

    it("does not deactivate an installment rule on its final payment", async () => {
      seedUser();
      const rule = seedRule(makeInstallmentRule({}, { installmentCount: 6, installmentsPaid: 5 }));

      await markTransactionCompleteAction(
        projId("inst-1", "2026-03-01", "inst-1_2026-03"),
        { actualAmount: 200 },
        USER,
        [],
        [rule]
      );

      // The projection path writes only installmentsPaid — unlike
      // updateInstallmentProgress, which also flips isActive off when the plan
      // finishes. Nothing here should silently deactivate the rule.
      expect(installmentOf("inst-1").installmentsPaid).toBe(6);
      expect(store.__get<ExpenseRule>("expense_rules", "inst-1")!.isActive).toBe(true);
    });

    it("updates only the loan counter when a rule carries both a loan and an installment config", async () => {
      seedUser();
      const rule = seedRule(
        makeLoanRule({ installmentConfig: makeInstallmentConfig({ installmentsPaid: 2 }) })
      );

      await markTransactionCompleteAction(
        projId("loan-1", "2026-03-01", "loan-1_2026-03"),
        { actualAmount: 565 },
        USER,
        [],
        [rule]
      );

      // The loan branch is an `else if` chain, so the installment counter is
      // never reached.
      expect(loanOf("loan-1").paymentsMade).toBe(1);
      expect(installmentOf("loan-1").installmentsPaid).toBe(2);
    });

    it("touches no source document for a plain fixed expense", async () => {
      seedUser();
      const rule = seedRule(makeExpenseRule());

      await markTransactionCompleteAction(
        projId("exp-1", "2026-03-01", "exp-1_2026-03"),
        { actualAmount: 1_200 },
        USER,
        [],
        [rule]
      );

      // Only the override removal writes to the rule.
      expect(store.__opsFor("expense_rules").map((op) => op.op)).toEqual(["update"]);
    });

    it("stores the payment for a credit-card occurrence", async () => {
      seedUser();
      const rule = seedRule(makeCreditRule({ amount: 100 }));

      await markTransactionCompleteAction(
        projId("card-1", "2026-03-15", "card-1_2026-03"),
        { actualAmount: 100 },
        USER,
        [],
        [rule]
      );

      expect(onlyRow()).toMatchObject({
        name: "Visa",
        type: "expense",
        sourceId: "card-1",
        actualAmount: 100,
        status: "completed",
      });
      expect(balance()).toBe(9_900);
    });
  });

  describe("stored transactions", () => {
    it("delegates a non-proj id to the full completion flow", async () => {
      seedUser({ currentBalance: 10_000 });
      seedTxn(
        makeManualTransaction({
          id: "man-1",
          type: "expense",
          projectedAmount: 400,
          scheduledDate: "2026-03-10",
        })
      );

      await markTransactionCompleteAction("man-1", { actualAmount: 450 }, USER, [], []);

      expect(store.__get<Transaction>("transactions", "man-1")).toMatchObject({
        status: "completed",
        actualAmount: 450,
        actualDate: "2026-03-10",
        // variance = actual 450 - projected 400
        variance: 50,
      });
      expect(balance()).toBe(9_550);
    });

    it("reverses the previous actual before applying a re-completion", async () => {
      seedUser({ currentBalance: 9_600 });
      seedTxn(
        makeCompletedTransaction({
          id: "man-1",
          sourceType: "manual",
          type: "expense",
          projectedAmount: 400,
          actualAmount: 400,
          scheduledDate: "2026-03-10",
        })
      );

      await markTransactionCompleteAction("man-1", { actualAmount: 250 }, USER, [], []);

      // 9,600 + 400 (reverse the old actual) - 250 (apply the new one) = 9,750.
      expect(balance()).toBe(9_750);
      expect(store.__get<Transaction>("transactions", "man-1")).toMatchObject({
        actualAmount: 250,
        variance: -150,
      });
    });

    it("rejects a stored id that does not exist", async () => {
      seedUser();

      await expect(
        markTransactionCompleteAction("missing-1", { actualAmount: 10 }, USER, [], [])
      ).rejects.toThrow("Transaction not found");
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT (transactionActions.ts:95): the materialized row takes
     * `projectedAmount` from `source.amount`, but for a loan the projected
     * figure the user was shown comes from the amortization schedule
     * (`createProjectedTransaction` is called with `{ ...rule, amount:
     * step.payment }` in loanProjections.ts:57). The rule-level `amount` is a
     * stale summary field, so the stored row records a projected figure that
     * never appeared anywhere, and every variance computed from it is wrong.
     * CORRECT: store the amount of the projection being completed.
     *
     * CANONICAL assertion for the "materialized completion records rule.amount"
     * defect — this is the action layer that does it. lifecycle.test.ts
     * ("KNOWN DEFECT: the realized row records the amount that was actually
     * projected") re-asserts the same root cause end-to-end, as do the two
     * sibling cases just below (card, occurrence override). One fix at
     * transactionActions.ts:95 clears all of them.
     */
    it.fails(
      "KNOWN DEFECT: records the amortized payment as the projected amount for a loan occurrence",
      async () => {
        seedUser();
        const rule = seedRule(makeLoanRule({ amount: 999, startDate: "2026-01-01" }));
        const [firstProjection] = generateLoanProjections(rule, d("2026-01-01"), d("2026-01-31"));

        await markTransactionCompleteAction(
          projId("loan-1", firstProjection.scheduledDate, firstProjection.occurrenceId),
          { actualAmount: firstProjection.projectedAmount },
          USER,
          [],
          [rule]
        );

        expect(onlyRow().projectedAmount).toBeCloseTo(firstProjection.projectedAmount, 2);
      }
    );

    /**
     * DEFECT (transactionActions.ts:95): same root cause for credit cards —
     * the projected payment comes from the payoff schedule
     * (creditProjections.ts), not from `rule.amount`.
     * CORRECT: store the amount of the projection being completed.
     *
     * Same root cause as the loan case above; kept separate only because the
     * amount comes from a different schedule generator.
     */
    it.fails(
      "KNOWN DEFECT: records the scheduled minimum payment as the projected amount for a card occurrence",
      async () => {
        seedUser();
        const rule = seedRule(makeCreditRule({ amount: 999, startDate: "2026-01-01" }));
        const [firstProjection] = generateCreditProjections(rule, d("2026-01-01"), d("2026-01-31"));

        await markTransactionCompleteAction(
          projId("card-1", firstProjection.scheduledDate, firstProjection.occurrenceId),
          { actualAmount: firstProjection.projectedAmount },
          USER,
          [],
          [rule]
        );

        expect(onlyRow().projectedAmount).toBeCloseTo(firstProjection.projectedAmount, 2);
      }
    );

    /**
     * DEFECT (transactionActions.ts:95): an occurrence-level amount override
     * is what the projection displays (`override?.amount ?? source.amount` in
     * transactionFactory.ts:38), but the action ignores overrides entirely.
     * Completing an occurrence the user had re-priced to 1,500 at exactly
     * 1,500 records projectedAmount 1,200 — a phantom 300 variance.
     * CORRECT: projectedAmount 1,500, zero variance.
     *
     * Same root cause as the two cases above (transactionActions.ts:95).
     */
    it.fails(
      "KNOWN DEFECT: honours an occurrence amount override when recording the projected amount",
      async () => {
        seedUser();
        const rule = seedRule(
          makeExpenseRule({
            amount: 1_200,
            occurrenceOverrides: { "exp-1_2026-03": { amount: 1_500 } },
          })
        );

        await markTransactionCompleteAction(
          projId("exp-1", "2026-03-01", "exp-1_2026-03"),
          { actualAmount: 1_500 },
          USER,
          [],
          [rule]
        );

        expect(onlyRow().projectedAmount).toBe(1_500);
      }
    );

    /**
     * DEFECT (transactionActions.ts:89-110): the materialized row never gets a
     * `variance` field, while the stored path computes it
     * (transactions.ts:166). TransactionRow.tsx gates its variance badge on
     * `transaction.variance`, so a completed projection silently shows no
     * variance no matter how far the actual drifted.
     * CORRECT: variance = actualAmount - projectedAmount.
     *
     * CANONICAL assertion for the "materialized completion stores no variance"
     * defect — this is the action layer that omits the field. lifecycle.test.ts
     * ("KNOWN DEFECT: persists the variance on a first-time completion")
     * re-asserts the same root cause end-to-end; the variance tests in
     * actualMutation.firestore.test.ts cover the stored path, which does compute
     * it, and are the contrast this defect is measured against. One fix at
     * transactionActions.ts:89-110 clears both failures.
     */
    it.fails("KNOWN DEFECT: stores the variance of a materialized completion", async () => {
      seedUser();
      const rule = seedRule(makeExpenseRule({ amount: 1_200 }));

      await markTransactionCompleteAction(
        projId("exp-1", "2026-03-01", "exp-1_2026-03"),
        { actualAmount: 1_250 },
        USER,
        [],
        [rule]
      );

      expect(onlyRow().variance).toBe(50);
    });

    /**
     * DEFECT (transactionActions.ts:125-131 vs transactions.ts:182-192): the
     * SAME gesture leaves the loan in two different states depending on
     * whether the row happened to be stored already. The projection path only
     * bumps `paymentsMade`; the stored path calls `updateLoanBalance`, which
     * also pays the principal down. So a user who completes from the calendar
     * (projection) never reduces the loan balance, and their remaining
     * schedule is regenerated from a balance that never shrinks.
     * CORRECT: both paths converge on the same loanConfig.
     */
    it.fails(
      "KNOWN DEFECT: reduces the loan balance the same way whether the row was stored or projected",
      async () => {
        seedUser();
        const fromProjection = seedRule(makeLoanRule({ id: "loan-a" }));
        seedRule(makeLoanRule({ id: "loan-b" }));
        // 565 payment = 445 principal + 120 interest.
        const breakdown = makePaymentBreakdown({ principalPaid: 445, interestPaid: 120 });
        seedTxn(
          makeTransaction({
            id: "stored-1",
            sourceType: "expense_rule",
            sourceId: "loan-b",
            type: "expense",
            projectedAmount: 565,
            scheduledDate: "2026-03-01",
            occurrenceId: "loan-b_2026-03",
            paymentBreakdown: breakdown,
          })
        );

        await markTransactionCompleteAction(
          projId("loan-a", "2026-03-01", "loan-a_2026-03"),
          { actualAmount: 565 },
          USER,
          [],
          [fromProjection]
        );
        await markTransactionCompleteAction("stored-1", { actualAmount: 565 }, USER, [], []);

        expect(loanOf("loan-a")).toEqual(loanOf("loan-b"));
      }
    );

    /**
     * DEFECT (transactionActions.ts:123-139): the branch handles loans and
     * installments only, so paying a credit card from a projection updates
     * nothing on the card. `creditConfig.currentBalance` stays where it was,
     * so the payoff schedule keeps projecting the same minimum payment for
     * ever and the card never pays down.
     * CORRECT: the payment reduces the card balance.
     */
    it.fails(
      "KNOWN DEFECT: reduces the card balance when a card payment is completed",
      async () => {
        seedUser();
        const rule = seedRule(makeCreditRule({ amount: 100 }, { currentBalance: 5_000 }));

        await markTransactionCompleteAction(
          projId("card-1", "2026-03-15", "card-1_2026-03"),
          { actualAmount: 500 },
          USER,
          [],
          [rule]
        );

        expect(creditOf("card-1").currentBalance).toBeLessThan(5_000);
      }
    );
  });
});

// ============================================================================
// markTransactionSkippedAction
// ============================================================================

describe("markTransactionSkippedAction", () => {
  describe("materializing a skipped projection", () => {
    it("stores a skipped transaction with no actual amount", async () => {
      seedUser();
      const rule = seedRule(makeExpenseRule({ amount: 1_200 }));

      await markTransactionSkippedAction(
        projId("exp-1", "2026-03-01", "exp-1_2026-03"),
        "paid in cash",
        USER,
        [],
        [rule]
      );

      const stored = onlyRow();
      expect(stored).toMatchObject({
        name: "Rent",
        type: "expense",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        projectedAmount: 1_200,
        scheduledDate: "2026-03-01",
        status: "skipped",
        notes: "paid in cash",
        occurrenceId: "exp-1_2026-03",
      });
      expect("actualAmount" in stored).toBe(false);
      expect("actualDate" in stored).toBe(false);
    });

    it("leaves the balance untouched", async () => {
      seedUser({ currentBalance: 10_000 });
      const rule = seedRule(makeExpenseRule());

      await markTransactionSkippedAction(
        projId("exp-1", "2026-03-01", "exp-1_2026-03"),
        undefined,
        USER,
        [],
        [rule]
      );

      expect(balance()).toBe(10_000);
      expect(store.__opsFor("users")).toEqual([]);
    });

    it("leaves the balance untouched for a skipped income occurrence", async () => {
      seedUser({ currentBalance: 10_000 });
      const source = seedIncome(makeIncomeSource());

      await markTransactionSkippedAction(
        projId("inc-1", "2026-03-01", "inc-1_2026-03"),
        "client cancelled",
        USER,
        [source],
        []
      );

      expect(onlyRow()).toMatchObject({ type: "income", status: "skipped" });
      expect(balance()).toBe(10_000);
    });

    it("removes the override for the realized occurrence", async () => {
      seedUser();
      const rule = seedRule(
        makeExpenseRule({
          occurrenceOverrides: {
            "exp-1_2026-03": { amount: 1_500 },
            "exp-1_2026-06": { scheduledDate: "2026-06-20" },
          },
        })
      );

      await markTransactionSkippedAction(
        projId("exp-1", "2026-03-01", "exp-1_2026-03"),
        undefined,
        USER,
        [],
        [rule]
      );

      expect(ruleOverrides("exp-1")).toEqual({
        "exp-1_2026-06": { scheduledDate: "2026-06-20" },
      });
    });

    it("regenerates the occurrence id when the projection id omits it", async () => {
      seedUser();
      const rule = seedRule(makeExpenseRule({ frequency: "monthly" }));

      await markTransactionSkippedAction(
        projId("exp-1", "2026-07-01"),
        undefined,
        USER,
        [],
        [rule]
      );

      expect(onlyRow().occurrenceId).toBe("exp-1_2026-07");
      expect(ruleOverrides("exp-1")).toBeUndefined();
    });

    it("rejects a malformed projection id", async () => {
      await expect(
        markTransactionSkippedAction("proj_exp-1", undefined, USER, [], [])
      ).rejects.toThrow("Invalid projection ID format");
    });

    it("names the missing source when the projection has no matching rule", async () => {
      await expect(
        markTransactionSkippedAction(
          projId("ghost-9", "2026-03-01", "ghost-9_2026-03"),
          undefined,
          USER,
          [],
          []
        )
      ).rejects.toThrow("Source not found for projection. ID: ghost-9");
    });
  });

  describe("stored transactions", () => {
    it("delegates a non-proj id to the skip flow", async () => {
      seedUser();
      seedTxn(
        makeTransaction({
          id: "man-1",
          sourceType: "manual",
          type: "expense",
          projectedAmount: 400,
        })
      );

      await markTransactionSkippedAction("man-1", "not needed", USER, [], []);

      expect(store.__get<Transaction>("transactions", "man-1")).toMatchObject({
        status: "skipped",
        notes: "not needed",
      });
      expect(balance()).toBe(10_000);
      expect(store.__opsFor("users")).toEqual([]);
    });

    it("reverses the balance impact when a completed transaction is skipped", async () => {
      seedUser({ currentBalance: 10_450 });
      seedTxn(
        makeCompletedTransaction({
          id: "man-1",
          sourceType: "manual",
          type: "income",
          projectedAmount: 400,
          actualAmount: 450,
        })
      );

      await markTransactionSkippedAction("man-1", undefined, USER, [], []);

      // The 450 that was credited on completion is taken back out.
      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")!.status).toBe("skipped");
    });

    it("keeps the existing notes when the skip carries none", async () => {
      seedUser();
      seedTxn(makeTransaction({ id: "man-1", sourceType: "manual", notes: "original note" }));

      await markTransactionSkippedAction("man-1", undefined, USER, [], []);

      expect(store.__get<Transaction>("transactions", "man-1")).toMatchObject({
        status: "skipped",
        notes: "original note",
      });
    });

    it("rejects a stored id that does not exist", async () => {
      await expect(
        markTransactionSkippedAction("missing-1", undefined, USER, [], [])
      ).rejects.toThrow("Transaction not found");
    });
  });
});

// ============================================================================
// rescheduleTransactionAction
// ============================================================================

describe("rescheduleTransactionAction", () => {
  describe("projections", () => {
    it("writes a scheduledDate override on the expense rule instead of creating a transaction", async () => {
      const rule = seedRule(makeExpenseRule());

      await rescheduleTransactionAction(
        projId("exp-1", "2026-03-01", "exp-1_2026-03"),
        "2026-03-18",
        USER,
        [],
        [rule]
      );

      expect(ruleOverrides("exp-1")).toEqual({
        "exp-1_2026-03": { scheduledDate: "2026-03-18" },
      });
      expect(rows()).toEqual([]);
    });

    it("writes the override on the income source document for an income occurrence", async () => {
      const source = seedIncome(makeIncomeSource());
      seedRule(makeExpenseRule());

      await rescheduleTransactionAction(
        projId("inc-1", "2026-03-01", "inc-1_2026-03"),
        "2026-03-02",
        USER,
        [source],
        []
      );

      expect(incomeOverrides("inc-1")).toEqual({
        "inc-1_2026-03": { scheduledDate: "2026-03-02" },
      });
      expect(store.__opsFor("expense_rules")).toEqual([]);
    });

    it("regenerates the occurrence id when the projection id omits it", async () => {
      const rule = seedRule(makeExpenseRule({ frequency: "monthly" }));

      await rescheduleTransactionAction(
        projId("exp-1", "2026-03-01"),
        "2026-03-18",
        USER,
        [],
        [rule]
      );

      expect(ruleOverrides("exp-1")).toEqual({
        "exp-1_2026-03": { scheduledDate: "2026-03-18" },
      });
    });

    it("leaves other occurrences' overrides alone", async () => {
      const rule = seedRule(
        makeExpenseRule({
          occurrenceOverrides: { "exp-1_2026-05": { amount: 1_500 } },
        })
      );

      await rescheduleTransactionAction(
        projId("exp-1", "2026-03-01", "exp-1_2026-03"),
        "2026-03-18",
        USER,
        [],
        [rule]
      );

      expect(ruleOverrides("exp-1")).toEqual({
        "exp-1_2026-05": { amount: 1_500 },
        "exp-1_2026-03": { scheduledDate: "2026-03-18" },
      });
    });

    it("does not move the balance", async () => {
      seedUser({ currentBalance: 10_000 });
      const rule = seedRule(makeExpenseRule());

      await rescheduleTransactionAction(
        projId("exp-1", "2026-03-01", "exp-1_2026-03"),
        "2026-03-18",
        USER,
        [],
        [rule]
      );

      expect(balance()).toBe(10_000);
      expect(store.__opsFor("users")).toEqual([]);
    });

    it("rejects a malformed projection id", async () => {
      await expect(
        rescheduleTransactionAction("proj_exp-1", "2026-03-18", USER, [], [])
      ).rejects.toThrow("Invalid projection ID format");
    });

    it("names the missing source when the projection has no matching rule", async () => {
      await expect(
        rescheduleTransactionAction(
          projId("ghost-9", "2026-03-01", "ghost-9_2026-03"),
          "2026-03-18",
          USER,
          [],
          []
        )
      ).rejects.toThrow("Source not found for projection. ID: ghost-9");
    });
  });

  describe("stored transactions", () => {
    it("moves the scheduled date of a projected row without inventing an actual date", async () => {
      const rule = seedRule(makeExpenseRule());
      seedTxn(
        makeTransaction({
          id: "txn-1",
          sourceType: "expense_rule",
          sourceId: "exp-1",
          scheduledDate: "2026-03-01",
          occurrenceId: "exp-1_2026-03",
          status: "projected",
        })
      );

      await rescheduleTransactionAction("txn-1", "2026-03-18", USER, [], [rule]);

      const stored = store.__get<Transaction>("transactions", "txn-1")!;
      expect(stored.scheduledDate).toBe("2026-03-18");
      expect("actualDate" in stored).toBe(false);
    });

    it("moves the actual date too when the row is completed", async () => {
      const rule = seedRule(makeExpenseRule());
      seedTxn(
        makeCompletedTransaction({
          id: "txn-1",
          sourceType: "expense_rule",
          sourceId: "exp-1",
          scheduledDate: "2026-03-01",
          actualDate: "2026-03-01",
          occurrenceId: "exp-1_2026-03",
        })
      );

      await rescheduleTransactionAction("txn-1", "2026-03-18", USER, [], [rule]);

      expect(store.__get<Transaction>("transactions", "txn-1")).toMatchObject({
        scheduledDate: "2026-03-18",
        actualDate: "2026-03-18",
      });
    });

    it("moves the actual date of a non-completed row that already carries one", async () => {
      const rule = seedRule(makeExpenseRule());
      seedTxn(
        makeSkippedTransaction({
          id: "txn-1",
          sourceType: "expense_rule",
          sourceId: "exp-1",
          scheduledDate: "2026-03-01",
          actualDate: "2026-03-02",
          occurrenceId: "exp-1_2026-03",
        })
      );

      await rescheduleTransactionAction("txn-1", "2026-03-18", USER, [], [rule]);

      expect(store.__get<Transaction>("transactions", "txn-1")).toMatchObject({
        scheduledDate: "2026-03-18",
        actualDate: "2026-03-18",
      });
    });

    it("backfills a missing occurrence id from the source using the ORIGINAL scheduled date", async () => {
      const rule = seedRule(makeExpenseRule({ frequency: "monthly" }));
      seedTxn(
        makeTransaction({
          id: "txn-1",
          sourceType: "expense_rule",
          sourceId: "exp-1",
          scheduledDate: "2026-03-01",
          status: "projected",
        })
      );

      await rescheduleTransactionAction("txn-1", "2026-04-05", USER, [], [rule]);

      // The occurrence keeps the identity of the period it belongs to (March),
      // not the period it was dragged into (April).
      expect(store.__get<Transaction>("transactions", "txn-1")).toMatchObject({
        scheduledDate: "2026-04-05",
        occurrenceId: "exp-1_2026-03",
      });
    });

    it("keeps an occurrence id that is already present", async () => {
      const rule = seedRule(makeExpenseRule({ frequency: "monthly" }));
      seedTxn(
        makeTransaction({
          id: "txn-1",
          sourceType: "expense_rule",
          sourceId: "exp-1",
          scheduledDate: "2026-03-01",
          occurrenceId: "exp-1_2026-02",
          status: "projected",
        })
      );

      await rescheduleTransactionAction("txn-1", "2026-04-05", USER, [], [rule]);

      expect(store.__get<Transaction>("transactions", "txn-1")!.occurrenceId).toBe("exp-1_2026-02");
    });

    it("leaves a manual row without an occurrence id", async () => {
      seedTxn(
        makeManualTransaction({ id: "man-1", scheduledDate: "2026-03-01", status: "projected" })
      );

      await rescheduleTransactionAction("man-1", "2026-03-18", USER, [], []);

      const stored = store.__get<Transaction>("transactions", "man-1")!;
      expect(stored.scheduledDate).toBe("2026-03-18");
      expect("occurrenceId" in stored).toBe(false);
    });

    it("rejects a stored id that does not exist", async () => {
      await expect(
        rescheduleTransactionAction("missing-1", "2026-03-18", USER, [], [])
      ).rejects.toThrow("Transaction not found");
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT (transactionActions.ts:228): the reschedule writes a FRESH
     * override object, so any amount/notes the user had set on that occurrence
     * is silently discarded — moving a re-priced bill by one day resets its
     * price. `setExpenseRuleOverride` writes the whole map entry, so a merge
     * has to happen here.
     * CORRECT: keep the existing amount and only change scheduledDate.
     */
    it.fails(
      "KNOWN DEFECT: preserves an existing amount override when only the date is rescheduled",
      async () => {
        const rule = seedRule(
          makeExpenseRule({
            occurrenceOverrides: { "exp-1_2026-03": { amount: 1_500, notes: "one-off top-up" } },
          })
        );

        await rescheduleTransactionAction(
          projId("exp-1", "2026-03-01", "exp-1_2026-03"),
          "2026-03-18",
          USER,
          [],
          [rule]
        );

        expect(ruleOverrides("exp-1")).toEqual({
          "exp-1_2026-03": { amount: 1_500, notes: "one-off top-up", scheduledDate: "2026-03-18" },
        });
      }
    );
  });
});

// ============================================================================
// addManualTransactionAction
// ============================================================================

describe("addManualTransactionAction", () => {
  /**
   * The exact payload shape the manual-transaction form submits
   * (ManualTransactionForm/formHelpers.ts `transformToTransactionData`): every
   * optional field is sent explicitly as `undefined` rather than omitted, which
   * is what makes the undefined-stripping in the repo layer load-bearing.
   */
  const formPayload = (
    overrides: Partial<Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">> = {}
  ): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt"> => ({
    sourceType: "manual",
    sourceId: undefined,
    name: "Dentist",
    type: "expense",
    category: "healthcare",
    projectedAmount: 400,
    actualAmount: undefined,
    scheduledDate: "2026-03-10",
    actualDate: undefined,
    status: "projected",
    notes: undefined,
    occurrenceId: undefined,
    ...overrides,
  });

  it("persists the transaction under the given userId", async () => {
    seedUser();

    await addManualTransactionAction(formPayload(), USER);

    expect(onlyRow()).toMatchObject({
      userId: USER,
      sourceType: "manual",
      name: "Dentist",
      type: "expense",
      category: "healthcare",
      projectedAmount: 400,
      scheduledDate: "2026-03-10",
      status: "projected",
    });
  });

  it("writes to no collection other than transactions", async () => {
    seedUser();

    await addManualTransactionAction(formPayload(), USER);

    expect(store.__ops.map((op) => op.collection)).toEqual(["transactions"]);
  });

  it("returns the created entity carrying the id the store generated", async () => {
    seedUser();

    const created = await addManualTransactionAction(formPayload(), USER);

    // The id is invented by the repo on write, so the only way to know it is
    // through the return value — the form's caller has nothing else to go on.
    expect(created.id).toBe(onlyRow().id);
    expect(created).toMatchObject({
      userId: USER,
      name: "Dentist",
      projectedAmount: 400,
      status: "projected",
    });
    // createdAt/updatedAt are stamped by the repo, not supplied by the caller.
    expect(created.createdAt).toBeDefined();
    expect(created.updatedAt).toBeDefined();
  });

  it("strips the undefined fields the form sends for an unrealized row", async () => {
    seedUser();

    const created = await addManualTransactionAction(formPayload(), USER);

    const stored = onlyRow();
    expect("sourceId" in stored).toBe(false);
    expect("actualAmount" in stored).toBe(false);
    expect("actualDate" in stored).toBe(false);
    expect("notes" in stored).toBe(false);
    expect("occurrenceId" in stored).toBe(false);

    // Only the PERSISTED document is cleaned (transactions.ts `removeUndefined`).
    // The returned entity is built by spreading the raw input over the id, so it
    // still carries those keys with an undefined value.
    expect("actualAmount" in created).toBe(true);
    expect(created.actualAmount).toBeUndefined();
  });

  it("keeps the optional fields the form does supply", async () => {
    seedUser();

    await addManualTransactionAction(
      formPayload({
        status: "completed",
        actualAmount: 450,
        actualDate: "2026-03-11",
        notes: "paid at the desk",
      }),
      USER
    );

    expect(onlyRow()).toMatchObject({
      status: "completed",
      actualAmount: 450,
      actualDate: "2026-03-11",
      notes: "paid at the desk",
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT (transactionActions.ts:274-279): the action is a bare passthrough
     * to `addTransaction`, which only writes the document. "Completed" is a
     * first-class choice on the form (ManualTransactionForm/constants.ts
     * STATUS_OPTIONS — "Completed / Transaction has occurred"), and
     * `getSmartStatus` in formHelpers.ts even defaults any date on or before
     * today to it. So the common gesture "log the coffee I just bought" writes
     * a completed row and leaves `currentBalance` exactly where it was: the
     * money never moves.
     *
     * No other layer compensates. `syncComputedBalance`
     * (logic/balanceCalculator/computedBalance.ts) is the only code that
     * recomputes the balance from the rows, and its only callers are the two
     * manual controls on the settings Balance section (Recalculate, and editing
     * the initial balance); `generateReconciliationReport` /
     * `fixBalanceDiscrepancy` in reconciliation.ts have no callers at all. The
     * drift therefore persists until the user happens to visit Settings and
     * press a button.
     *
     * Every sibling action here maintains the balance incrementally instead —
     * `updateManualTransactionAction` on projected -> completed
     * (transactionActions.ts:313-316) and `removeTransactionAction` on delete
     * (transactionActions.ts:346) — so the add path is the odd one out. Worse,
     * deleting the row afterwards REVERSES an impact that was never applied,
     * pushing the balance 400 in the wrong direction and leaving no record of
     * why.
     * CORRECT: adding an already-completed 400 expense leaves 9,600.
     */
    it.fails(
      "KNOWN DEFECT: applies the balance impact of an already-completed manual row",
      async () => {
        seedUser({ currentBalance: 10_000 });

        await addManualTransactionAction(
          formPayload({ status: "completed", actualAmount: 400, actualDate: "2026-03-10" }),
          USER
        );

        // The row is on the ledger as money that has already moved...
        expect(onlyRow()).toMatchObject({ status: "completed", actualAmount: 400 });
        // ...but the account never noticed.
        expect(balance()).toBe(9_600);
      }
    );
  });
});

// ============================================================================
// updateManualTransactionAction — THE ACTUAL-MUTATION MATRIX
// ============================================================================

describe("updateManualTransactionAction", () => {
  /** Seed a manual row; `id` is always "man-1". */
  const seedManual = (overrides: Partial<Transaction>): Transaction =>
    seedTxn(makeManualTransaction({ id: "man-1", scheduledDate: "2026-03-10", ...overrides }));

  describe("projected -> completed", () => {
    it("subtracts the new amount for an expense", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "expense", projectedAmount: 400, status: "projected" });

      await updateManualTransactionAction(
        "man-1",
        { status: "completed", actualAmount: 400 },
        USER
      );

      expect(balance()).toBe(9_600);
      expect(store.__get<Transaction>("transactions", "man-1")).toMatchObject({
        status: "completed",
        actualAmount: 400,
      });
    });

    it("adds the new amount for income", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "income", projectedAmount: 400, status: "projected" });

      await updateManualTransactionAction(
        "man-1",
        { status: "completed", actualAmount: 400 },
        USER
      );

      expect(balance()).toBe(10_400);
    });

    it("uses the actual amount, not the projected one, when they differ", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "expense", projectedAmount: 400, status: "projected" });

      await updateManualTransactionAction(
        "man-1",
        { status: "completed", actualAmount: 550 },
        USER
      );

      expect(balance()).toBe(9_450);
    });

    it("falls back to the existing projected amount when the completion carries no amount", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "expense", projectedAmount: 400, status: "projected" });

      await updateManualTransactionAction("man-1", { status: "completed" }, USER);

      expect(balance()).toBe(9_600);
    });
  });

  describe("completed -> projected", () => {
    it("reverses the expense impact in full", async () => {
      seedUser({ currentBalance: 9_600 });
      seedManual({ type: "expense", projectedAmount: 400, actualAmount: 400, status: "completed" });

      await updateManualTransactionAction("man-1", { status: "projected" }, USER);

      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")!.status).toBe("projected");
    });

    it("reverses the income impact in full", async () => {
      seedUser({ currentBalance: 10_400 });
      seedManual({ type: "income", projectedAmount: 400, actualAmount: 400, status: "completed" });

      await updateManualTransactionAction("man-1", { status: "projected" }, USER);

      expect(balance()).toBe(10_000);
    });

    it("reverses the recorded actual, not the projected amount", async () => {
      seedUser({ currentBalance: 9_450 });
      seedManual({ type: "expense", projectedAmount: 400, actualAmount: 550, status: "completed" });

      await updateManualTransactionAction("man-1", { status: "projected" }, USER);

      expect(balance()).toBe(10_000);
    });

    it("falls back to the projected amount when no actual was ever recorded", async () => {
      seedUser({ currentBalance: 9_700 });
      seedManual({ type: "expense", projectedAmount: 300, status: "completed" });

      await updateManualTransactionAction("man-1", { status: "projected" }, USER);

      expect(balance()).toBe(10_000);
    });
  });

  describe("completed -> skipped", () => {
    it("reverses the expense impact", async () => {
      seedUser({ currentBalance: 9_600 });
      seedManual({ type: "expense", projectedAmount: 400, actualAmount: 400, status: "completed" });

      await updateManualTransactionAction("man-1", { status: "skipped" }, USER);

      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")!.status).toBe("skipped");
    });

    it("reverses the income impact", async () => {
      seedUser({ currentBalance: 10_400 });
      seedManual({ type: "income", projectedAmount: 400, actualAmount: 400, status: "completed" });

      await updateManualTransactionAction("man-1", { status: "skipped" }, USER);

      expect(balance()).toBe(10_000);
    });
  });

  describe("skipped -> completed", () => {
    it("applies the expense impact", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "expense", projectedAmount: 400, status: "skipped" });

      await updateManualTransactionAction(
        "man-1",
        { status: "completed", actualAmount: 400 },
        USER
      );

      expect(balance()).toBe(9_600);
    });

    it("applies the income impact", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "income", projectedAmount: 400, status: "skipped" });

      await updateManualTransactionAction(
        "man-1",
        { status: "completed", actualAmount: 400 },
        USER
      );

      expect(balance()).toBe(10_400);
    });
  });

  describe("completed -> completed", () => {
    it("applies only the difference for an expense", async () => {
      seedUser({ currentBalance: 9_900 });
      seedManual({ type: "expense", projectedAmount: 100, actualAmount: 100, status: "completed" });

      await updateManualTransactionAction("man-1", { actualAmount: 250 }, USER);

      // The first 100 is already out of the account, so a 250 actual costs
      // another 150 — not another 250.
      expect(balance()).toBe(9_750);
    });

    it("applies only the difference for income", async () => {
      seedUser({ currentBalance: 10_100 });
      seedManual({ type: "income", projectedAmount: 100, actualAmount: 100, status: "completed" });

      await updateManualTransactionAction("man-1", { actualAmount: 250 }, USER);

      expect(balance()).toBe(10_250);
    });

    it("refunds the difference when the actual amount drops", async () => {
      seedUser({ currentBalance: 9_750 });
      seedManual({ type: "expense", projectedAmount: 100, actualAmount: 250, status: "completed" });

      await updateManualTransactionAction("man-1", { actualAmount: 100 }, USER);

      expect(balance()).toBe(9_900);
    });

    it("honours an actual amount of zero instead of treating it as absent", async () => {
      seedUser({ currentBalance: 9_900 });
      seedManual({ type: "expense", projectedAmount: 100, actualAmount: 100, status: "completed" });

      await updateManualTransactionAction("man-1", { actualAmount: 0 }, USER);

      // 0 is a real recorded amount: the whole 100 comes back.
      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")!.actualAmount).toBe(0);
    });

    it("reads an existing actual amount of zero as the old amount", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "expense", projectedAmount: 100, actualAmount: 0, status: "completed" });

      await updateManualTransactionAction("man-1", { actualAmount: 100 }, USER);

      // Old amount is 0 (not the projected 100), so the whole 100 is new.
      expect(balance()).toBe(9_900);
    });

    it("does not move the balance when the amount is unchanged", async () => {
      seedUser({ currentBalance: 9_900 });
      seedManual({ type: "expense", projectedAmount: 100, actualAmount: 100, status: "completed" });

      await updateManualTransactionAction("man-1", { notes: "kept the receipt" }, USER);

      expect(balance()).toBe(9_900);
      expect(store.__opsFor("users")).toEqual([]);
      expect(store.__get<Transaction>("transactions", "man-1")!.notes).toBe("kept the receipt");
    });

    it("does not move the balance when the update restates the same actual amount", async () => {
      seedUser({ currentBalance: 9_900 });
      seedManual({ type: "expense", projectedAmount: 100, actualAmount: 100, status: "completed" });

      await updateManualTransactionAction(
        "man-1",
        { status: "completed", actualAmount: 100 },
        USER
      );

      expect(store.__opsFor("users")).toEqual([]);
      expect(balance()).toBe(9_900);
    });
  });

  describe("projected -> projected", () => {
    it("does not move the balance when a projected amount is edited", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "expense", projectedAmount: 400, status: "projected" });

      await updateManualTransactionAction("man-1", { projectedAmount: 900 }, USER);

      expect(balance()).toBe(10_000);
      expect(store.__opsFor("users")).toEqual([]);
      expect(store.__get<Transaction>("transactions", "man-1")!.projectedAmount).toBe(900);
    });

    it("does not move the balance when a projected row is renamed or moved", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "expense", projectedAmount: 400, status: "projected" });

      await updateManualTransactionAction(
        "man-1",
        { name: "Dentist", scheduledDate: "2026-03-22" },
        USER
      );

      expect(store.__opsFor("users")).toEqual([]);
      expect(store.__get<Transaction>("transactions", "man-1")).toMatchObject({
        name: "Dentist",
        scheduledDate: "2026-03-22",
      });
    });

    it("does not move the balance for a skipped row that stays skipped", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "expense", projectedAmount: 400, status: "skipped" });

      await updateManualTransactionAction("man-1", { projectedAmount: 500 }, USER);

      expect(store.__opsFor("users")).toEqual([]);
      expect(balance()).toBe(10_000);
    });
  });

  // --------------------------------------------------------------------------
  // The remaining corners of the matrix. Every transition below has "not
  // completed" on BOTH sides, so it falls past all three branches of
  // transactionActions.ts:309-323 into the unbranched `else` and must be a
  // balance no-op. Each one asserts through `store.__opsFor("users")` as well as
  // the number, because a write that happens to store the same balance back is
  // still a bug (it restamps `balanceLastUpdatedAt` and would mask a real
  // rounding drift), and only the op log can see it.
  // --------------------------------------------------------------------------

  describe("projected -> skipped", () => {
    it("does not move the balance for an expense", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "expense", projectedAmount: 400, status: "projected" });

      await updateManualTransactionAction("man-1", { status: "skipped" }, USER);

      expect(store.__opsFor("users")).toEqual([]);
      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")!.status).toBe("skipped");
    });

    it("does not move the balance for income", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "income", projectedAmount: 400, status: "projected" });

      await updateManualTransactionAction("man-1", { status: "skipped" }, USER);

      expect(store.__opsFor("users")).toEqual([]);
      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")!.status).toBe("skipped");
    });
  });

  describe("skipped -> projected", () => {
    it("does not move the balance for an expense", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "expense", projectedAmount: 400, status: "skipped" });

      await updateManualTransactionAction("man-1", { status: "projected" }, USER);

      expect(store.__opsFor("users")).toEqual([]);
      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")!.status).toBe("projected");
    });

    it("does not move the balance for income", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "income", projectedAmount: 400, status: "skipped" });

      await updateManualTransactionAction("man-1", { status: "projected" }, USER);

      expect(store.__opsFor("users")).toEqual([]);
      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")!.status).toBe("projected");
    });
  });

  describe("skipped -> skipped", () => {
    // Restating the status explicitly AND handing the action an actualAmount is
    // the sharpest version of this corner: an amount lands on a row whose money
    // never moved, and it still must not reach the balance.
    it("does not move the balance for an expense", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "expense", projectedAmount: 400, status: "skipped" });

      await updateManualTransactionAction("man-1", { status: "skipped", actualAmount: 400 }, USER);

      expect(store.__opsFor("users")).toEqual([]);
      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")).toMatchObject({
        status: "skipped",
        actualAmount: 400,
      });
    });

    it("does not move the balance for income", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "income", projectedAmount: 400, status: "skipped" });

      await updateManualTransactionAction("man-1", { status: "skipped", actualAmount: 400 }, USER);

      expect(store.__opsFor("users")).toEqual([]);
      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")).toMatchObject({
        status: "skipped",
        actualAmount: 400,
      });
    });
  });

  describe("type flips on a row that is not completed", () => {
    /**
     * Nothing has been applied to the balance yet, so re-signing the row is a
     * pure metadata edit.
     *
     * The COMPLETED-row flips are a different story and are already pinned as
     * defects below — see "KNOWN DEFECT: flipping a completed income row to an
     * expense reverses the credit" and "KNOWN DEFECT: flipping the type of a
     * completed row at the same amount re-signs the balance". Not duplicated
     * here.
     */
    it("does not move the balance when a projected income row becomes an expense", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "income", projectedAmount: 500, status: "projected" });

      await updateManualTransactionAction("man-1", { type: "expense" }, USER);

      expect(store.__opsFor("users")).toEqual([]);
      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")).toMatchObject({
        type: "expense",
        status: "projected",
      });
    });

    it("does not move the balance when a projected expense row becomes income", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "expense", projectedAmount: 500, status: "projected" });

      await updateManualTransactionAction("man-1", { type: "income" }, USER);

      expect(store.__opsFor("users")).toEqual([]);
      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")!.type).toBe("income");
    });

    it("does not move the balance when the flip also restates the amount", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "income", projectedAmount: 500, status: "projected" });

      // A larger amount arrives with the flip; still nothing to reverse or apply
      // while the row is unrealized.
      await updateManualTransactionAction("man-1", { type: "expense", projectedAmount: 600 }, USER);

      expect(store.__opsFor("users")).toEqual([]);
      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")).toMatchObject({
        type: "expense",
        projectedAmount: 600,
      });
    });

    it("does not move the balance when a skipped row is flipped", async () => {
      seedUser({ currentBalance: 10_000 });
      seedManual({ type: "expense", projectedAmount: 500, status: "skipped" });

      await updateManualTransactionAction("man-1", { type: "income" }, USER);

      expect(store.__opsFor("users")).toEqual([]);
      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "man-1")).toMatchObject({
        type: "income",
        status: "skipped",
      });
    });
  });

  describe("guards", () => {
    it("rejects a transaction that is not manual", async () => {
      seedUser();
      seedTxn(
        makeTransaction({
          id: "txn-1",
          sourceType: "expense_rule",
          sourceId: "exp-1",
          status: "projected",
        })
      );

      await expect(
        updateManualTransactionAction("txn-1", { status: "completed", actualAmount: 10 }, USER)
      ).rejects.toThrow("This action is only for manual transactions");
      expect(balance()).toBe(10_000);
      expect(store.__get<Transaction>("transactions", "txn-1")!.status).toBe("projected");
    });

    it("rejects an id that does not exist", async () => {
      seedUser();

      await expect(
        updateManualTransactionAction("missing-1", { status: "completed" }, USER)
      ).rejects.toThrow("Transaction not found");
      expect(store.__opsFor("users")).toEqual([]);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT (transactionActions.ts:306): `newAmount` falls back through
     * `updates.projectedAmount`, so editing only the PROJECTED figure of an
     * already-completed row moves the balance even though nothing was actually
     * paid. The stored `actualAmount` still reads 100 while the balance has
     * moved by 250 — the row and the balance now disagree.
     * CORRECT: for a completed row the balance follows actualAmount only.
     */
    it.fails(
      "KNOWN DEFECT: editing only the projected amount of a completed row leaves the balance alone",
      async () => {
        seedUser({ currentBalance: 9_900 });
        seedManual({
          type: "expense",
          projectedAmount: 100,
          actualAmount: 100,
          status: "completed",
        });

        await updateManualTransactionAction("man-1", { projectedAmount: 250 }, USER);

        expect(balance()).toBe(9_900);
      }
    );

    /**
     * DEFECT (transactionActions.ts:319-320): both the reversal and the new
     * delta are signed by `existing.type`, so flipping income <-> expense on a
     * completed row never reverses the old direction. A 500 income that
     * becomes a 600 expense should end at 10,000 - 600 = 9,400; instead the
     * action credits a further 100.
     * CORRECT: reverse with the old type, apply with the new one.
     */
    it.fails(
      "KNOWN DEFECT: flipping a completed income row to an expense reverses the credit",
      async () => {
        seedUser({ currentBalance: 10_500 });
        seedManual({
          type: "income",
          projectedAmount: 500,
          actualAmount: 500,
          status: "completed",
        });

        await updateManualTransactionAction("man-1", { type: "expense", actualAmount: 600 }, USER);

        expect(balance()).toBe(9_400);
      }
    );

    /**
     * DEFECT (transactionActions.ts:317): with the amount unchanged, a type
     * flip enters no balance branch at all, so a completed 500 income that
     * becomes a 500 expense leaves +500 applied instead of -500 — a 1,000
     * error with no trace.
     * CORRECT: 10,000 - 500 = 9,500.
     */
    it.fails(
      "KNOWN DEFECT: flipping the type of a completed row at the same amount re-signs the balance",
      async () => {
        seedUser({ currentBalance: 10_500 });
        seedManual({
          type: "income",
          projectedAmount: 500,
          actualAmount: 500,
          status: "completed",
        });

        await updateManualTransactionAction("man-1", { type: "expense" }, USER);

        expect(balance()).toBe(9_500);
      }
    );
  });
});

// ============================================================================
// removeTransactionAction
// ============================================================================

describe("removeTransactionAction", () => {
  it("refuses to delete a projection", async () => {
    await expect(
      removeTransactionAction(projId("exp-1", "2026-03-01", "exp-1_2026-03"), USER)
    ).rejects.toThrow("Cannot delete projected transactions");
  });

  it("rejects an id that does not exist", async () => {
    await expect(removeTransactionAction("missing-1", USER)).rejects.toThrow(
      "Transaction not found"
    );
  });

  it("reverses the balance impact of a completed manual expense", async () => {
    seedUser({ currentBalance: 9_600 });
    seedTxn(
      makeCompletedTransaction({
        id: "man-1",
        sourceType: "manual",
        type: "expense",
        projectedAmount: 400,
        actualAmount: 400,
      })
    );

    await removeTransactionAction("man-1", USER);

    expect(balance()).toBe(10_000);
    expect(store.__get("transactions", "man-1")).toBeUndefined();
  });

  it("reverses the balance impact of a completed manual income row", async () => {
    seedUser({ currentBalance: 10_450 });
    seedTxn(
      makeCompletedTransaction({
        id: "man-1",
        sourceType: "manual",
        type: "income",
        projectedAmount: 400,
        actualAmount: 450,
      })
    );

    await removeTransactionAction("man-1", USER);

    // The recorded actual (450) is what has to come back out.
    expect(balance()).toBe(10_000);
  });

  it("falls back to the projected amount when the completed row has no actual", async () => {
    seedUser({ currentBalance: 9_700 });
    seedTxn(
      makeTransaction({
        id: "man-1",
        sourceType: "manual",
        type: "expense",
        projectedAmount: 300,
        status: "completed",
      })
    );

    await removeTransactionAction("man-1", USER);

    expect(balance()).toBe(10_000);
  });

  it("does not touch the balance when deleting a projected manual row", async () => {
    seedUser({ currentBalance: 10_000 });
    seedTxn(makeManualTransaction({ id: "man-1", type: "expense", projectedAmount: 400 }));

    await removeTransactionAction("man-1", USER);

    expect(balance()).toBe(10_000);
    expect(store.__opsFor("users")).toEqual([]);
    expect(store.__get("transactions", "man-1")).toBeUndefined();
  });

  it("does not touch the balance when deleting a skipped manual row", async () => {
    seedUser({ currentBalance: 10_000 });
    seedTxn(
      makeSkippedTransaction({
        id: "man-1",
        sourceType: "manual",
        type: "expense",
        projectedAmount: 400,
      })
    );

    await removeTransactionAction("man-1", USER);

    expect(store.__opsFor("users")).toEqual([]);
    expect(balance()).toBe(10_000);
  });

  describe("known defects", () => {
    /**
     * DEFECT (transactionActions.ts:346): the reversal is gated on
     * `sourceType === "manual"`, so deleting a COMPLETED rule-based row throws
     * the record away while leaving its money applied. The 400 stays spent
     * with nothing on the ledger to explain it.
     * CORRECT: any completed row reverses its impact when deleted.
     */
    it.fails(
      "KNOWN DEFECT: reverses the balance impact of a completed rule-based transaction",
      async () => {
        seedUser({ currentBalance: 9_600 });
        seedTxn(
          makeCompletedTransaction({
            id: "txn-1",
            sourceType: "expense_rule",
            sourceId: "exp-1",
            type: "expense",
            projectedAmount: 400,
            actualAmount: 400,
            occurrenceId: "exp-1_2026-03",
          })
        );

        await removeTransactionAction("txn-1", USER);

        expect(balance()).toBe(10_000);
      }
    );
  });
});

// ============================================================================
// revertTransactionToProjectedAction
// ============================================================================

describe("revertTransactionToProjectedAction", () => {
  /** A stored, completed, rule-based row for rule `exp-1`. */
  const seedStoredOccurrence = (overrides: Partial<Transaction> = {}): Transaction =>
    seedTxn(
      makeCompletedTransaction({
        id: "txn-1",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        type: "expense",
        projectedAmount: 1_200,
        actualAmount: 1_200,
        ...overrides,
      })
    );

  it("refuses to revert something that is already a projection", async () => {
    await expect(
      revertTransactionToProjectedAction(projId("exp-1", "2026-03-01", "exp-1_2026-03"))
    ).rejects.toThrow("Transaction is already projected");
  });

  it("deletes the stored row and reverses its balance impact", async () => {
    seedUser({ currentBalance: 8_800 });
    seedRule(makeExpenseRule({ startDate: "2026-01-01" }));
    seedStoredOccurrence({ scheduledDate: "2026-03-01", occurrenceId: "exp-1_2026-03" });

    await revertTransactionToProjectedAction("txn-1");

    expect(balance()).toBe(10_000);
    expect(rows()).toEqual([]);
  });

  it("decrements the loan counter it had incremented", async () => {
    seedUser({ currentBalance: 9_435 });
    seedRule(makeLoanRule({ startDate: "2026-01-01" }, { paymentsMade: 3 }));
    seedTxn(
      makeCompletedTransaction({
        id: "txn-1",
        sourceType: "expense_rule",
        sourceId: "loan-1",
        type: "expense",
        projectedAmount: 565,
        actualAmount: 565,
        scheduledDate: "2026-03-01",
        occurrenceId: "loan-1_2026-03",
      })
    );

    await revertTransactionToProjectedAction("txn-1");

    expect(loanOf("loan-1").paymentsMade).toBe(2);
    expect(balance()).toBe(10_000);
  });

  describe("preserving a custom date", () => {
    it("writes no override when a monthly occurrence sits on its pattern date", async () => {
      seedUser({ currentBalance: 8_800 });
      seedRule(makeExpenseRule({ frequency: "monthly", startDate: "2026-01-10" }));
      seedStoredOccurrence({ scheduledDate: "2026-03-10", occurrenceId: "exp-1_2026-03" });

      await revertTransactionToProjectedAction("txn-1");

      // The pattern regenerates 2026-03-10 by itself; an override would be noise.
      expect(ruleOverrides("exp-1")).toBeUndefined();
      expect(store.__opsFor("expense_rules")).toEqual([]);
    });

    it("writes an override when a monthly occurrence was moved off its pattern date", async () => {
      seedUser({ currentBalance: 8_800 });
      seedRule(makeExpenseRule({ frequency: "monthly", startDate: "2026-01-10" }));
      seedStoredOccurrence({ scheduledDate: "2026-03-18", occurrenceId: "exp-1_2026-03" });

      await revertTransactionToProjectedAction("txn-1");

      expect(ruleOverrides("exp-1")).toEqual({
        "exp-1_2026-03": { scheduledDate: "2026-03-18" },
      });
    });

    it("writes the override on the income source document", async () => {
      seedUser({ currentBalance: 13_000 });
      seedIncome(makeIncomeSource({ frequency: "monthly", startDate: "2026-01-10" }));
      seedTxn(
        makeCompletedTransaction({
          id: "txn-1",
          sourceType: "income_source",
          sourceId: "inc-1",
          type: "income",
          projectedAmount: 3_000,
          actualAmount: 3_000,
          scheduledDate: "2026-03-02",
          occurrenceId: "inc-1_2026-03",
        })
      );

      await revertTransactionToProjectedAction("txn-1");

      expect(incomeOverrides("inc-1")).toEqual({
        "inc-1_2026-03": { scheduledDate: "2026-03-02" },
      });
      expect(balance()).toBe(10_000);
    });

    it("clamps the pattern date to the end of a short month before comparing", async () => {
      seedUser({ currentBalance: 8_800 });
      seedRule(makeExpenseRule({ frequency: "monthly", startDate: "2026-01-31" }));
      seedStoredOccurrence({ scheduledDate: "2026-02-28", occurrenceId: "exp-1_2026-02" });

      await revertTransactionToProjectedAction("txn-1");

      // Day 31 clamps to 28 in February 2026, which is where the row already
      // sits — nothing custom to preserve.
      expect(ruleOverrides("exp-1")).toBeUndefined();
    });

    it("writes no override for a daily occurrence sitting on the date in its id", async () => {
      seedUser({ currentBalance: 9_988 });
      seedRule(makeExpenseRule({ frequency: "daily", amount: 12, startDate: "2026-03-01" }));
      seedStoredOccurrence({
        scheduledDate: "2026-03-15",
        occurrenceId: "exp-1_2026-03-15",
        projectedAmount: 12,
        actualAmount: 12,
      });

      await revertTransactionToProjectedAction("txn-1");

      expect(ruleOverrides("exp-1")).toBeUndefined();
    });

    it("writes an override for a daily occurrence moved off the date in its id", async () => {
      seedUser({ currentBalance: 9_988 });
      seedRule(makeExpenseRule({ frequency: "daily", amount: 12, startDate: "2026-03-01" }));
      seedStoredOccurrence({
        scheduledDate: "2026-03-18",
        occurrenceId: "exp-1_2026-03-15",
        projectedAmount: 12,
        actualAmount: 12,
      });

      await revertTransactionToProjectedAction("txn-1");

      expect(ruleOverrides("exp-1")).toEqual({
        "exp-1_2026-03-15": { scheduledDate: "2026-03-18" },
      });
    });

    it("returns without an override when the row has no occurrence id", async () => {
      seedUser({ currentBalance: 8_800 });
      seedRule(makeExpenseRule({ frequency: "monthly", startDate: "2026-01-10" }));
      seedStoredOccurrence({ scheduledDate: "2026-03-18" });

      await revertTransactionToProjectedAction("txn-1");

      expect(ruleOverrides("exp-1")).toBeUndefined();
      expect(store.__opsFor("expense_rules")).toEqual([]);
      expect(rows()).toEqual([]);
    });

    it("returns without throwing when the source has already been deleted", async () => {
      seedUser({ currentBalance: 8_800 });
      seedStoredOccurrence({ scheduledDate: "2026-03-18", occurrenceId: "exp-1_2026-03" });

      await revertTransactionToProjectedAction("txn-1");

      expect(rows()).toEqual([]);
      expect(balance()).toBe(10_000);
      expect(store.__count("expense_rules")).toBe(0);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT (transactionActions.ts:414-447):
     * `getExpectedDateFromOccurrenceId` only understands monthly and daily
     * occurrence ids and returns null for everything else, and a null
     * expected date means no override is written. So reverting a weekly
     * occurrence the user had dragged to a different day silently loses the
     * custom date — the projection snaps back to the pattern.
     * CORRECT: preserve the stored date for every frequency.
     */
    it.fails(
      "KNOWN DEFECT: preserves the custom date of a reverted weekly occurrence",
      async () => {
        seedUser({ currentBalance: 8_800 });
        seedRule(
          makeExpenseRule({
            frequency: "weekly",
            startDate: "2026-01-05",
            scheduleConfig: { dayOfWeek: 1 },
          })
        );
        // ISO week 11 of 2026 is Mon 2026-03-09..Sun 2026-03-15; the Monday
        // pattern puts this occurrence on the 9th and the user moved it to the 11th.
        seedStoredOccurrence({ scheduledDate: "2026-03-11", occurrenceId: "exp-1_2026-W11" });

        await revertTransactionToProjectedAction("txn-1");

        expect(ruleOverrides("exp-1")).toEqual({
          "exp-1_2026-W11": { scheduledDate: "2026-03-11" },
        });
      }
    );

    /**
     * DEFECT (same helper): bi-weekly ids ("_BW7") carry no date either, so
     * the custom date is dropped just as silently.
     * CORRECT: preserve the stored date.
     */
    it.fails(
      "KNOWN DEFECT: preserves the custom date of a reverted bi-weekly occurrence",
      async () => {
        seedUser({ currentBalance: 8_800 });
        seedRule(makeExpenseRule({ frequency: "bi-weekly", startDate: "2026-01-01" }));
        // BW7 = start + 6 * 14 days = 2026-03-26; the user pulled it forward to the 20th.
        seedStoredOccurrence({ scheduledDate: "2026-03-20", occurrenceId: "exp-1_BW7" });

        await revertTransactionToProjectedAction("txn-1");

        expect(ruleOverrides("exp-1")).toEqual({
          "exp-1_BW7": { scheduledDate: "2026-03-20" },
        });
      }
    );

    /**
     * DEFECT (transactionActions.ts:432): the expected monthly date is
     * reconstructed from `source.startDate`'s day-of-month and ignores
     * `scheduleConfig.dayOfMonth`, which is what the occurrence calculator
     * actually uses (occurrenceCalculator.ts:131). A rule that starts on the
     * 5th but bills on the 20th therefore looks "moved" on every single
     * occurrence, and a spurious override is written on each revert — pinning
     * dates that the pattern would have produced anyway and defeating any
     * later change to dayOfMonth.
     * CORRECT: no override, the row sits exactly where the pattern puts it.
     */
    it.fails(
      "KNOWN DEFECT: compares against scheduleConfig.dayOfMonth rather than the start date's day",
      async () => {
        seedUser({ currentBalance: 8_800 });
        seedRule(
          makeExpenseRule({
            frequency: "monthly",
            startDate: "2026-01-05",
            scheduleConfig: { dayOfMonth: 20 },
          })
        );
        seedStoredOccurrence({ scheduledDate: "2026-03-20", occurrenceId: "exp-1_2026-03" });

        await revertTransactionToProjectedAction("txn-1");

        expect(ruleOverrides("exp-1")).toBeUndefined();
      }
    );
  });
});
