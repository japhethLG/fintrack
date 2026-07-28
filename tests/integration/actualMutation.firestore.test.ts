import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => import("../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../helpers/firebaseConfigMock"));

import type { ExpenseRule, IncomeSource, Transaction, UserProfile } from "@/lib/types";
import {
  addTransaction,
  addTransactionsBatch,
  completeTransaction,
  deleteTransaction,
  deleteTransactionsBySource,
  getTransactions,
  revertToProjected,
  skipTransaction,
  subscribeToStoredTransactions,
  subscribeToTransactions,
  updateTransaction,
} from "@/lib/firebase/firestore/transactions";
import {
  createUserProfile,
  deleteUserProfile,
  getUserProfile,
  updateUserProfile,
} from "@/lib/firebase/firestore/users";
import {
  removeExpenseRuleOverride,
  setExpenseRuleOverride,
  updateLoanBalance,
} from "@/lib/firebase/firestore/expenseRules";
import {
  removeIncomeSourceOverride,
  setIncomeSourceOverride,
} from "@/lib/firebase/firestore/incomeSources";
import * as store from "../helpers/firestoreEmulator";
import {
  makeCompletedTransaction,
  makeCreditRule,
  makeExpenseRule,
  makeIncomeSource,
  makeInstallmentRule,
  makeLoanRule,
  makeManualTransaction,
  makePaymentBreakdown,
  makeProjectedTransaction,
  makeSkippedTransaction,
  makeTransaction,
  makeUserProfile,
} from "../helpers/builders";
import { d } from "../helpers/dates";
import { freezeToday } from "../helpers/time";

/**
 * THEME: what happens to persisted state and to the user's balance when an
 * ACTUAL is recorded, re-recorded, changed, or undone.
 *
 * Every path in `completeTransaction` / `skipTransaction` / `revertToProjected`
 * either moves the user's money or fails to, so each test pins BOTH sides:
 * the persisted transaction document AND the persisted user balance. The real
 * repo code under `app/lib/firebase/firestore/` runs against the in-memory
 * firestore emulator — nothing in the mutation path is stubbed.
 *
 * The load-bearing invariant is the reversal contract: re-recording an actual
 * must reverse the previous impact before applying the new one, so the net
 * movement is (new - old) and never (new).
 */

// ============================================================================
// LOCAL HELPERS
//
// Gaps in tests/helpers/builders.ts covered here:
//   - `makeCompletedTransaction` always fills in `actualAmount` (defaulting it
//     to `projectedAmount`), so there is no builder for the "completed but no
//     actual amount recorded" shape that every `actualAmount ?? projectedAmount`
//     reversal fallback depends on.
//   - there is no helper for reading the persisted user balance / doc back out.
// ============================================================================

const USER = "user-1";
const TODAY = "2026-02-10";

/** A completed transaction with NO `actualAmount` — exercises the fallback. */
const completedWithoutActual = (overrides: Partial<Transaction> = {}): Transaction =>
  makeTransaction({
    status: "completed",
    scheduledDate: overrides.scheduledDate ?? "2026-01-15",
    actualDate: overrides.actualDate ?? overrides.scheduledDate ?? "2026-01-15",
    ...overrides,
  });

/** Seed the user profile with a known starting balance. */
const seedUser = (currentBalance: number): void => {
  store.__seed("users", USER, makeUserProfile({ currentBalance }) as unknown as UserProfile);
};

/** Persisted balance, read straight out of the store (not via the repo). */
const balance = (): number => store.__get<UserProfile>("users", USER)!.currentBalance;

/** Persisted transaction document, failing loudly if absent. */
const storedTxn = (id: string): Transaction => {
  const found = store.__get<Transaction>("transactions", id);
  if (!found) throw new Error(`expected transactions/${id} to exist`);
  return found;
};

/** Persisted expense rule document, failing loudly if absent. */
const storedRule = (id: string): ExpenseRule => {
  const found = store.__get<ExpenseRule>("expense_rules", id);
  if (!found) throw new Error(`expected expense_rules/${id} to exist`);
  return found;
};

/** Persisted income source document, failing loudly if absent. */
const storedSource = (id: string): IncomeSource => {
  const found = store.__get<IncomeSource>("income_sources", id);
  if (!found) throw new Error(`expected income_sources/${id} to exist`);
  return found;
};

/** Millis out of anything Timestamp-shaped, without importing the mocked SDK. */
const millis = (value: unknown): number => (value as { toMillis(): number }).toMillis();

/** The `currentBalance` written by each balance write, in order. */
const balanceWrites = (): number[] =>
  store
    .__opsFor("users")
    .filter((entry) => entry.op === "update")
    .map((entry) => (entry.data as { currentBalance: number }).currentBalance);

beforeEach(() => {
  store.__reset();
  freezeToday(TODAY);
});

// ============================================================================
// completeTransaction
// ============================================================================

describe("completeTransaction", () => {
  describe("first completion", () => {
    it("stamps status, actual amount, variance, actual date and completedAt", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", projectedAmount: 100, scheduledDate: "2026-01-15" }),
      ]);

      await completeTransaction("t1", 120);

      const stored = storedTxn("t1");
      expect(stored.status).toBe("completed");
      expect(stored.actualAmount).toBe(120);
      expect(stored.variance).toBe(20);
      expect(stored.actualDate).toBe("2026-01-15");
      expect(millis(stored.completedAt)).toBe(d(TODAY).getTime());
    });

    it("defaults actualDate to the scheduled date when none is supplied", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", scheduledDate: "2026-01-15" }),
      ]);

      await completeTransaction("t1", 100);

      expect(storedTxn("t1").actualDate).toBe("2026-01-15");
    });

    it("uses a supplied actualDate instead of the scheduled date", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", scheduledDate: "2026-01-15" }),
      ]);

      await completeTransaction("t1", 100, "2026-01-18");

      const stored = storedTxn("t1");
      expect(stored.actualDate).toBe("2026-01-18");
      // the schedule itself is never rewritten — only the actual date moves
      expect(stored.scheduledDate).toBe("2026-01-15");
    });

    it("decreases the persisted balance by the actual amount for an expense", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", type: "expense", projectedAmount: 100 }),
      ]);

      await completeTransaction("t1", 250);

      expect(balance()).toBe(750);
    });

    it("increases the persisted balance by the actual amount for income", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({
          id: "t1",
          type: "income",
          sourceType: "income_source",
          sourceId: "inc-1",
          projectedAmount: 100,
        }),
      ]);

      await completeTransaction("t1", 250);

      expect(balance()).toBe(1_250);
    });

    it("stamps balanceLastUpdatedAt with today when it moves the balance", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [makeProjectedTransaction({ id: "t1" })]);

      await completeTransaction("t1", 100);

      expect(store.__get<UserProfile>("users", USER)!.balanceLastUpdatedAt).toBe(TODAY);
    });

    it("records a positive variance when an expense comes in above projection", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", type: "expense", projectedAmount: 100 }),
      ]);

      await completeTransaction("t1", 130);

      // overspend is positive: 130 actual - 100 projected
      expect(storedTxn("t1").variance).toBe(30);
    });

    it("records a negative variance when an expense comes in below projection", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", type: "expense", projectedAmount: 100 }),
      ]);

      await completeTransaction("t1", 80);

      expect(storedTxn("t1").variance).toBe(-20);
    });

    it("moves the balance exactly once", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [makeProjectedTransaction({ id: "t1" })]);

      await completeTransaction("t1", 100);

      expect(balanceWrites()).toEqual([900]);
    });

    it("writes a supplied note", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", notes: "old note" }),
      ]);

      await completeTransaction("t1", 100, undefined, "paid in cash");

      expect(storedTxn("t1").notes).toBe("paid in cash");
    });

    it("preserves the existing note when no note is supplied", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", notes: "old note" }),
      ]);

      await completeTransaction("t1", 100);

      expect(storedTxn("t1").notes).toBe("old note");
    });

    it("leaves the notes field absent when there was no note and none is supplied", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [makeProjectedTransaction({ id: "t1" })]);

      await completeTransaction("t1", 100);

      // `notes || transaction.notes` is undefined, and removeUndefined drops it
      expect("notes" in storedTxn("t1")).toBe(false);
    });

    it("throws when the transaction does not exist", async () => {
      seedUser(1_000);

      await expect(completeTransaction("missing", 100)).rejects.toThrow("Transaction not found");
    });

    it("does not touch the balance when the transaction does not exist", async () => {
      seedUser(1_000);

      await expect(completeTransaction("missing", 100)).rejects.toThrow();
      expect(balance()).toBe(1_000);
      expect(balanceWrites()).toEqual([]);
    });
  });

  describe("re-completion", () => {
    it("reverses the old expense actual before applying the new one", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", type: "expense", projectedAmount: 100 }),
      ]);

      await completeTransaction("t1", 100);
      expect(balance()).toBe(900);

      await completeTransaction("t1", 250);

      // net movement is (250 - 100) = 150, so 900 - 150 = 750 (NOT 900 - 250 = 650)
      expect(balance()).toBe(750);
    });

    it("reverses the old income actual before applying the new one", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({
          id: "t1",
          type: "income",
          sourceType: "income_source",
          sourceId: "inc-1",
          projectedAmount: 100,
        }),
      ]);

      await completeTransaction("t1", 100);
      expect(balance()).toBe(1_100);

      await completeTransaction("t1", 250);

      // net movement is +(250 - 100) = +150, so 1_100 + 150 = 1_250
      expect(balance()).toBe(1_250);
    });

    it("performs two balance adjustments — a reversal and an application", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", type: "expense", projectedAmount: 100 }),
      ]);

      await completeTransaction("t1", 100);
      const writesAfterFirst = balanceWrites().length;

      await completeTransaction("t1", 250);

      // 1_000 restored by the reversal, then 750 after applying the new actual
      expect(balanceWrites().slice(writesAfterFirst)).toEqual([1_000, 750]);
    });

    it("reverses the projected amount when the previous completion had no actual amount", async () => {
      // balance already reflects a 100 expense having been applied
      seedUser(900);
      store.__seedEntities("transactions", [
        completedWithoutActual({ id: "t1", type: "expense", projectedAmount: 100 }),
      ]);

      await completeTransaction("t1", 250);

      // reversal uses projectedAmount (100): 900 + 100 = 1_000, then -250 = 750
      expect(balance()).toBe(750);
      expect(balanceWrites()).toEqual([1_000, 750]);
    });

    it("reverses the projected amount for income when the previous completion had no actual amount", async () => {
      seedUser(1_100);
      store.__seedEntities("transactions", [
        completedWithoutActual({
          id: "t1",
          type: "income",
          sourceType: "income_source",
          sourceId: "inc-1",
          projectedAmount: 100,
        }),
      ]);

      await completeTransaction("t1", 250);

      expect(balance()).toBe(1_250);
    });

    it("recomputes variance from the new actual against the ORIGINAL projected amount", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeCompletedTransaction({ id: "t1", projectedAmount: 100, actualAmount: 130 }),
      ]);

      await completeTransaction("t1", 90);

      const stored = storedTxn("t1");
      // variance is measured against projection (100), never against the old actual (130)
      expect(stored.variance).toBe(-10);
      expect(stored.projectedAmount).toBe(100);
      expect(stored.actualAmount).toBe(90);
    });

    it("re-stamps completedAt on re-completion", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeCompletedTransaction({ id: "t1", projectedAmount: 100, actualAmount: 100 }),
      ]);

      await completeTransaction("t1", 120);

      expect(millis(storedTxn("t1").completedAt)).toBe(d(TODAY).getTime());
    });

    it("leaves the balance unchanged when re-completed at the same amount", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", type: "expense", projectedAmount: 100 }),
      ]);

      await completeTransaction("t1", 100);
      await completeTransaction("t1", 100);

      expect(balance()).toBe(900);
    });

    it("applies only the new actual when the transaction was skipped rather than completed", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeSkippedTransaction({ id: "t1", type: "expense", projectedAmount: 100 }),
      ]);

      await completeTransaction("t1", 250);

      // a skipped row never moved the balance, so there is nothing to reverse
      expect(balance()).toBe(750);
      expect(balanceWrites()).toEqual([750]);
    });
  });

  describe("loan side effects", () => {
    const loanTxn = (overrides: Partial<Transaction> = {}): Transaction =>
      makeProjectedTransaction({
        id: "t-loan",
        name: "Car Loan",
        sourceType: "expense_rule",
        sourceId: "loan-1",
        type: "expense",
        projectedAmount: 565,
        paymentBreakdown: makePaymentBreakdown({ principalPaid: 400, interestPaid: 165 }),
        ...overrides,
      });

    it("reduces the loan balance by the principal portion and increments paymentsMade", async () => {
      seedUser(10_000);
      store.__seedEntities("expense_rules", [
        makeLoanRule({}, { currentBalance: 12_000, paymentsMade: 0 }),
      ]);
      store.__seedEntities("transactions", [loanTxn()]);

      await completeTransaction("t-loan", 565);

      const rule = storedRule("loan-1");
      // 12_000 - 400 principal (the 165 interest portion is not debt reduction)
      expect(rule.loanConfig!.currentBalance).toBe(11_600);
      expect(rule.loanConfig!.paymentsMade).toBe(1);
      expect(rule.isActive).toBe(true);
      expect(balance()).toBe(9_435);
    });

    it("floors the loan balance at zero when the principal exceeds what is left", async () => {
      seedUser(10_000);
      store.__seedEntities("expense_rules", [
        makeLoanRule({}, { currentBalance: 300, paymentsMade: 23 }),
      ]);
      store.__seedEntities("transactions", [loanTxn()]);

      await completeTransaction("t-loan", 565);

      const rule = storedRule("loan-1");
      // Math.max(0, 300 - 400) rather than a negative balance
      expect(rule.loanConfig!.currentBalance).toBe(0);
      expect(rule.loanConfig!.paymentsMade).toBe(24);
    });

    it("deactivates the rule once the loan balance reaches zero", async () => {
      seedUser(10_000);
      store.__seedEntities("expense_rules", [
        makeLoanRule({}, { currentBalance: 400, paymentsMade: 23 }),
      ]);
      store.__seedEntities("transactions", [loanTxn()]);

      await completeTransaction("t-loan", 565);

      const rule = storedRule("loan-1");
      expect(rule.loanConfig!.currentBalance).toBe(0);
      expect(rule.isActive).toBe(false);
    });

    it("does not advance the loan when the payment is for a different rule", async () => {
      seedUser(10_000);
      store.__seedEntities("expense_rules", [
        makeLoanRule({}, { currentBalance: 12_000, paymentsMade: 0 }),
        makeLoanRule({ id: "loan-2" }, { currentBalance: 8_000, paymentsMade: 4 }),
      ]);
      store.__seedEntities("transactions", [loanTxn()]);

      await completeTransaction("t-loan", 565);

      // only the rule named by sourceId is advanced
      const other = storedRule("loan-2");
      expect(other.loanConfig!.currentBalance).toBe(8_000);
      expect(other.loanConfig!.paymentsMade).toBe(4);
    });
  });

  describe("installment side effects", () => {
    const installmentTxn = (overrides: Partial<Transaction> = {}): Transaction =>
      makeProjectedTransaction({
        id: "t-inst",
        name: "Laptop BNPL",
        sourceType: "expense_rule",
        sourceId: "inst-1",
        type: "expense",
        projectedAmount: 200,
        ...overrides,
      });

    it("increments installmentsPaid when an installment is completed", async () => {
      seedUser(10_000);
      store.__seedEntities("expense_rules", [
        makeInstallmentRule({}, { installmentCount: 6, installmentsPaid: 2 }),
      ]);
      store.__seedEntities("transactions", [installmentTxn()]);

      await completeTransaction("t-inst", 200);

      const rule = storedRule("inst-1");
      expect(rule.installmentConfig!.installmentsPaid).toBe(3);
      expect(rule.isActive).toBe(true);
      expect(balance()).toBe(9_800);
    });

    it("advances the plan even without a payment breakdown on the transaction", async () => {
      seedUser(10_000);
      store.__seedEntities("expense_rules", [
        makeInstallmentRule({}, { installmentCount: 6, installmentsPaid: 0 }),
      ]);
      store.__seedEntities("transactions", [installmentTxn({ paymentBreakdown: undefined })]);

      await completeTransaction("t-inst", 200);

      expect(storedRule("inst-1").installmentConfig!.installmentsPaid).toBe(1);
    });

    it("deactivates the rule on the final installment", async () => {
      seedUser(10_000);
      store.__seedEntities("expense_rules", [
        makeInstallmentRule({}, { installmentCount: 6, installmentsPaid: 5 }),
      ]);
      store.__seedEntities("transactions", [installmentTxn()]);

      await completeTransaction("t-inst", 200);

      const rule = storedRule("inst-1");
      expect(rule.installmentConfig!.installmentsPaid).toBe(6);
      expect(rule.isActive).toBe(false);
    });

    it("keeps counting past the final installment without reactivating the rule", async () => {
      seedUser(10_000);
      store.__seedEntities("expense_rules", [
        makeInstallmentRule({}, { installmentCount: 6, installmentsPaid: 6 }),
      ]);
      store.__seedEntities("transactions", [installmentTxn()]);

      await completeTransaction("t-inst", 200);

      const rule = storedRule("inst-1");
      expect(rule.installmentConfig!.installmentsPaid).toBe(7);
      expect(rule.isActive).toBe(false);
    });
  });

  describe("manual and income transactions", () => {
    it("performs no rule updates for a manual transaction", async () => {
      seedUser(1_000);
      store.__seedEntities("expense_rules", [makeLoanRule()]);
      store.__seedEntities("transactions", [
        makeManualTransaction({ id: "t-man", type: "expense", projectedAmount: 100 }),
      ]);

      await completeTransaction("t-man", 100);

      expect(store.__opsFor("expense_rules")).toHaveLength(0);
      expect(storedRule("loan-1").loanConfig!.paymentsMade).toBe(0);
      expect(balance()).toBe(900);
    });

    it("performs no rule lookup for an income transaction with an expense-shaped id", async () => {
      seedUser(1_000);
      store.__seedEntities("expense_rules", [makeLoanRule()]);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({
          id: "t-inc",
          type: "income",
          sourceType: "income_source",
          sourceId: "loan-1",
          projectedAmount: 100,
        }),
      ]);

      await completeTransaction("t-inc", 100);

      expect(store.__opsFor("expense_rules")).toHaveLength(0);
      expect(balance()).toBe(1_100);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: `notes: notes || transaction.notes` (transactions.ts:174) treats an
     * empty string as "no note supplied", so a user can never clear an existing
     * note through the completion dialog — the old note is silently re-saved.
     * CORRECT: an explicitly supplied empty string should clear the note; only
     * `undefined` should mean "leave the note alone".
     */
    it.fails("KNOWN DEFECT: an empty note clears the existing note", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", notes: "old note" }),
      ]);

      await completeTransaction("t1", 100, undefined, "");

      expect(storedTxn("t1").notes).toBe("");
    });

    /**
     * DEFECT: the loan branch requires BOTH `rule.loanConfig` and
     * `transaction.paymentBreakdown` (transactions.ts:184), and the `else if`
     * means a loan rule with no breakdown falls through to nothing. The
     * projection path can emit breakdown-less rows (manual amount overrides,
     * rows created before the amortization schedule existed), so a loan payment
     * can be completed — cash leaves the account — without the loan advancing.
     * CORRECT: completing a loan payment must always advance the loan; with no
     * breakdown the whole payment should reduce principal at minimum, and
     * `paymentsMade` must increment either way.
     *
     * TODAY: the expense rule receives no write at all — `currentBalance` stays
     * at 12_000 and `paymentsMade` at 0 — while the user's cash still falls by
     * the full 565. The trailing balance assertion below is the half that must
     * survive a fix: the cash movement is correct, only the loan side is not.
     */
    it.fails(
      "KNOWN DEFECT: a loan payment without a payment breakdown still advances the loan",
      async () => {
        seedUser(10_000);
        store.__seedEntities("expense_rules", [
          makeLoanRule({}, { currentBalance: 12_000, paymentsMade: 0 }),
        ]);
        store.__seedEntities("transactions", [
          makeProjectedTransaction({
            id: "t-loan",
            sourceType: "expense_rule",
            sourceId: "loan-1",
            type: "expense",
            projectedAmount: 565,
          }),
        ]);

        await completeTransaction("t-loan", 565);

        expect(storedRule("loan-1").loanConfig!.paymentsMade).toBe(1);
        // the cash side is already right and must stay right
        expect(balance()).toBe(9_435);
      }
    );

    /**
     * DEFECT: `completeTransaction` has no branch for `creditConfig`
     * (transactions.ts:182-193) — only loans and installments are advanced. A
     * completed credit card payment therefore moves the user's cash but leaves
     * the card's `currentBalance` at its old value forever, so projected minimum
     * payments and the debt payoff view never improve.
     * CORRECT: the card balance should fall by the principal portion of the
     * payment (100 paid, 20 interest => 5_000 - 80 = 4_920).
     *
     * TODAY: `expense_rules` receives no write at all and the card stays at
     * 5_000, while the user's cash falls by the full 100. The trailing balance
     * assertion is the half that must survive a fix.
     */
    it.fails("KNOWN DEFECT: completing a card payment reduces the card balance", async () => {
      seedUser(10_000);
      store.__seedEntities("expense_rules", [makeCreditRule({}, { currentBalance: 5_000 })]);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({
          id: "t-card",
          sourceType: "expense_rule",
          sourceId: "card-1",
          type: "expense",
          projectedAmount: 100,
          paymentBreakdown: makePaymentBreakdown({ principalPaid: 80, interestPaid: 20 }),
        }),
      ]);

      await completeTransaction("t-card", 100);

      expect(storedRule("card-1").creditConfig!.currentBalance).toBe(4_920);
      // the cash side is already right and must stay right
      expect(balance()).toBe(9_900);
    });

    /**
     * DEFECT: the reversal contract at the top of `completeTransaction`
     * (transactions.ts:159-164) covers the user's cash balance only — the
     * loan/installment side effects at transactions.ts:181-193 run unconditionally
     * on every completion. Correcting a recorded actual (a re-completion) therefore
     * advances the loan a SECOND time: `paymentsMade` becomes 2 and the principal
     * is deducted twice, even though only one payment was ever made.
     * CORRECT: re-recording the same occurrence must leave the loan where a single
     * payment leaves it — paymentsMade 1, balance 12_000 - 400 = 11_600.
     *
     * TODAY: two completions of the same row leave paymentsMade at 2 and the
     * balance at 11_200 (400 deducted twice), even though the cash side nets
     * correctly to a single payment.
     */
    it.fails(
      "KNOWN DEFECT: re-completing a loan payment does not advance the loan a second time",
      async () => {
        seedUser(10_000);
        store.__seedEntities("expense_rules", [
          makeLoanRule({}, { currentBalance: 12_000, paymentsMade: 0 }),
        ]);
        store.__seedEntities("transactions", [
          makeProjectedTransaction({
            id: "t-loan",
            sourceType: "expense_rule",
            sourceId: "loan-1",
            type: "expense",
            projectedAmount: 565,
            paymentBreakdown: makePaymentBreakdown({ principalPaid: 400, interestPaid: 165 }),
          }),
        ]);

        await completeTransaction("t-loan", 565);
        await completeTransaction("t-loan", 565);

        const rule = storedRule("loan-1");
        expect(rule.loanConfig!.paymentsMade).toBe(1);
        expect(rule.loanConfig!.currentBalance).toBe(11_600);
      }
    );
  });
});

// ============================================================================
// skipTransaction
// ============================================================================

describe("skipTransaction", () => {
  describe("from projected", () => {
    it("changes the status to skipped", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [makeProjectedTransaction({ id: "t1" })]);

      await skipTransaction("t1");

      expect(storedTxn("t1").status).toBe("skipped");
    });

    it("leaves the balance untouched", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [makeProjectedTransaction({ id: "t1" })]);

      await skipTransaction("t1");

      expect(balance()).toBe(1_000);
      expect(balanceWrites()).toEqual([]);
    });

    it("writes a supplied note", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [makeProjectedTransaction({ id: "t1" })]);

      await skipTransaction("t1", "not needed this month");

      expect(storedTxn("t1").notes).toBe("not needed this month");
    });

    it("throws when the transaction does not exist", async () => {
      seedUser(1_000);

      await expect(skipTransaction("missing")).rejects.toThrow("Transaction not found");
    });
  });

  describe("from completed", () => {
    it("reverses the expense impact on the balance", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", type: "expense", projectedAmount: 100 }),
      ]);

      await completeTransaction("t1", 250);
      expect(balance()).toBe(750);

      await skipTransaction("t1");

      // the 250 expense is given back in full
      expect(balance()).toBe(1_000);
      expect(storedTxn("t1").status).toBe("skipped");
    });

    it("reverses the income impact on the balance", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({
          id: "t1",
          type: "income",
          sourceType: "income_source",
          sourceId: "inc-1",
          projectedAmount: 100,
        }),
      ]);

      await completeTransaction("t1", 250);
      expect(balance()).toBe(1_250);

      await skipTransaction("t1");

      expect(balance()).toBe(1_000);
    });

    it("reverses the projected amount when no actual amount was recorded", async () => {
      seedUser(900);
      store.__seedEntities("transactions", [
        completedWithoutActual({ id: "t1", type: "expense", projectedAmount: 100 }),
      ]);

      await skipTransaction("t1");

      expect(balance()).toBe(1_000);
      expect(balanceWrites()).toEqual([1_000]);
    });

    it("reverses exactly once", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeCompletedTransaction({ id: "t1", projectedAmount: 100, actualAmount: 100 }),
      ]);

      await skipTransaction("t1");

      expect(balanceWrites()).toEqual([1_100]);
    });

    it("does not reverse a second time when an already-skipped row is skipped again", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeCompletedTransaction({ id: "t1", projectedAmount: 100, actualAmount: 100 }),
      ]);

      await skipTransaction("t1");
      await skipTransaction("t1");

      expect(balance()).toBe(1_100);
      expect(balanceWrites()).toEqual([1_100]);
    });

    it("leaves the stale actualAmount and variance on the skipped document", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeCompletedTransaction({ id: "t1", projectedAmount: 100, actualAmount: 130 }),
      ]);

      await skipTransaction("t1");

      // skipTransaction only rewrites status/notes, so the old actual survives;
      // consumers must key off `status`, never off the presence of actualAmount
      const stored = storedTxn("t1");
      expect(stored.status).toBe("skipped");
      expect(stored.actualAmount).toBe(130);
      expect(stored.variance).toBe(30);
    });

    it("does not roll back loan counters advanced by the completion", async () => {
      seedUser(10_000);
      store.__seedEntities("expense_rules", [
        makeLoanRule({}, { currentBalance: 12_000, paymentsMade: 0 }),
      ]);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({
          id: "t-loan",
          sourceType: "expense_rule",
          sourceId: "loan-1",
          type: "expense",
          projectedAmount: 565,
          paymentBreakdown: makePaymentBreakdown({ principalPaid: 400, interestPaid: 165 }),
        }),
      ]);

      await completeTransaction("t-loan", 565);
      await skipTransaction("t-loan");

      // cash is restored...
      expect(balance()).toBe(10_000);
      // ...but the loan still thinks a payment was made (only revertToProjected
      // decrements the counter)
      const rule = storedRule("loan-1");
      expect(rule.loanConfig!.paymentsMade).toBe(1);
      expect(rule.loanConfig!.currentBalance).toBe(11_600);
    });
  });

  describe("note handling", () => {
    it("preserves an existing note when no note is supplied", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", notes: "old note" }),
      ]);

      await skipTransaction("t1");

      // skipTransaction passes `notes` straight through (unlike completeTransaction,
      // which falls back to the old note), but removeUndefined in updateTransaction
      // strips the undefined key, so the old note survives anyway
      expect(storedTxn("t1").notes).toBe("old note");
    });

    it("clears an existing note when an empty note is supplied", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "t1", notes: "old note" }),
      ]);

      await skipTransaction("t1", "");

      // INCONSISTENCY: an empty string clears the note here, but the same empty
      // string is ignored by completeTransaction (`notes || transaction.notes`)
      expect(storedTxn("t1").notes).toBe("");
    });
  });
});

// ============================================================================
// revertToProjected
// ============================================================================

describe("revertToProjected", () => {
  describe("guards", () => {
    it("throws for a manual transaction", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [makeManualTransaction({ id: "t1" })]);

      await expect(revertToProjected("t1")).rejects.toThrow(
        "Manual transactions cannot be reverted to projected"
      );
      expect(store.__count("transactions")).toBe(1);
    });

    it("throws for a rule-based transaction with no sourceId", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeTransaction({ id: "t1", sourceType: "expense_rule", sourceId: undefined }),
      ]);

      await expect(revertToProjected("t1")).rejects.toThrow(
        "Transaction has no source to revert to"
      );
      expect(store.__count("transactions")).toBe(1);
    });

    it("throws when the transaction does not exist", async () => {
      seedUser(1_000);

      await expect(revertToProjected("missing")).rejects.toThrow("Transaction not found");
    });
  });

  describe("from completed", () => {
    it("reverses the expense impact, deletes the document and returns the revert data", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeCompletedTransaction({
          id: "t1",
          sourceType: "expense_rule",
          sourceId: "exp-1",
          occurrenceId: "exp-1::2026-01-15",
          type: "expense",
          projectedAmount: 100,
          actualAmount: 250,
          scheduledDate: "2026-01-15",
        }),
      ]);

      const result = await revertToProjected("t1");

      expect(balance()).toBe(1_250);
      expect(store.__count("transactions")).toBe(0);
      expect(result).toEqual({
        scheduledDate: "2026-01-15",
        sourceId: "exp-1",
        sourceType: "expense_rule",
        occurrenceId: "exp-1::2026-01-15",
      });
    });

    it("reverses the income impact", async () => {
      seedUser(1_250);
      store.__seedEntities("transactions", [
        makeCompletedTransaction({
          id: "t1",
          sourceType: "income_source",
          sourceId: "inc-1",
          type: "income",
          projectedAmount: 100,
          actualAmount: 250,
        }),
      ]);

      await revertToProjected("t1");

      expect(balance()).toBe(1_000);
      expect(store.__count("transactions")).toBe(0);
    });

    it("reverses the projected amount when no actual amount was recorded", async () => {
      seedUser(900);
      store.__seedEntities("transactions", [
        completedWithoutActual({
          id: "t1",
          sourceType: "expense_rule",
          sourceId: "exp-1",
          type: "expense",
          projectedAmount: 100,
        }),
      ]);

      await revertToProjected("t1");

      expect(balance()).toBe(1_000);
      expect(balanceWrites()).toEqual([1_000]);
    });

    it("returns revert data without an occurrenceId when the row had none", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeCompletedTransaction({
          id: "t1",
          sourceType: "income_source",
          sourceId: "inc-1",
          type: "income",
          projectedAmount: 100,
          actualAmount: 100,
          scheduledDate: "2026-01-15",
        }),
      ]);

      const result = await revertToProjected("t1");

      expect(result!.occurrenceId).toBeUndefined();
      expect(result!.sourceType).toBe("income_source");
    });
  });

  describe("from skipped", () => {
    it("deletes the document without touching the balance", async () => {
      seedUser(1_000);
      store.__seedEntities("transactions", [
        makeSkippedTransaction({ id: "t1", sourceType: "expense_rule", sourceId: "exp-1" }),
      ]);

      const result = await revertToProjected("t1");

      expect(balance()).toBe(1_000);
      expect(balanceWrites()).toEqual([]);
      expect(store.__count("transactions")).toBe(0);
      expect(result!.sourceId).toBe("exp-1");
    });

    it("does not decrement loan counters for a skipped row", async () => {
      seedUser(1_000);
      store.__seedEntities("expense_rules", [makeLoanRule({}, { paymentsMade: 3 })]);
      store.__seedEntities("transactions", [
        makeSkippedTransaction({ id: "t1", sourceType: "expense_rule", sourceId: "loan-1" }),
      ]);

      await revertToProjected("t1");

      expect(storedRule("loan-1").loanConfig!.paymentsMade).toBe(3);
      expect(store.__opsFor("expense_rules")).toHaveLength(0);
    });
  });

  describe("loan counter decrement", () => {
    const completedLoanTxn = (overrides: Partial<Transaction> = {}): Transaction =>
      makeCompletedTransaction({
        id: "t-loan",
        sourceType: "expense_rule",
        sourceId: "loan-1",
        type: "expense",
        projectedAmount: 565,
        actualAmount: 565,
        paymentBreakdown: makePaymentBreakdown({ principalPaid: 400, interestPaid: 165 }),
        ...overrides,
      });

    it("decrements paymentsMade when reverting a completed loan payment", async () => {
      seedUser(9_435);
      store.__seedEntities("expense_rules", [
        makeLoanRule({}, { currentBalance: 11_600, paymentsMade: 1 }),
      ]);
      store.__seedEntities("transactions", [completedLoanTxn()]);

      await revertToProjected("t-loan");

      expect(storedRule("loan-1").loanConfig!.paymentsMade).toBe(0);
      expect(balance()).toBe(10_000);
    });

    it("does not underflow paymentsMade below zero", async () => {
      seedUser(9_435);
      store.__seedEntities("expense_rules", [
        makeLoanRule({}, { currentBalance: 12_000, paymentsMade: 0 }),
      ]);
      store.__seedEntities("transactions", [completedLoanTxn()]);

      await revertToProjected("t-loan");

      // the `paymentsMade > 0` guard means no decrement is attempted at all
      expect(storedRule("loan-1").loanConfig!.paymentsMade).toBe(0);
      // the cash reversal still happens
      expect(balance()).toBe(10_000);
    });
  });

  describe("installment counter decrement", () => {
    const completedInstallmentTxn = (overrides: Partial<Transaction> = {}): Transaction =>
      makeCompletedTransaction({
        id: "t-inst",
        sourceType: "expense_rule",
        sourceId: "inst-1",
        type: "expense",
        projectedAmount: 200,
        actualAmount: 200,
        ...overrides,
      });

    it("decrements installmentsPaid when reverting a completed installment", async () => {
      seedUser(9_800);
      store.__seedEntities("expense_rules", [
        makeInstallmentRule({}, { installmentCount: 6, installmentsPaid: 3 }),
      ]);
      store.__seedEntities("transactions", [completedInstallmentTxn()]);

      await revertToProjected("t-inst");

      expect(storedRule("inst-1").installmentConfig!.installmentsPaid).toBe(2);
      expect(balance()).toBe(10_000);
    });

    it("does not underflow installmentsPaid below zero", async () => {
      seedUser(9_800);
      store.__seedEntities("expense_rules", [
        makeInstallmentRule({}, { installmentCount: 6, installmentsPaid: 0 }),
      ]);
      store.__seedEntities("transactions", [completedInstallmentTxn()]);

      await revertToProjected("t-inst");

      // the `installmentsPaid > 0` guard means no decrement is attempted at all
      expect(storedRule("inst-1").installmentConfig!.installmentsPaid).toBe(0);
      expect(balance()).toBe(10_000);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: `revertToProjected` decrements `loanConfig.paymentsMade` but never
     * restores `loanConfig.currentBalance` (transactions.ts:250-256), while
     * `updateLoanBalance` (expenseRules.ts:125) reduced it on completion. Every
     * complete -> revert -> complete cycle therefore permanently erodes the
     * outstanding loan balance by one principal portion.
     * CORRECT: after complete -> revert -> complete, exactly one payment's
     * principal should have been applied: 12_000 - 400 = 11_600.
     *
     * TODAY: the revert rewinds `paymentsMade` but leaves `currentBalance`
     * exactly where the completion left it (11_600 stays 11_600), so the second
     * completion drops it to 11_200 — one payment recorded, two deducted. The
     * cash reversal itself is correct and unaffected by a fix.
     */
    it.fails(
      "KNOWN DEFECT: complete -> revert -> complete leaves the loan balance down by one payment, not two",
      async () => {
        seedUser(10_000);
        store.__seedEntities("expense_rules", [
          makeLoanRule({}, { currentBalance: 12_000, paymentsMade: 0 }),
        ]);
        const txn = makeProjectedTransaction({
          id: "t-loan",
          sourceType: "expense_rule",
          sourceId: "loan-1",
          type: "expense",
          projectedAmount: 565,
          paymentBreakdown: makePaymentBreakdown({ principalPaid: 400, interestPaid: 165 }),
        });
        store.__seedEntities("transactions", [txn]);

        await completeTransaction("t-loan", 565);
        await revertToProjected("t-loan");
        // the revert deletes the stored row; the projection regenerates it
        store.__seedEntities("transactions", [txn]);
        await completeTransaction("t-loan", 565);

        expect(storedRule("loan-1").loanConfig!.paymentsMade).toBe(1);
        expect(storedRule("loan-1").loanConfig!.currentBalance).toBe(11_600);
      }
    );

    /**
     * DEFECT: the decrement on revert is guarded only by `paymentsMade > 0`
     * (transactions.ts:250) — it does not check whether THIS transaction ever
     * incremented the counter. Completing a breakdown-less loan payment leaves
     * `paymentsMade` alone (see the completeTransaction defect above), but
     * reverting it still subtracts one, silently rewinding an unrelated payment.
     * CORRECT: reverting a completion that never advanced the counter must leave
     * it at 3.
     */
    it.fails(
      "KNOWN DEFECT: reverting a breakdown-less loan payment does not rewind an unrelated payment",
      async () => {
        seedUser(10_000);
        store.__seedEntities("expense_rules", [
          makeLoanRule({}, { currentBalance: 11_000, paymentsMade: 3 }),
        ]);
        store.__seedEntities("transactions", [
          makeProjectedTransaction({
            id: "t-loan",
            sourceType: "expense_rule",
            sourceId: "loan-1",
            type: "expense",
            projectedAmount: 565,
          }),
        ]);

        await completeTransaction("t-loan", 565);
        await revertToProjected("t-loan");

        expect(storedRule("loan-1").loanConfig!.paymentsMade).toBe(3);
      }
    );

    /**
     * DEFECT: `updateInstallmentProgress` sets `isActive: false` on the final
     * installment (expenseRules.ts:165), but the revert path only rewinds
     * `installmentsPaid` and never re-evaluates `isActive`
     * (transactions.ts:257-263). Undoing the final payment leaves the plan
     * deactivated, so the outstanding installment stops being projected at all.
     * CORRECT: with 5 of 6 paid again, the rule must be active.
     */
    it.fails("KNOWN DEFECT: reverting the final installment reactivates the plan", async () => {
      seedUser(10_000);
      store.__seedEntities("expense_rules", [
        makeInstallmentRule({}, { installmentCount: 6, installmentsPaid: 5 }),
      ]);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({
          id: "t-inst",
          sourceType: "expense_rule",
          sourceId: "inst-1",
          type: "expense",
          projectedAmount: 200,
        }),
      ]);

      await completeTransaction("t-inst", 200);
      await revertToProjected("t-inst");

      const rule = storedRule("inst-1");
      expect(rule.installmentConfig!.installmentsPaid).toBe(5);
      expect(rule.isActive).toBe(true);
    });
  });
});

// ============================================================================
// addTransaction / updateTransaction / deleteTransaction
// ============================================================================

describe("addTransaction", () => {
  const input = (overrides: Record<string, unknown> = {}) =>
    ({
      sourceType: "manual",
      name: "Groceries",
      type: "expense",
      category: "food",
      projectedAmount: 0,
      scheduledDate: "2026-02-01",
      status: "projected",
      ...overrides,
    }) as unknown as Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">;

  it("strips undefined fields before writing while keeping null, zero and empty string", async () => {
    const created = await addTransaction(
      USER,
      input({
        actualAmount: undefined,
        variance: undefined,
        notes: "",
        projectedAmount: 0,
        attachments: null,
      })
    );

    const stored = storedTxn(created.id);
    // Firestore rejects undefined, so the keys must be absent rather than null
    expect("actualAmount" in stored).toBe(false);
    expect("variance" in stored).toBe(false);
    expect(stored.notes).toBe("");
    expect(stored.projectedAmount).toBe(0);
    expect(stored.attachments).toBeNull();
  });

  it("returns the full entity including the generated id and the echoed input", async () => {
    const created = await addTransaction(USER, input({ notes: "weekly shop" }));

    expect(created.id).toBe("auto-1");
    expect(created.userId).toBe(USER);
    expect(created.name).toBe("Groceries");
    expect(created.type).toBe("expense");
    expect(created.scheduledDate).toBe("2026-02-01");
    expect(created.notes).toBe("weekly shop");
    expect(millis(created.createdAt)).toBe(d(TODAY).getTime());
    expect(millis(created.updatedAt)).toBe(d(TODAY).getTime());
  });

  it("stamps the owning userId and createdAt/updatedAt on the stored document", async () => {
    const created = await addTransaction(USER, input());

    const stored = storedTxn(created.id);
    expect(stored.userId).toBe(USER);
    expect(millis(stored.createdAt)).toBe(d(TODAY).getTime());
    expect(millis(stored.updatedAt)).toBe(d(TODAY).getTime());
  });

  it("does not touch the user balance", async () => {
    seedUser(1_000);

    await addTransaction(USER, input({ status: "completed", actualAmount: 100 }));

    // adding a completed transaction directly bypasses the balance adjustment —
    // only completeTransaction moves money
    expect(balance()).toBe(1_000);
    expect(balanceWrites()).toEqual([]);
  });
});

describe("updateTransaction", () => {
  it("throws when the document is missing", async () => {
    await expect(updateTransaction("missing", { status: "skipped" })).rejects.toThrow(
      "Transaction with ID missing does not exist"
    );
  });

  it("stamps updatedAt on every update", async () => {
    store.__seedEntities("transactions", [makeProjectedTransaction({ id: "t1" })]);

    await updateTransaction("t1", { status: "skipped" });

    const stored = storedTxn("t1");
    expect(stored.status).toBe("skipped");
    expect(millis(stored.updatedAt)).toBe(d(TODAY).getTime());
  });

  it("strips undefined fields so they cannot clear stored values", async () => {
    store.__seedEntities("transactions", [
      makeProjectedTransaction({ id: "t1", notes: "keep me" }),
    ]);

    await updateTransaction("t1", { notes: undefined, actualAmount: 50 });

    const stored = storedTxn("t1");
    expect(stored.notes).toBe("keep me");
    expect(stored.actualAmount).toBe(50);
  });

  it("leaves untouched fields alone", async () => {
    store.__seedEntities("transactions", [
      makeProjectedTransaction({ id: "t1", projectedAmount: 100, scheduledDate: "2026-01-15" }),
    ]);

    await updateTransaction("t1", { actualAmount: 120 });

    const stored = storedTxn("t1");
    expect(stored.projectedAmount).toBe(100);
    expect(stored.scheduledDate).toBe("2026-01-15");
    expect(stored.status).toBe("projected");
  });
});

describe("deleteTransaction", () => {
  it("removes the document", async () => {
    store.__seedEntities("transactions", [
      makeProjectedTransaction({ id: "t1" }),
      makeProjectedTransaction({ id: "t2" }),
    ]);

    await deleteTransaction("t1");

    expect(store.__get("transactions", "t1")).toBeUndefined();
    expect(store.__count("transactions")).toBe(1);
  });

  it("does not touch the balance even for a completed transaction", async () => {
    seedUser(900);
    store.__seedEntities("transactions", [
      makeCompletedTransaction({ id: "t1", projectedAmount: 100, actualAmount: 100 }),
    ]);

    await deleteTransaction("t1");

    // a raw delete is NOT an undo — only revertToProjected reverses the impact
    expect(balance()).toBe(900);
  });
});

// ============================================================================
// addTransactionsBatch
//
// The batch path is what the projection materializer uses, so a partial write
// would leave the user looking at half a month. Atomicity is observable here as
// a SINGLE listener emission: the emulator's batch queues every write and
// notifies once on commit, exactly like the real SDK.
// ============================================================================

describe("addTransactionsBatch", () => {
  type TransactionInput = Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">;

  const batchInput = (overrides: Record<string, unknown> = {}): TransactionInput =>
    ({
      sourceType: "manual",
      name: "Row",
      type: "expense",
      category: "food",
      projectedAmount: 100,
      scheduledDate: "2026-02-01",
      status: "projected",
      ...overrides,
    }) as unknown as TransactionInput;

  it("writes every transaction in the list", async () => {
    await addTransactionsBatch(USER, [
      batchInput({ name: "One", scheduledDate: "2026-02-01" }),
      batchInput({ name: "Two", scheduledDate: "2026-02-02" }),
      batchInput({ name: "Three", scheduledDate: "2026-02-03" }),
    ]);

    expect(store.__count("transactions")).toBe(3);
    expect(store.__all<Transaction>("transactions").map((t) => t.name)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  });

  it("gives every row a distinct generated id", async () => {
    await addTransactionsBatch(USER, [batchInput(), batchInput(), batchInput()]);

    const ids = store.__all("transactions").map((t) => t.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("stamps the owning userId and createdAt/updatedAt on every row", async () => {
    await addTransactionsBatch(USER, [batchInput(), batchInput()]);

    store.__all<Transaction>("transactions").forEach((row) => {
      expect(row.userId).toBe(USER);
      expect(millis(row.createdAt)).toBe(d(TODAY).getTime());
      expect(millis(row.updatedAt)).toBe(d(TODAY).getTime());
    });
  });

  it("strips undefined fields from every row while keeping zero and empty string", async () => {
    await addTransactionsBatch(USER, [
      batchInput({
        actualAmount: undefined,
        variance: undefined,
        occurrenceId: undefined,
        notes: "",
        projectedAmount: 0,
      }),
    ]);

    const [stored] = store.__all<Transaction>("transactions");
    expect("actualAmount" in stored).toBe(false);
    expect("variance" in stored).toBe(false);
    expect("occurrenceId" in stored).toBe(false);
    expect(stored.notes).toBe("");
    expect(stored.projectedAmount).toBe(0);
  });

  it("commits atomically — nothing lands until one single commit", async () => {
    const seen: Transaction[][] = [];
    const unsubscribe = subscribeToStoredTransactions(USER, (rows) => seen.push(rows));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([]);

    await addTransactionsBatch(USER, [
      batchInput({ name: "One", scheduledDate: "2026-02-01" }),
      batchInput({ name: "Two", scheduledDate: "2026-02-02" }),
      batchInput({ name: "Three", scheduledDate: "2026-02-03" }),
    ]);

    // one emission for three rows: subscribers never observe a half-written batch
    expect(seen).toHaveLength(2);
    expect(seen[1]).toHaveLength(3);
    unsubscribe();
  });

  it("writes nothing for an empty list", async () => {
    await addTransactionsBatch(USER, []);

    expect(store.__count("transactions")).toBe(0);
    expect(store.__opsFor("transactions")).toEqual([]);
  });

  it("does not touch the user balance even for completed rows", async () => {
    seedUser(1_000);

    await addTransactionsBatch(USER, [
      batchInput({ status: "completed", actualAmount: 100 }),
      batchInput({ status: "completed", actualAmount: 200 }),
    ]);

    // like addTransaction, the batch path is a pure write — only
    // completeTransaction moves money
    expect(balance()).toBe(1_000);
    expect(balanceWrites()).toEqual([]);
  });
});

// ============================================================================
// deleteTransactionsBySource
//
// Called when a rule is deleted or its schedule changes: the stored rows for
// that source have to go, but rows belonging to other sources — and, with a
// status filter, actuals the user has already recorded — must survive.
// ============================================================================

describe("deleteTransactionsBySource", () => {
  const ids = (): string[] =>
    store
      .__all("transactions")
      .map((t) => t.id)
      .sort();

  beforeEach(() => {
    store.__seedEntities("transactions", [
      makeProjectedTransaction({ id: "e-proj", sourceId: "exp-1", scheduledDate: "2026-02-01" }),
      makeCompletedTransaction({
        id: "e-done",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        scheduledDate: "2026-02-02",
      }),
      makeSkippedTransaction({
        id: "e-skip",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        scheduledDate: "2026-02-03",
      }),
      // same sourceId, different sourceType — both constraints must apply
      makeCompletedTransaction({
        id: "i-same-id",
        sourceType: "income_source",
        sourceId: "exp-1",
        scheduledDate: "2026-02-04",
      }),
      // different sourceId, same sourceType
      makeCompletedTransaction({
        id: "e-other",
        sourceType: "expense_rule",
        sourceId: "exp-2",
        scheduledDate: "2026-02-05",
      }),
      makeManualTransaction({ id: "m-1", scheduledDate: "2026-02-06" }),
    ]);
  });

  it("deletes every row matching the source type and id, and nothing else", async () => {
    await deleteTransactionsBySource("expense_rule", "exp-1");

    expect(ids()).toEqual(["e-other", "i-same-id", "m-1"]);
  });

  it("honours a single-status filter, leaving other statuses in place", async () => {
    await deleteTransactionsBySource("expense_rule", "exp-1", ["completed"]);

    expect(ids()).toEqual(["e-other", "e-proj", "e-skip", "i-same-id", "m-1"]);
  });

  it("honours a multi-status filter", async () => {
    await deleteTransactionsBySource("expense_rule", "exp-1", ["projected", "skipped"]);

    // the recorded actual survives — deleting a rule must not erase history
    expect(ids()).toEqual(["e-done", "e-other", "i-same-id", "m-1"]);
  });

  it("deletes nothing when the status filter matches no row", async () => {
    store.__reset();
    freezeToday(TODAY);
    store.__seedEntities("transactions", [
      makeProjectedTransaction({ id: "e-proj", sourceId: "exp-1" }),
    ]);

    await deleteTransactionsBySource("expense_rule", "exp-1", ["completed"]);

    expect(ids()).toEqual(["e-proj"]);
    expect(store.__opsFor("transactions")).toEqual([]);
  });

  it("is a no-op when no row matches the source", async () => {
    await deleteTransactionsBySource("expense_rule", "does-not-exist");

    expect(store.__count("transactions")).toBe(6);
    expect(store.__opsFor("transactions")).toEqual([]);
  });

  it("does not touch the user balance for completed rows it deletes", async () => {
    seedUser(1_000);

    await deleteTransactionsBySource("expense_rule", "exp-1");

    // a source delete is not a revert: the recorded impact stays on the balance
    expect(balance()).toBe(1_000);
    expect(balanceWrites()).toEqual([]);
  });
});

// ============================================================================
// getTransactions
// ============================================================================

describe("getTransactions", () => {
  beforeEach(() => {
    store.__seedEntities("transactions", [
      makeProjectedTransaction({
        id: "a",
        scheduledDate: "2026-01-05",
        type: "expense",
        sourceId: "exp-1",
      }),
      makeCompletedTransaction({
        id: "b",
        scheduledDate: "2026-01-10",
        type: "income",
        sourceType: "income_source",
        sourceId: "inc-1",
      }),
      makeSkippedTransaction({
        id: "c",
        scheduledDate: "2026-01-20",
        type: "expense",
        sourceType: "expense_rule",
        sourceId: "exp-1",
      }),
      makeManualTransaction({ id: "e", scheduledDate: "2026-02-05", type: "expense" }),
      makeProjectedTransaction({ id: "other", scheduledDate: "2026-01-07", userId: "user-2" }),
    ]);
  });

  it("returns the user's transactions ordered by scheduled date", async () => {
    const rows = await getTransactions(USER);

    expect(rows.map((t) => t.id)).toEqual(["a", "b", "c", "e"]);
  });

  it("filters by an inclusive start date", async () => {
    const rows = await getTransactions(USER, { startDate: "2026-01-10" });

    expect(rows.map((t) => t.id)).toEqual(["b", "c", "e"]);
  });

  it("filters by an inclusive end date", async () => {
    const rows = await getTransactions(USER, { endDate: "2026-01-20" });

    expect(rows.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by a date range", async () => {
    const rows = await getTransactions(USER, { startDate: "2026-01-06", endDate: "2026-01-20" });

    expect(rows.map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("filters by a single status", async () => {
    const rows = await getTransactions(USER, { status: "completed" });

    expect(rows.map((t) => t.id)).toEqual(["b"]);
  });

  it("filters by a list of statuses", async () => {
    const rows = await getTransactions(USER, { status: ["completed", "skipped"] });

    expect(rows.map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("filters by type", async () => {
    const rows = await getTransactions(USER, { type: "income" });

    expect(rows.map((t) => t.id)).toEqual(["b"]);
  });

  it("filters by sourceId", async () => {
    const rows = await getTransactions(USER, { sourceId: "exp-1" });

    expect(rows.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("caps the number of rows returned", async () => {
    const rows = await getTransactions(USER, { limit: 2 });

    expect(rows.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("combines filters", async () => {
    const rows = await getTransactions(USER, {
      startDate: "2026-01-06",
      endDate: "2026-01-31",
      type: "expense",
    });

    expect(rows.map((t) => t.id)).toEqual(["c"]);
  });

  it("applies every filter at once, server-side and client-side together", async () => {
    // "d" exists so that the status filter is load-bearing too: without this row
    // the date window alone would already have excluded every projected row.
    store.__seedEntities("transactions", [
      makeProjectedTransaction({
        id: "d",
        scheduledDate: "2026-01-25",
        type: "expense",
        sourceId: "exp-1",
      }),
    ]);

    const rows = await getTransactions(USER, {
      startDate: "2026-01-06", // excludes "a" (2026-01-05)
      endDate: "2026-01-31", // excludes "e" (2026-02-05)
      status: ["completed", "skipped"], // excludes "d" (projected)
      type: "expense", // excludes "b" (income)
      sourceId: "exp-1", // the surviving constraint
    });

    expect(rows.map((t) => t.id)).toEqual(["c"]);
  });

  it("returns an empty list for a user with no transactions", async () => {
    expect(await getTransactions("user-3")).toEqual([]);
  });

  describe("known defects", () => {
    /**
     * DEFECT: `limit` is pushed onto the Firestore query (transactions.ts:97-99)
     * but status/type/sourceId are filtered client-side AFTERWARDS
     * (transactions.ts:106-115). The limit therefore truncates the wrong set: a
     * caller asking for "the 2 most recent completed rows" gets whatever survives
     * the filter out of the first 2 rows by date — here, nothing at all.
     * CORRECT: the limit must apply to the filtered result, returning both
     * completed rows.
     */
    it.fails("KNOWN DEFECT: limit applies after the status filter, not before", async () => {
      store.__reset();
      store.__seedEntities("transactions", [
        makeProjectedTransaction({ id: "p1", scheduledDate: "2026-01-01" }),
        makeProjectedTransaction({ id: "p2", scheduledDate: "2026-01-02" }),
        makeCompletedTransaction({ id: "c1", scheduledDate: "2026-01-03" }),
        makeCompletedTransaction({ id: "c2", scheduledDate: "2026-01-04" }),
      ]);

      const rows = await getTransactions(USER, { status: "completed", limit: 2 });

      expect(rows.map((t) => t.id)).toEqual(["c1", "c2"]);
    });
  });
});

// ============================================================================
// subscribeToStoredTransactions
// ============================================================================

describe("subscribeToStoredTransactions", () => {
  const seedMixed = (): void => {
    store.__seedEntities("transactions", [
      makeManualTransaction({ id: "m-proj", status: "projected", scheduledDate: "2026-02-01" }),
      makeManualTransaction({ id: "m-done", status: "completed", scheduledDate: "2026-02-02" }),
      makeManualTransaction({ id: "m-skip", status: "skipped", scheduledDate: "2026-02-03" }),
      makeProjectedTransaction({ id: "r-proj", scheduledDate: "2026-02-04" }),
      makeCompletedTransaction({
        id: "r-done",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        scheduledDate: "2026-02-05",
      }),
      makeSkippedTransaction({
        id: "r-skip",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        scheduledDate: "2026-02-06",
      }),
      makeManualTransaction({ id: "other", status: "completed", userId: "user-2" }),
    ]);
  };

  it("emits immediately with the current stored rows", () => {
    seedMixed();
    const seen: Transaction[][] = [];

    const unsubscribe = subscribeToStoredTransactions(USER, (rows) => seen.push(rows));

    expect(seen).toHaveLength(1);
    expect(seen[0].map((t) => t.id)).toEqual(["m-proj", "m-done", "m-skip", "r-done", "r-skip"]);
    unsubscribe();
  });

  it("includes manual transactions of every status and excludes rule-based projected rows", () => {
    seedMixed();
    let rows: Transaction[] = [];

    const unsubscribe = subscribeToStoredTransactions(USER, (next) => (rows = next));

    const ids = rows.map((t) => t.id);
    expect(ids).toContain("m-proj");
    expect(ids).toContain("m-done");
    expect(ids).toContain("m-skip");
    expect(ids).toContain("r-done");
    expect(ids).toContain("r-skip");
    // rule-based projected rows are regenerated on the fly, never read back
    expect(ids).not.toContain("r-proj");
    unsubscribe();
  });

  it("excludes other users' rows", () => {
    seedMixed();
    let rows: Transaction[] = [];

    const unsubscribe = subscribeToStoredTransactions(USER, (next) => (rows = next));

    expect(rows.map((t) => t.id)).not.toContain("other");
    unsubscribe();
  });

  it("applies no date filter, so rows far outside any window are emitted", () => {
    // freezeToday pins "today" to 2026-02-10; both of these are far outside any
    // reasonable projection window, and both must still arrive. This missing date
    // filter is what lets historical completed rows reach the daily-balance
    // calculator and skew its opening balance.
    store.__seedEntities("transactions", [
      makeCompletedTransaction({
        id: "ancient",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        scheduledDate: "2020-01-01",
      }),
      makeCompletedTransaction({
        id: "distant",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        scheduledDate: "2030-12-31",
      }),
    ]);
    let rows: Transaction[] = [];

    const unsubscribe = subscribeToStoredTransactions(USER, (next) => (rows = next));

    expect(rows.map((t) => t.id)).toEqual(["ancient", "distant"]);
    unsubscribe();
  });

  it("re-emits after a write", async () => {
    seedMixed();
    const seen: Transaction[][] = [];

    const unsubscribe = subscribeToStoredTransactions(USER, (rows) => seen.push(rows));
    await addTransaction(USER, {
      sourceType: "manual",
      name: "Coffee",
      type: "expense",
      category: "food",
      projectedAmount: 5,
      scheduledDate: "2026-02-07",
      status: "projected",
    });

    expect(seen).toHaveLength(2);
    expect(seen[1].map((t) => t.id)).toEqual([
      "m-proj",
      "m-done",
      "m-skip",
      "r-done",
      "r-skip",
      "auto-1",
    ]);
    unsubscribe();
  });

  it("re-emits a completed row that was previously excluded as rule-based projected", async () => {
    seedUser(1_000);
    store.__seedEntities("transactions", [
      makeProjectedTransaction({ id: "r-proj", scheduledDate: "2026-02-04", projectedAmount: 100 }),
    ]);
    const seen: Transaction[][] = [];

    const unsubscribe = subscribeToStoredTransactions(USER, (rows) => seen.push(rows));
    expect(seen[0]).toEqual([]);

    await completeTransaction("r-proj", 100);

    // the last emission must contain the now-completed row
    expect(seen[seen.length - 1].map((t) => t.id)).toEqual(["r-proj"]);
    expect(seen[seen.length - 1][0].status).toBe("completed");
    unsubscribe();
  });

  it("stops emitting once unsubscribed", async () => {
    seedMixed();
    const seen: Transaction[][] = [];

    const unsubscribe = subscribeToStoredTransactions(USER, (rows) => seen.push(rows));
    expect(seen).toHaveLength(1);

    unsubscribe();
    await addTransaction(USER, {
      sourceType: "manual",
      name: "Coffee",
      type: "expense",
      category: "food",
      projectedAmount: 5,
      scheduledDate: "2026-02-07",
      status: "completed",
    });

    expect(seen).toHaveLength(1);
  });
});

// ============================================================================
// subscribeToTransactions (legacy, date-filtered)
//
// The other half of the subscription pair: this one DOES apply a date window
// but does NOT filter by status, so unlike subscribeToStoredTransactions it
// hands rule-based projected rows back to the caller. Both facts matter — a
// caller that swaps one for the other silently changes what it sees.
// ============================================================================

describe("subscribeToTransactions", () => {
  const seedRange = (): void => {
    store.__seedEntities("transactions", [
      makeProjectedTransaction({ id: "jan05", sourceId: "exp-1", scheduledDate: "2026-01-05" }),
      makeCompletedTransaction({
        id: "jan10",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        scheduledDate: "2026-01-10",
      }),
      makeSkippedTransaction({
        id: "jan20",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        scheduledDate: "2026-01-20",
      }),
      makeManualTransaction({ id: "feb05", scheduledDate: "2026-02-05" }),
      makeProjectedTransaction({ id: "other", scheduledDate: "2026-01-15", userId: "user-2" }),
    ]);
  };

  it("emits immediately, ordered by scheduled date", () => {
    seedRange();
    const seen: Transaction[][] = [];

    const unsubscribe = subscribeToTransactions(USER, (rows) => seen.push(rows));

    expect(seen).toHaveLength(1);
    expect(seen[0].map((t) => t.id)).toEqual(["jan05", "jan10", "jan20", "feb05"]);
    unsubscribe();
  });

  it("includes rule-based projected rows, unlike subscribeToStoredTransactions", () => {
    seedRange();
    let rows: Transaction[] = [];

    const unsubscribe = subscribeToTransactions(USER, (next) => (rows = next));

    expect(rows.map((t) => t.id)).toContain("jan05");
    unsubscribe();
  });

  it("excludes other users' rows", () => {
    seedRange();
    let rows: Transaction[] = [];

    const unsubscribe = subscribeToTransactions(USER, (next) => (rows = next));

    expect(rows.map((t) => t.id)).not.toContain("other");
    unsubscribe();
  });

  it("applies an inclusive startDate", () => {
    seedRange();
    let rows: Transaction[] = [];

    const unsubscribe = subscribeToTransactions(USER, (next) => (rows = next), {
      startDate: "2026-01-10",
    });

    expect(rows.map((t) => t.id)).toEqual(["jan10", "jan20", "feb05"]);
    unsubscribe();
  });

  it("applies an inclusive endDate", () => {
    seedRange();
    let rows: Transaction[] = [];

    const unsubscribe = subscribeToTransactions(USER, (next) => (rows = next), {
      endDate: "2026-01-20",
    });

    expect(rows.map((t) => t.id)).toEqual(["jan05", "jan10", "jan20"]);
    unsubscribe();
  });

  it("applies both bounds together", () => {
    seedRange();
    let rows: Transaction[] = [];

    const unsubscribe = subscribeToTransactions(USER, (next) => (rows = next), {
      startDate: "2026-01-06",
      endDate: "2026-01-20",
    });

    expect(rows.map((t) => t.id)).toEqual(["jan10", "jan20"]);
    unsubscribe();
  });

  it("re-emits with the new row after a write inside the window", async () => {
    seedRange();
    const seen: Transaction[][] = [];

    const unsubscribe = subscribeToTransactions(USER, (rows) => seen.push(rows), {
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(seen[0].map((t) => t.id)).toEqual(["jan05", "jan10", "jan20"]);

    await addTransaction(USER, {
      sourceType: "manual",
      name: "Coffee",
      type: "expense",
      category: "food",
      projectedAmount: 5,
      scheduledDate: "2026-01-25",
      status: "projected",
    });

    expect(seen).toHaveLength(2);
    expect(seen[1].map((t) => t.id)).toEqual(["jan05", "jan10", "jan20", "auto-1"]);
    unsubscribe();
  });

  it("never emits a row written outside the window", async () => {
    seedRange();
    const seen: Transaction[][] = [];

    const unsubscribe = subscribeToTransactions(USER, (rows) => seen.push(rows), {
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });

    await addTransaction(USER, {
      sourceType: "manual",
      name: "Far future",
      type: "expense",
      category: "food",
      projectedAmount: 5,
      scheduledDate: "2026-06-01",
      status: "projected",
    });

    expect(seen[seen.length - 1].map((t) => t.id)).not.toContain("auto-1");
    unsubscribe();
  });

  it("re-emits when a row already in the window changes status", async () => {
    seedUser(1_000);
    seedRange();
    const seen: Transaction[][] = [];

    const unsubscribe = subscribeToTransactions(USER, (rows) => seen.push(rows), {
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });

    await completeTransaction("jan05", 100);

    const last = seen[seen.length - 1];
    expect(last.map((t) => t.id)).toEqual(["jan05", "jan10", "jan20"]);
    expect(last[0].status).toBe("completed");
    unsubscribe();
  });

  it("stops emitting once unsubscribed", async () => {
    seedRange();
    const seen: Transaction[][] = [];

    const unsubscribe = subscribeToTransactions(USER, (rows) => seen.push(rows));
    expect(seen).toHaveLength(1);

    unsubscribe();
    await addTransaction(USER, {
      sourceType: "manual",
      name: "Coffee",
      type: "expense",
      category: "food",
      projectedAmount: 5,
      scheduledDate: "2026-01-25",
      status: "projected",
    });

    expect(seen).toHaveLength(1);
  });
});

// ============================================================================
// USER PROFILE PERSISTENCE
//
// `createUserProfile` runs on every login, so its "already exists" branch is
// the guard that stops a returning user's balance being reset to zero. The rest
// of users.ts is exercised transitively by the balance adjustments above; these
// tests pin it directly.
// ============================================================================

describe("createUserProfile", () => {
  it("creates a zeroed profile for a brand-new user", async () => {
    const profile = await createUserProfile("user-new", "new@example.com", "New User");

    expect(profile.uid).toBe("user-new");
    expect(profile.email).toBe("new@example.com");
    expect(profile.displayName).toBe("New User");
    expect(profile.currentBalance).toBe(0);
    expect(profile.initialBalance).toBe(0);
    expect(profile.preferences.currency).toBe("PHP");
    expect(millis(profile.createdAt)).toBe(d(TODAY).getTime());
    // the document carries its own uid — getUserProfile returns snapshot.data()
    // verbatim, with no id merge, so nothing else would supply it
    expect(store.__get<UserProfile>("users", "user-new")!.uid).toBe("user-new");
    expect(store.__opsFor("users").map((entry) => entry.op)).toEqual(["set"]);
    // `balanceLastUpdatedAt` is deliberately not asserted here: it comes from
    // `new Date().toISOString()`, whose off-by-one-day behaviour is pinned as a
    // known defect in tests/timezone/offsets.test.ts under a positive offset.
  });

  it("returns the existing profile for a returning user", async () => {
    store.__seed(
      "users",
      USER,
      makeUserProfile({
        uid: USER,
        email: "old@example.com",
        displayName: "Old Name",
        currentBalance: 7_500,
        initialBalance: 2_000,
        balanceLastUpdatedAt: "2026-01-01",
      })
    );

    const profile = await createUserProfile(USER, "new@example.com", "New Name");

    // the stored values win over the arguments — this is what protects a
    // returning user's balance from being reset to 0 on every re-login
    expect(profile.uid).toBe(USER);
    expect(profile.currentBalance).toBe(7_500);
    expect(profile.initialBalance).toBe(2_000);
    expect(profile.balanceLastUpdatedAt).toBe("2026-01-01");
    expect(profile.email).toBe("old@example.com");
    expect(profile.displayName).toBe("Old Name");
  });

  it("writes nothing at all for a returning user", async () => {
    seedUser(7_500);

    await createUserProfile(USER, "new@example.com", "New Name");

    expect(store.__opsFor("users")).toEqual([]);
    expect(balance()).toBe(7_500);
    expect(store.__count("users")).toBe(1);
  });
});

describe("getUserProfile", () => {
  it("returns the stored profile", async () => {
    seedUser(4_242);

    const profile = await getUserProfile(USER);

    expect(profile).not.toBeNull();
    expect(profile!.uid).toBe(USER);
    expect(profile!.currentBalance).toBe(4_242);
  });

  it("returns null when the profile does not exist", async () => {
    expect(await getUserProfile("nobody")).toBeNull();
  });

  it("creates nothing as a side effect of a miss", async () => {
    await getUserProfile("nobody");

    expect(store.__count("users")).toBe(0);
    expect(store.__opsFor("users")).toEqual([]);
  });

  it("returns the document data verbatim, without merging the document id", async () => {
    // unlike getTransaction/getExpenseRule, which spread `{ id, ...data }`, this
    // returns snapshot.data() as-is: a document written without its own `uid`
    // field comes back with uid undefined rather than the document id
    store.__seed("users", "uid-less", { currentBalance: 10 });

    const profile = await getUserProfile("uid-less");

    expect(profile).not.toBeNull();
    expect(profile!.uid).toBeUndefined();
  });
});

describe("updateUserProfile", () => {
  it("updates the supplied fields and stamps updatedAt", async () => {
    seedUser(1_000);

    await updateUserProfile(USER, { displayName: "Renamed", email: "renamed@example.com" });

    const stored = store.__get<UserProfile>("users", USER)!;
    expect(stored.displayName).toBe("Renamed");
    expect(stored.email).toBe("renamed@example.com");
    expect(millis(stored.updatedAt)).toBe(d(TODAY).getTime());
  });

  it("strips undefined fields so they cannot clear stored values", async () => {
    seedUser(1_000);

    await updateUserProfile(USER, {
      displayName: undefined,
      profilePictureUrl: "https://example.test/avatar.png",
    });

    const stored = store.__get<UserProfile>("users", USER)!;
    expect(stored.displayName).toBe("Test User");
    expect(stored.profilePictureUrl).toBe("https://example.test/avatar.png");
  });

  it("leaves fields it was not given alone", async () => {
    seedUser(1_000);

    await updateUserProfile(USER, { initialBalance: 3_000 });

    const stored = store.__get<UserProfile>("users", USER)!;
    expect(stored.initialBalance).toBe(3_000);
    // an initial-balance edit is not a balance refresh: only updateUserBalance
    // moves currentBalance and re-stamps the day
    expect(stored.currentBalance).toBe(1_000);
    expect(stored.balanceLastUpdatedAt).toBe("2026-01-01");
  });

  it("throws when the profile does not exist and writes nothing", async () => {
    await expect(updateUserProfile("nobody", { displayName: "Ghost" })).rejects.toThrow(
      "User profile with ID nobody does not exist"
    );
    expect(store.__opsFor("users")).toEqual([]);
  });
});

describe("deleteUserProfile", () => {
  it("deletes the profile through its dynamically imported deleteDoc", async () => {
    // users.ts:126 resolves deleteDoc via `await import("firebase/firestore")`
    // rather than the static import at the top of the module; this asserts that
    // the hoisted vi.mock intercepts the dynamic import too (if it did not, the
    // real SDK would be handed the emulator's fake DocumentReference)
    seedUser(1_000);

    await deleteUserProfile(USER);

    expect(store.__get("users", USER)).toBeUndefined();
    expect(store.__count("users")).toBe(0);
    expect(store.__opsFor("users").map((entry) => entry.op)).toEqual(["delete"]);
  });

  it("resolves without throwing for a profile that never existed", async () => {
    await expect(deleteUserProfile("nobody")).resolves.toBeUndefined();
    expect(store.__count("users")).toBe(0);
  });

  it("leaves the user's transactions behind", async () => {
    seedUser(1_000);
    store.__seedEntities("transactions", [makeProjectedTransaction({ id: "t1" })]);

    await deleteUserProfile(USER);

    // profile deletion is not a cascade — orphaned rows survive
    expect(store.__count("transactions")).toBe(1);
  });
});

// ============================================================================
// updateLoanBalance (direct)
//
// Reached from completeTransaction above, but its guard clauses and its
// parameter contract are only reachable directly.
// ============================================================================

describe("updateLoanBalance", () => {
  it("reduces the balance by the principal portion and increments paymentsMade", async () => {
    store.__seedEntities("expense_rules", [
      makeLoanRule({}, { currentBalance: 12_000, paymentsMade: 3 }),
    ]);

    await updateLoanBalance("loan-1", 565, 400);

    const rule = storedRule("loan-1");
    expect(rule.loanConfig!.currentBalance).toBe(11_600);
    expect(rule.loanConfig!.paymentsMade).toBe(4);
    expect(rule.isActive).toBe(true);
    expect(millis(rule.updatedAt)).toBe(d(TODAY).getTime());
  });

  it("returns without writing when the rule does not exist", async () => {
    await expect(updateLoanBalance("nope", 565, 400)).resolves.toBeUndefined();

    expect(store.__opsFor("expense_rules")).toEqual([]);
    expect(store.__count("expense_rules")).toBe(0);
  });

  it("returns without writing when the rule has no loanConfig", async () => {
    store.__seedEntities("expense_rules", [makeExpenseRule({ id: "exp-1", amount: 1_200 })]);

    await expect(updateLoanBalance("exp-1", 565, 400)).resolves.toBeUndefined();

    // no write at all, not even an updatedAt bump
    expect(store.__opsFor("expense_rules")).toEqual([]);
    expect(storedRule("exp-1")).toEqual(makeExpenseRule({ id: "exp-1", amount: 1_200 }));
  });

  it("does not deactivate a rule while a balance remains", async () => {
    store.__seedEntities("expense_rules", [
      makeLoanRule({}, { currentBalance: 401, paymentsMade: 0 }),
    ]);

    await updateLoanBalance("loan-1", 565, 400);

    const rule = storedRule("loan-1");
    expect(rule.loanConfig!.currentBalance).toBe(1);
    expect(rule.isActive).toBe(true);
  });

  describe("known defects", () => {
    /**
     * DEFECT: `updateLoanBalance(ruleId, paymentAmount, principalPaid)` never
     * reads `paymentAmount` (expenseRules.ts:117-137) — the loan is reduced by
     * `principalPaid` alone, which completeTransaction takes from the PROJECTED
     * amortization breakdown (transactions.ts:184-189), not from what the user
     * actually paid. Paying 1_065 against a scheduled 565 (400 principal + 165
     * interest) therefore takes 1_065 of real cash out of the balance while the
     * loan drops by only 400: the extra 500 leaves the account and reduces
     * nothing.
     * CORRECT: everything paid above the interest portion is principal, so an
     * extra 500 must reduce the loan by 900 in total: 12_000 - 900 = 11_100.
     *
     * TODAY: the loan lands on 11_600 — the same place a scheduled payment
     * would have put it — and `paymentsMade` still advances by exactly one.
     */
    it.fails("KNOWN DEFECT: an overpayment reduces the loan by the extra amount", async () => {
      seedUser(10_000);
      store.__seedEntities("expense_rules", [
        makeLoanRule({}, { currentBalance: 12_000, paymentsMade: 0 }),
      ]);
      store.__seedEntities("transactions", [
        makeProjectedTransaction({
          id: "t-loan",
          sourceType: "expense_rule",
          sourceId: "loan-1",
          type: "expense",
          projectedAmount: 565,
          paymentBreakdown: makePaymentBreakdown({ principalPaid: 400, interestPaid: 165 }),
        }),
      ]);

      await completeTransaction("t-loan", 1_065);

      expect(storedRule("loan-1").loanConfig!.currentBalance).toBe(11_100);
      // the cash side is already right and must stay right: the full 1_065 left
      // the account, which is exactly why the missing 500 matters
      expect(balance()).toBe(8_935);
    });
  });
});

// ============================================================================
// OCCURRENCE OVERRIDES
//
// Both setters write a DOTTED field path (`occurrenceOverrides.<id>`), which
// must merge into the stored map. A plain top-level write would replace the
// whole map and drop every other override the user has set on that rule.
// ============================================================================

describe("setExpenseRuleOverride / removeExpenseRuleOverride", () => {
  const TWO_OVERRIDES = {
    "exp-1_2026-01": { amount: 1_500 },
    "exp-1_2026-02": { skipped: true },
  };

  const seedRuleWithOverrides = (): void => {
    store.__seedEntities("expense_rules", [
      makeExpenseRule({ id: "exp-1", occurrenceOverrides: { ...TWO_OVERRIDES } }),
    ]);
  };

  it("merges a third override into the existing map", async () => {
    seedRuleWithOverrides();

    await setExpenseRuleOverride("exp-1", "exp-1_2026-03", { scheduledDate: "2026-03-18" });

    expect(storedRule("exp-1").occurrenceOverrides).toEqual({
      "exp-1_2026-01": { amount: 1_500 },
      "exp-1_2026-02": { skipped: true },
      "exp-1_2026-03": { scheduledDate: "2026-03-18" },
    });
  });

  it("stamps updatedAt alongside the merge", async () => {
    seedRuleWithOverrides();

    await setExpenseRuleOverride("exp-1", "exp-1_2026-03", { amount: 10 });

    expect(millis(storedRule("exp-1").updatedAt)).toBe(d(TODAY).getTime());
  });

  it("creates the map when the rule has no overrides yet", async () => {
    store.__seedEntities("expense_rules", [makeExpenseRule({ id: "exp-1" })]);

    await setExpenseRuleOverride("exp-1", "exp-1_2026-03", { amount: 10 });

    expect(storedRule("exp-1").occurrenceOverrides).toEqual({ "exp-1_2026-03": { amount: 10 } });
  });

  it("replaces the addressed entry wholesale but leaves its siblings intact", async () => {
    seedRuleWithOverrides();

    await setExpenseRuleOverride("exp-1", "exp-1_2026-01", { notes: "re-priced" });

    // the dotted path addresses one map ENTRY, so the entry is overwritten (the
    // old `amount: 1_500` is gone) while the rest of the map survives. Merging
    // within an entry is the caller's job — see the reschedule defect in
    // tests/integration/actualMutation.actions.test.ts.
    expect(storedRule("exp-1").occurrenceOverrides).toEqual({
      "exp-1_2026-01": { notes: "re-priced" },
      "exp-1_2026-02": { skipped: true },
    });
  });

  it("rejects when the rule does not exist", async () => {
    await expect(setExpenseRuleOverride("nope", "exp-1_2026-03", { amount: 10 })).rejects.toThrow();
    expect(store.__count("expense_rules")).toBe(0);
  });

  it("removes only the addressed override", async () => {
    seedRuleWithOverrides();

    await removeExpenseRuleOverride("exp-1", "exp-1_2026-01");

    expect(storedRule("exp-1").occurrenceOverrides).toEqual({
      "exp-1_2026-02": { skipped: true },
    });
  });

  it("does not throw or damage siblings for a key that was never set", async () => {
    seedRuleWithOverrides();

    await expect(removeExpenseRuleOverride("exp-1", "exp-1_2099-12")).resolves.toBeUndefined();

    expect(storedRule("exp-1").occurrenceOverrides).toEqual(TWO_OVERRIDES);
  });

  it("leaves the rest of the rule alone when removing an override", async () => {
    seedRuleWithOverrides();

    await removeExpenseRuleOverride("exp-1", "exp-1_2026-01");

    const rule = storedRule("exp-1");
    expect(rule.amount).toBe(1_200);
    expect(rule.isActive).toBe(true);
    expect(rule.frequency).toBe("monthly");
    expect(millis(rule.updatedAt)).toBe(d(TODAY).getTime());
  });
});

describe("setIncomeSourceOverride / removeIncomeSourceOverride", () => {
  const TWO_OVERRIDES = {
    "inc-1_2026-01": { amount: 3_500 },
    "inc-1_2026-02": { skipped: true },
  };

  const seedSourceWithOverrides = (): void => {
    store.__seedEntities("income_sources", [
      makeIncomeSource({ id: "inc-1", occurrenceOverrides: { ...TWO_OVERRIDES } }),
    ]);
  };

  it("merges a third override into the existing map", async () => {
    seedSourceWithOverrides();

    await setIncomeSourceOverride("inc-1", "inc-1_2026-03", { scheduledDate: "2026-03-18" });

    expect(storedSource("inc-1").occurrenceOverrides).toEqual({
      "inc-1_2026-01": { amount: 3_500 },
      "inc-1_2026-02": { skipped: true },
      "inc-1_2026-03": { scheduledDate: "2026-03-18" },
    });
  });

  it("stamps updatedAt alongside the merge", async () => {
    seedSourceWithOverrides();

    await setIncomeSourceOverride("inc-1", "inc-1_2026-03", { amount: 10 });

    expect(millis(storedSource("inc-1").updatedAt)).toBe(d(TODAY).getTime());
  });

  it("removes only the addressed override", async () => {
    seedSourceWithOverrides();

    await removeIncomeSourceOverride("inc-1", "inc-1_2026-02");

    expect(storedSource("inc-1").occurrenceOverrides).toEqual({
      "inc-1_2026-01": { amount: 3_500 },
    });
  });

  it("does not throw or damage siblings for a key that was never set", async () => {
    seedSourceWithOverrides();

    await expect(removeIncomeSourceOverride("inc-1", "inc-1_2099-12")).resolves.toBeUndefined();

    expect(storedSource("inc-1").occurrenceOverrides).toEqual(TWO_OVERRIDES);
  });

  it("rejects when the source does not exist", async () => {
    await expect(
      setIncomeSourceOverride("nope", "inc-1_2026-03", { amount: 10 })
    ).rejects.toThrow();
    expect(store.__count("income_sources")).toBe(0);
  });
});
