import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => import("../../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../../helpers/firebaseConfigMock"));

import type { Transaction, UserProfile } from "@/lib/types";
import {
  fixBalanceDiscrepancy,
  generateReconciliationReport,
} from "@/lib/logic/balanceCalculator/reconciliation";
import {
  completeTransaction,
  deleteTransactionsBySource,
  getTransactions,
} from "@/lib/firebase/firestore";
import { removeTransactionAction } from "@/contexts/FinancialContext/actions/transactionActions";
import * as store from "../../helpers/firestoreEmulator";
import {
  makeCompletedTransaction,
  makeExpenseRule,
  makeProjectedTransaction,
  makeSkippedTransaction,
  makeTransaction,
  makeUserProfile,
} from "../../helpers/builders";

/**
 * THEME: balance reconciliation — the module that detects and repairs drift
 * between the balance the app has been maintaining incrementally
 * (`users/{uid}.currentBalance`, moved by `adjustUserBalance` on every
 * complete/skip/revert) and the balance the transaction ledger actually implies
 * (`initialBalance` + every completed row).
 *
 * ---------------------------------------------------------------------------
 * FINDING: THIS MODULE IS DEAD CODE. NOTHING IN THE APP EVER RUNS IT.
 * ---------------------------------------------------------------------------
 * `generateReconciliationReport` and `fixBalanceDiscrepancy` have no callers:
 *   - `grep -rn "generateReconciliationReport\|fixBalanceDiscrepancy" app/` matches
 *     only their own definitions in app/lib/logic/balanceCalculator/reconciliation.ts.
 *   - reconciliation.ts is not even re-exported from
 *     app/lib/logic/balanceCalculator/index.ts (which lists utils, dailyBalance,
 *     billCoverage, variance, runway, categoryBreakdown, summaryCalculations —
 *     and neither reconciliation nor computedBalance).
 *   - The only drift surface that ships is the settings screen,
 *     app/components/pages/settings/components/BalanceSection.tsx, which
 *     re-implements the comparison inline (`computeBalanceFromTransactions` +
 *     `Math.abs(current - computed) > 0.01` at BalanceSection.tsx:218) and calls
 *     `syncComputedBalance` directly at :114 / :135. It never touches this module.
 *
 * (tests/integration/actualMutation.actions.test.ts:1389-1396 reaches the same
 * conclusion from the mutation side, independently of this file.)
 *
 * So the app ships drift DETECTION it never invokes, and drift is only ever
 * noticed if a user happens to open Settings > Balance and read the numbers.
 * That matters because the drift-producing defects other suites pinned are all
 * silent, and all of them are ordinary UI actions:
 *   - `removeTransactionAction` gates its balance reversal on
 *     `sourceType === "manual"` (transactionActions.ts:346), so deleting a
 *     COMPLETED RULE-BASED row throws the record away and leaves its money
 *     applied — pinned at tests/integration/actualMutation.actions.test.ts:2060.
 *     That is the exact path exercised for real in "drift from a real production
 *     mutation path" below.
 *   - Adding an already-completed manual row never applies its impact at all —
 *     pinned at tests/integration/actualMutation.actions.test.ts:1403.
 *   - complete -> revert -> complete cycles erode loan balances by a payment
 *     each time — pinned at
 *     tests/integration/actualMutation.firestore.test.ts:1186.
 * Nothing in production ever asks "does currentBalance still reconcile?", so the
 * damage from those paths is permanent and invisible until the next manual
 * recalculation.
 *
 * ---------------------------------------------------------------------------
 * Scope note: `computeBalanceFromTransactions` and `syncComputedBalance` (the
 * two functions this module delegates to) are covered in
 * tests/integration/projectedVsActual.balances.test.ts. This file does not
 * repeat that ground: it covers the REPORT object — sign convention,
 * affectedTransactions, canAutoFix, the missing-profile path, the read-only
 * guarantee — plus the drift/repair round trip through real mutation paths.
 * ---------------------------------------------------------------------------
 */

// ============================================================================
// LOCAL HELPERS
//
// Gap in tests/helpers/builders.ts + firestoreEmulator.ts: there is no helper
// that seeds a user profile plus a set of transactions and reads them back
// through the real firestore layer, which is what the drift scenarios need
// (the report takes transactions as an argument, so the rows have to make a
// real round trip through `getTransactions` for the test to prove anything
// about production data). These local helpers cover it.
// ============================================================================

const USER = "user-1";

/** Seed a user profile under the fixed test uid. */
const seedProfile = (overrides: Partial<UserProfile> = {}): void =>
  store.__seed("users", USER, makeUserProfile({ uid: USER, ...overrides }));

/** The profile's stored `currentBalance`, straight out of the store. */
const storedBalance = (): number | undefined =>
  store.__get<UserProfile>("users", USER)?.currentBalance;

/** Every stored transaction, read back through the REAL firestore layer. */
const storedRows = (): Promise<Transaction[]> => getTransactions(USER);

// ============================================================================
// generateReconciliationReport
// ============================================================================

describe("generateReconciliationReport", () => {
  beforeEach(() => store.__reset());

  describe("no drift", () => {
    it("reports a difference of 0 when currentBalance equals initialBalance plus completed rows", async () => {
      seedProfile({ initialBalance: 10_000, currentBalance: 9_500 });

      const report = await generateReconciliationReport(USER, [
        makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 500 }),
      ]);

      expect(report.currentBalance).toBe(9_500);
      expect(report.computedBalance).toBe(9_500);
      expect(report.difference).toBe(0);
    });

    it("reports 0 across a mixed ledger of completed, projected and skipped rows", async () => {
      // 10000 + 3000 (completed income) - 1200 (completed expense) = 11800.
      // The projected 999 and the skipped 888 must not move the computed figure.
      seedProfile({ initialBalance: 10_000, currentBalance: 11_800 });

      const report = await generateReconciliationReport(USER, [
        makeCompletedTransaction({
          id: "inc",
          type: "income",
          projectedAmount: 3_000,
          actualAmount: 3_000,
        }),
        makeCompletedTransaction({
          id: "exp",
          type: "expense",
          projectedAmount: 1_200,
          actualAmount: 1_200,
        }),
        makeProjectedTransaction({ id: "p", type: "expense", projectedAmount: 999 }),
        makeSkippedTransaction({
          id: "s",
          type: "expense",
          projectedAmount: 888,
          actualAmount: 888,
        }),
      ]);

      expect(report.computedBalance).toBe(11_800);
      expect(report.difference).toBe(0);
    });

    it("derives computedBalance from initialBalance, never from the stored currentBalance", async () => {
      // A wildly wrong currentBalance must not feed back into the computation —
      // otherwise the report could never detect drift at all.
      seedProfile({ initialBalance: 1_000, currentBalance: 999_999 });

      const report = await generateReconciliationReport(USER, [
        makeCompletedTransaction({ type: "income", projectedAmount: 200, actualAmount: 200 }),
      ]);

      expect(report.computedBalance).toBe(1_200);
      expect(report.currentBalance).toBe(999_999);
    });

    it("never writes anything — the report is read-only", async () => {
      seedProfile({ initialBalance: 10_000, currentBalance: 4_242 });

      await generateReconciliationReport(USER, [
        makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 500 }),
      ]);

      expect(store.__ops).toEqual([]);
      expect(storedBalance()).toBe(4_242);
    });
  });

  describe("sign convention", () => {
    it("reports POSITIVE drift when the stored balance is higher than the ledger justifies", async () => {
      // The ledger says one 500 expense was paid out of a 10000 start, so the
      // balance should be 9500 — but the profile still says 10000.
      //
      // SIGN CONTRACT (reconciliation.ts:33 — `currentBalance - computedBalance`):
      // a POSITIVE difference means the stored balance OVERSTATES reality by that
      // much, and the correction is to REDUCE the stored balance by it. Getting
      // this backwards is the worst failure this module could have: a UI would
      // tell a user with 9500 in the bank that they have 500 MORE than they think
      // and invite them to spend it.
      seedProfile({ initialBalance: 10_000, currentBalance: 10_000 });

      const report = await generateReconciliationReport(USER, [
        makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 500 }),
      ]);

      expect(report.currentBalance).toBe(10_000);
      expect(report.computedBalance).toBe(9_500);
      expect(report.difference).toBe(500);
      expect(report.difference).toBeGreaterThan(0);
      // Applying the correction with the stated sign must land on the ledger figure.
      expect(report.currentBalance - report.difference).toBe(report.computedBalance);
    });

    it("reports NEGATIVE drift when the stored balance is lower than the ledger justifies", async () => {
      // Mirror direction: the profile says 9000 but the ledger only accounts for
      // a 500 expense against a 10000 start, so 500 was taken out of the balance
      // that no completed row explains.
      seedProfile({ initialBalance: 10_000, currentBalance: 9_000 });

      const report = await generateReconciliationReport(USER, [
        makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 500 }),
      ]);

      expect(report.computedBalance).toBe(9_500);
      expect(report.difference).toBe(-500);
      expect(report.difference).toBeLessThan(0);
      expect(report.currentBalance - report.difference).toBe(report.computedBalance);
    });

    it("keeps the sign convention when income is what drifted", async () => {
      // A completed income of 3000 was recorded but never added to the balance:
      // computed 13000 vs stored 10000 => -3000 (the profile understates).
      seedProfile({ initialBalance: 10_000, currentBalance: 10_000 });

      const report = await generateReconciliationReport(USER, [
        makeCompletedTransaction({ type: "income", projectedAmount: 3_000, actualAmount: 3_000 }),
      ]);

      expect(report.computedBalance).toBe(13_000);
      expect(report.difference).toBe(-3_000);
    });

    it("uses actualAmount, so an amount edited after completion shows up as drift", async () => {
      // Stored balance reflects the original 500; the row now says 800 was paid.
      seedProfile({ initialBalance: 10_000, currentBalance: 9_500 });

      const report = await generateReconciliationReport(USER, [
        makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 800 }),
      ]);

      expect(report.computedBalance).toBe(9_200);
      expect(report.difference).toBe(300);
    });
  });

  describe("affectedTransactions", () => {
    it("contains exactly the completed rows, excluding projected and skipped", async () => {
      // 10000 - 400 + 0 = 9600, so this ledger is drift-free; the point of the
      // test is purely which rows are listed.
      seedProfile({ initialBalance: 10_000, currentBalance: 9_600 });

      const report = await generateReconciliationReport(USER, [
        makeCompletedTransaction({
          id: "c1",
          type: "expense",
          projectedAmount: 400,
          actualAmount: 400,
        }),
        makeProjectedTransaction({ id: "p1", type: "expense", projectedAmount: 999 }),
        makeSkippedTransaction({
          id: "s1",
          type: "expense",
          projectedAmount: 888,
          actualAmount: 888,
        }),
        makeCompletedTransaction({
          id: "c2",
          type: "income",
          projectedAmount: 0,
          actualAmount: 0,
        }),
      ]);

      // Length first, so the id assertion below can never throw on a short array.
      expect(report.affectedTransactions).toHaveLength(2);
      expect(report.affectedTransactions.map((t) => t.id)).toEqual(["c1", "c2"]);
      expect(report.difference).toBe(0);
    });

    it("preserves the completed rows whole and in input order", async () => {
      seedProfile({ initialBalance: 10_000, currentBalance: 9_700 });
      const first = makeCompletedTransaction({
        id: "c1",
        type: "expense",
        projectedAmount: 100,
        actualAmount: 100,
      });
      const second = makeCompletedTransaction({
        id: "c2",
        type: "expense",
        projectedAmount: 200,
        actualAmount: 200,
      });

      const report = await generateReconciliationReport(USER, [
        second,
        makeProjectedTransaction({ id: "p", projectedAmount: 50 }),
        first,
      ]);

      expect(report.affectedTransactions).toEqual([second, first]);
    });

    it("still lists every completed row when there is no drift at all", async () => {
      // PINNED (and a caveat worth knowing): despite the name,
      // `affectedTransactions` (reconciliation.ts:39) is not "the rows that caused
      // the drift" — it is an unconditional `status === "completed"` filter. With a
      // difference of 0 it still returns the entire completed history, so a UI
      // cannot use it to point at the culprit.
      seedProfile({ initialBalance: 10_000, currentBalance: 9_400 });

      const report = await generateReconciliationReport(USER, [
        makeCompletedTransaction({
          id: "c1",
          type: "expense",
          projectedAmount: 300,
          actualAmount: 300,
        }),
        makeCompletedTransaction({
          id: "c2",
          type: "expense",
          projectedAmount: 300,
          actualAmount: 300,
        }),
      ]);

      expect(report.difference).toBe(0);
      expect(report.affectedTransactions.map((t) => t.id)).toEqual(["c1", "c2"]);
    });

    it("is empty when no row is completed", async () => {
      seedProfile({ initialBalance: 10_000, currentBalance: 10_000 });

      const report = await generateReconciliationReport(USER, [
        makeProjectedTransaction({ id: "p", projectedAmount: 400 }),
        makeSkippedTransaction({ id: "s", projectedAmount: 400, actualAmount: 400 }),
      ]);

      expect(report.affectedTransactions).toEqual([]);
      expect(report.difference).toBe(0);
    });
  });

  describe("canAutoFix", () => {
    // `canAutoFix` is the literal `true` at reconciliation.ts:40 — it is not
    // derived from anything and carries NO REAL SIGNAL. It is `true` with drift,
    // without drift, with an empty ledger, and would be `true` for a profile
    // whose numbers are nonsense. A consumer that branches on it is branching on
    // a constant; the only honest reading is "this module's fix is always
    // *attempted*", not "this drift is safely repairable".
    it("is true when there is drift", async () => {
      seedProfile({ initialBalance: 10_000, currentBalance: 10_000 });

      const report = await generateReconciliationReport(USER, [
        makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 500 }),
      ]);

      expect(report.difference).toBe(500);
      expect(report.canAutoFix).toBe(true);
    });

    it("is true even when there is nothing to fix", async () => {
      seedProfile({ initialBalance: 10_000, currentBalance: 10_000 });

      const report = await generateReconciliationReport(USER, []);

      expect(report.difference).toBe(0);
      expect(report.canAutoFix).toBe(true);
    });
  });

  describe("empty ledger", () => {
    it("computes the initial balance and reports no drift for a brand-new profile", async () => {
      seedProfile({ initialBalance: 2_500, currentBalance: 2_500 });

      const report = await generateReconciliationReport(USER, []);

      expect(report.computedBalance).toBe(2_500);
      expect(report.currentBalance).toBe(2_500);
      expect(report.difference).toBe(0);
      expect(report.affectedTransactions).toEqual([]);
      expect(report.canAutoFix).toBe(true);
    });

    it("attributes the whole gap to drift when the ledger is empty but the balance moved", async () => {
      // No completed row explains any of it, so the entire 1500 is drift.
      seedProfile({ initialBalance: 2_500, currentBalance: 1_000 });

      const report = await generateReconciliationReport(USER, []);

      expect(report.computedBalance).toBe(2_500);
      expect(report.difference).toBe(-1_500);
    });

    it("handles a zero initial balance without reporting phantom drift", async () => {
      seedProfile({ initialBalance: 0, currentBalance: 0 });

      const report = await generateReconciliationReport(USER, []);

      expect(report.computedBalance).toBe(0);
      expect(report.difference).toBe(0);
    });

    it("handles a negative computed balance (overdrawn ledger)", async () => {
      seedProfile({ initialBalance: 100, currentBalance: -400 });

      const report = await generateReconciliationReport(USER, [
        makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 500 }),
      ]);

      expect(report.computedBalance).toBe(-400);
      expect(report.difference).toBe(0);
    });
  });

  describe("missing profile", () => {
    it("throws when the user profile does not exist", async () => {
      await expect(generateReconciliationReport("missing-user", [])).rejects.toThrow(
        "User profile not found"
      );
    });

    it("throws even when transactions were supplied", async () => {
      await expect(
        generateReconciliationReport("missing-user", [
          makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 500 }),
        ])
      ).rejects.toThrow("User profile not found");
    });

    it("looks the profile up by the userId argument, not by the rows' userId", async () => {
      // The rows all belong to user-1, but the report is asked for user-2, whose
      // profile does not exist. It must fail rather than silently reconcile
      // user-1's ledger against nothing.
      seedProfile({ initialBalance: 10_000, currentBalance: 10_000 });

      await expect(
        generateReconciliationReport("user-2", [
          makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 500 }),
        ])
      ).rejects.toThrow("User profile not found");
    });

    it("writes nothing when the profile is missing", async () => {
      await expect(generateReconciliationReport("missing-user", [])).rejects.toThrow();

      expect(store.__ops).toEqual([]);
    });
  });

  describe("drift from a real production mutation path", () => {
    it("detects the exact drift left behind by a partial update to a completed row", async () => {
      // The scenario this module exists for: the transaction document was updated
      // but the paired `adjustUserBalance` never landed (a failed second write, a
      // crash between the two, a manual repair in the Firestore console). Here the
      // row is mutated DIRECTLY in the store to leave precisely that state, then
      // read back through the real `getTransactions`.
      seedProfile({ initialBalance: 3_000, currentBalance: 3_000 });
      store.__seedEntities("transactions", [
        makeTransaction({
          id: "txn-1",
          type: "expense",
          projectedAmount: 500,
          scheduledDate: "2026-01-10",
          status: "projected",
        }),
      ]);

      // Real completion path: updates the row AND adjusts the profile balance.
      await completeTransaction("txn-1", 500);
      expect(storedBalance()).toBe(2_500);

      const clean = await generateReconciliationReport(USER, await storedRows());
      expect(clean.difference).toBe(0);

      // Partial update: the row now says 800 was paid; the balance still says 500.
      const row = store.__get<Transaction>("transactions", "txn-1");
      expect(row?.actualAmount).toBe(500);
      store.__seed("transactions", "txn-1", { ...row, actualAmount: 800 });

      const drifted = await generateReconciliationReport(USER, await storedRows());

      // Ledger now implies 3000 - 800 = 2200; the profile still holds 2500, i.e.
      // it OVERSTATES the balance by the unrecorded 300.
      expect(drifted.currentBalance).toBe(2_500);
      expect(drifted.computedBalance).toBe(2_200);
      expect(drifted.difference).toBe(300);
      expect(drifted.affectedTransactions).toHaveLength(1);
      expect(drifted.affectedTransactions[0].actualAmount).toBe(800);
    });

    it("detects the drift a UI delete of a completed rule-based row leaves behind", async () => {
      // Entirely real code path, no hand-mutation. Two rule-based bills are paid
      // through `completeTransaction`, then one is deleted through
      // `removeTransactionAction` — the action the transaction list's delete
      // button calls. Its balance reversal is gated on `sourceType === "manual"`
      // (app/contexts/FinancialContext/actions/transactionActions.ts:346), so a
      // completed EXPENSE_RULE row is thrown away with its money still deducted.
      // That defect is pinned as `it.fails` in
      // tests/integration/actualMutation.actions.test.ts:2060; what this test
      // shows is that the reconciliation report — if anything ever called it —
      // would name the resulting drift exactly.
      seedProfile({ initialBalance: 5_000, currentBalance: 5_000 });
      store.__seedEntities("expense_rules", [makeExpenseRule({ id: "exp-1" })]);
      store.__seedEntities("transactions", [
        makeTransaction({
          id: "txn-jan",
          sourceType: "expense_rule",
          sourceId: "exp-1",
          type: "expense",
          projectedAmount: 1_200,
          scheduledDate: "2026-01-01",
          status: "projected",
        }),
        makeTransaction({
          id: "txn-feb",
          sourceType: "expense_rule",
          sourceId: "exp-1",
          type: "expense",
          projectedAmount: 1_200,
          scheduledDate: "2026-02-01",
          status: "projected",
        }),
      ]);

      await completeTransaction("txn-jan", 1_200);
      await completeTransaction("txn-feb", 1_250);
      expect(storedBalance()).toBe(2_550);

      const beforeDelete = await generateReconciliationReport(USER, await storedRows());
      expect(beforeDelete.difference).toBe(0);

      await removeTransactionAction("txn-feb", USER);
      expect(store.__get("transactions", "txn-feb")).toBeUndefined();
      expect(storedBalance()).toBe(2_550); // no reversal happened

      const afterDelete = await generateReconciliationReport(USER, await storedRows());

      // The surviving January payment still reconciles, so the report isolates
      // exactly the orphaned February amount: 1250 left the balance with nothing
      // on the ledger to explain it. This is the only code in the repo that can
      // see that, and nothing in the repo calls it.
      expect(afterDelete.computedBalance).toBe(3_800);
      expect(afterDelete.currentBalance).toBe(2_550);
      expect(afterDelete.difference).toBe(-1_250);
      expect(afterDelete.affectedTransactions).toHaveLength(1);
      expect(afterDelete.affectedTransactions[0].id).toBe("txn-jan");
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: the report invents drift out of floating-point noise.
     *
     * `reconciliation.ts:33` computes `profile.currentBalance - computedBalance`
     * raw, and neither side is rounded. The two numbers are accumulated in
     * DIFFERENT ORDERS over the same binary floats:
     *   - `currentBalance` is maintained incrementally, one payment at a time, in
     *     the order the user completes them (`adjustUserBalance`,
     *     app/lib/firebase/firestore/users.ts:100-107).
     *   - `computedBalance` is a fresh fold over the whole ledger in
     *     `getTransactions` order — `scheduledDate` ascending
     *     (computedBalance.ts:22-31, transactions.ts:88).
     * Float subtraction is not associative, so paying bills out of scheduled
     * order makes the two disagree by ~1e-13 with nothing whatsoever wrong.
     * Below: three ordinary cent-denominated bills (1234.56, 789.01, 45.67 from
     * 3000), paid smallest-first, i.e. not in scheduled order. Every step uses
     * the real `completeTransaction`; no value is hand-set.
     *   3000 - 45.67 - 1234.56 - 789.01 = 930.76            (currentBalance)
     *   3000 - 1234.56 - 789.01 - 45.67 = 930.7600000000001 (computedBalance)
     *
     * The app already knows this is unsafe: BalanceSection.tsx:218 hides the
     * discrepancy banner behind `Math.abs(current - computed) > 0.01`. The
     * dedicated reconciliation API has no such guard, so it reports a
     * discrepancy of -1.1368683772161603e-13 on a perfectly reconciled account —
     * and pairs it with `canAutoFix: true`, inviting a "fix" that writes
     * 930.7600000000001 into the user's balance.
     *
     * CORRECT: `difference` is a currency amount (rendered with `formatCurrency`
     * by the only consumer that shows it); a drift of a ten-thousandth of a cent
     * is no drift, so this must report exactly 0. Any fix that rounds either
     * side, or the difference, to cents satisfies this.
     * OBSERVED: -1.1368683772161603e-13.
     *
     * Deliberately ONE assertion, on `difference` only. No sibling test pins the
     * unrounded `computedBalance`, because a fix is free to round either operand
     * and pinning the noisy intermediate would make the fix read as a regression.
     */
    it.fails("KNOWN DEFECT: reports no drift when the only difference is float noise", async () => {
      seedProfile({ initialBalance: 3_000, currentBalance: 3_000 });
      store.__seedEntities("transactions", [
        makeTransaction({
          id: "txn-rent",
          type: "expense",
          projectedAmount: 1_234.56,
          scheduledDate: "2026-01-05",
          status: "projected",
        }),
        makeTransaction({
          id: "txn-card",
          type: "expense",
          projectedAmount: 789.01,
          scheduledDate: "2026-01-10",
          status: "projected",
        }),
        makeTransaction({
          id: "txn-fee",
          type: "expense",
          projectedAmount: 45.67,
          scheduledDate: "2026-01-20",
          status: "projected",
        }),
      ]);

      // Paid in a different order from the scheduled order — the small fee first.
      await completeTransaction("txn-fee", 45.67);
      await completeTransaction("txn-rent", 1_234.56);
      await completeTransaction("txn-card", 789.01);

      // Nothing has gone wrong: the profile holds the exact cent value.
      expect(storedBalance()).toBe(930.76);

      const report = await generateReconciliationReport(USER, await storedRows());

      expect(report.difference).toBe(0);
    });
  });
});

// ============================================================================
// fixBalanceDiscrepancy
// ============================================================================

describe("fixBalanceDiscrepancy", () => {
  beforeEach(() => store.__reset());

  describe("persistence", () => {
    it("writes the computed balance onto the profile", async () => {
      seedProfile({ initialBalance: 10_000, currentBalance: 10_000 });

      await fixBalanceDiscrepancy(USER, [
        makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 500 }),
      ]);

      expect(storedBalance()).toBe(9_500);
    });

    it("raises the balance when the drift was negative", async () => {
      seedProfile({ initialBalance: 10_000, currentBalance: 6_000 });

      await fixBalanceDiscrepancy(USER, [
        makeCompletedTransaction({ type: "income", projectedAmount: 500, actualAmount: 500 }),
      ]);

      expect(storedBalance()).toBe(10_500);
    });

    it("leaves the transactions untouched", async () => {
      seedProfile({ initialBalance: 10_000, currentBalance: 10_000 });
      const rows = [
        makeCompletedTransaction({
          id: "c1",
          type: "expense",
          projectedAmount: 500,
          actualAmount: 800,
        }),
        makeProjectedTransaction({ id: "p1", type: "expense", projectedAmount: 400 }),
      ];
      store.__seedEntities("transactions", rows);
      const before = store.__all("transactions");

      await fixBalanceDiscrepancy(USER, rows);

      // The repair is balance-only: it never rewrites history to match.
      expect(store.__opsFor("transactions")).toEqual([]);
      expect(store.__all("transactions")).toEqual(before);
      expect(storedBalance()).toBe(9_200);
    });

    it("touches the profile exactly once", async () => {
      seedProfile({ initialBalance: 10_000, currentBalance: 10_000 });

      await fixBalanceDiscrepancy(USER, [
        makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 500 }),
      ]);

      const userOps = store.__opsFor("users");
      expect(userOps).toHaveLength(1);
      expect(userOps[0].op).toBe("update");
    });

    it("ignores projected and skipped rows when deciding the new balance", async () => {
      seedProfile({ initialBalance: 5_000, currentBalance: 1 });

      await fixBalanceDiscrepancy(USER, [
        makeProjectedTransaction({ id: "p", type: "expense", projectedAmount: 1_000 }),
        makeSkippedTransaction({
          id: "s",
          type: "expense",
          projectedAmount: 2_000,
          actualAmount: 2_000,
        }),
        makeCompletedTransaction({
          id: "c",
          type: "expense",
          projectedAmount: 300,
          actualAmount: 300,
        }),
      ]);

      expect(storedBalance()).toBe(4_700);
    });

    it("resolves to void, discarding the balance syncComputedBalance returns", async () => {
      // PINNED API SHAPE (reconciliation.ts:50-55): `fixBalanceDiscrepancy`
      // awaits `syncComputedBalance` but drops its return value, so a caller
      // cannot report or log the balance it just wrote without a second read.
      seedProfile({ initialBalance: 10_000, currentBalance: 10_000 });

      await expect(
        fixBalanceDiscrepancy(USER, [
          makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 500 }),
        ])
      ).resolves.toBeUndefined();
    });
  });

  describe("round trip", () => {
    it("leaves the report at a difference of 0", async () => {
      seedProfile({ initialBalance: 10_000, currentBalance: 10_000 });
      const rows = [
        makeCompletedTransaction({
          id: "c1",
          type: "expense",
          projectedAmount: 500,
          actualAmount: 500,
        }),
        makeCompletedTransaction({
          id: "c2",
          type: "income",
          projectedAmount: 2_000,
          actualAmount: 1_900,
        }),
      ];

      const before = await generateReconciliationReport(USER, rows);
      expect(before.difference).toBe(-1_400); // computed 11400 vs stored 10000

      await fixBalanceDiscrepancy(USER, rows);
      const after = await generateReconciliationReport(USER, rows);

      expect(after.currentBalance).toBe(11_400);
      expect(after.computedBalance).toBe(11_400);
      expect(after.difference).toBe(0);
    });

    it("repairs the drift a UI delete of a completed rule-based row leaves behind", async () => {
      // The full loop the app never runs: real completion, real delete action
      // that skips the balance reversal, detect, fix, re-detect.
      //
      // Worth being clear about what "auto-fix" means here: the repair moves the
      // balance to whatever the SURVIVING ledger says, so it hands the 1200 back.
      // That is right only because the row is genuinely gone — if the payment
      // really happened, the record has already been destroyed and the fix
      // silently un-spends real money. `canAutoFix: true` cannot distinguish the
      // two cases.
      seedProfile({ initialBalance: 5_000, currentBalance: 5_000 });
      store.__seedEntities("expense_rules", [makeExpenseRule({ id: "exp-1" })]);
      store.__seedEntities("transactions", [
        makeTransaction({
          id: "txn-jan",
          sourceType: "expense_rule",
          sourceId: "exp-1",
          type: "expense",
          projectedAmount: 1_200,
          scheduledDate: "2026-01-01",
          status: "projected",
        }),
      ]);

      await completeTransaction("txn-jan", 1_200);
      await removeTransactionAction("txn-jan", USER);

      const drifted = await generateReconciliationReport(USER, await storedRows());
      expect(drifted.difference).toBe(-1_200);

      await fixBalanceDiscrepancy(USER, await storedRows());

      expect(storedBalance()).toBe(5_000);
      const repaired = await generateReconciliationReport(USER, await storedRows());
      expect(repaired.difference).toBe(0);
    });

    it("overwrites a manually entered balance with the computed one", async () => {
      // PINNED TRADE-OFF: the settings screen lets a user type their real bank
      // balance straight into `currentBalance`
      // (BalanceSection.tsx:75 -> updateUserBalance). The fix always treats the
      // ledger as the source of truth, so that manual figure is discarded rather
      // than being taken as evidence that the LEDGER is what is wrong.
      seedProfile({ initialBalance: 10_000, currentBalance: 8_888 });

      await fixBalanceDiscrepancy(USER, []);

      expect(storedBalance()).toBe(10_000);
    });
  });

  describe("idempotence", () => {
    it("produces the same balance when run twice", async () => {
      seedProfile({ initialBalance: 10_000, currentBalance: 10_000 });
      const rows = [
        makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 750 }),
      ];

      await fixBalanceDiscrepancy(USER, rows);
      const first = storedBalance();
      await fixBalanceDiscrepancy(USER, rows);
      const second = storedBalance();

      expect(first).toBe(9_250);
      expect(second).toBe(9_250);
    });

    it("is stable across three runs and stays derived from initialBalance", async () => {
      // Guards the failure mode where a "fix" folds the current balance back in
      // and drifts further on every press of the button.
      seedProfile({ initialBalance: 1_000, currentBalance: 1_000 });
      const rows = [
        makeCompletedTransaction({ type: "expense", projectedAmount: 100, actualAmount: 100 }),
      ];

      const seen: (number | undefined)[] = [];
      for (let run = 0; run < 3; run += 1) {
        await fixBalanceDiscrepancy(USER, rows);
        seen.push(storedBalance());
      }

      expect(seen).toEqual([900, 900, 900]);
    });

    it("still writes when there is nothing to fix", async () => {
      // PINNED: the fix is unconditional — it does not consult the report or
      // compare against the stored balance first, so calling it on a reconciled
      // profile costs a write (and re-stamps `balanceLastUpdatedAt`).
      seedProfile({ initialBalance: 10_000, currentBalance: 9_500 });
      const rows = [
        makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 500 }),
      ];

      await fixBalanceDiscrepancy(USER, rows);

      expect(storedBalance()).toBe(9_500);
      expect(store.__opsFor("users")).toHaveLength(1);
    });
  });

  describe("missing profile", () => {
    it("propagates the error when the user profile does not exist", async () => {
      await expect(fixBalanceDiscrepancy("missing-user", [])).rejects.toThrow(
        "User profile not found"
      );
    });

    it("propagates the error even when transactions were supplied", async () => {
      await expect(
        fixBalanceDiscrepancy("missing-user", [
          makeCompletedTransaction({ type: "expense", projectedAmount: 500, actualAmount: 500 }),
        ])
      ).rejects.toThrow("User profile not found");
    });

    it("writes nothing when the profile is missing", async () => {
      await expect(fixBalanceDiscrepancy("missing-user", [])).rejects.toThrow();

      expect(store.__ops).toEqual([]);
    });

    it("does not touch another user's profile when the target is missing", async () => {
      seedProfile({ initialBalance: 10_000, currentBalance: 10_000 });

      await expect(fixBalanceDiscrepancy("user-2", [])).rejects.toThrow("User profile not found");

      expect(storedBalance()).toBe(10_000);
    });
  });
});
