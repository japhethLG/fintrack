/**
 * Balance tools: the operations that set the balance from the LEDGER rather than
 * from a transaction gesture (Recalculate, Override Current Balance, Update
 * Initial Balance, the one-time rebase).
 *
 * They all read the user's completed rows straight from Firestore (never from a
 * UI list, which is merged and windowed: that was the source of the wrong
 * "Recalculate Balance" writes, UI-BAL-06/07/08) and they all keep
 *
 *   currentBalance == initialBalance + SUM(signed(completed stored rows))
 *
 * A row can complete while one of these runs (another tab). The sum is read
 * outside the transaction (the web SDK cannot run a query inside one), so the
 * transaction re-reads the profile and refuses to write if the profile moved
 * since the sum was taken; every completion moves `currentBalance`, so this
 * detects it, and the tool simply tries again.
 */

import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
} from "firebase/firestore";
import { db } from "../config";
import { Transaction, UserProfile } from "@/lib/types";
import { cleanMoney, sumLedger } from "@/lib/logic/balanceCalculator/ledgerMath";
import { getTodayKey } from "@/lib/utils/dateUtils";

/** Every COMPLETED stored row of a user (the only rows the realized balance is made of). */
export const getCompletedTransactions = async (userId: string): Promise<Transaction[]> => {
  const snapshot = await getDocs(
    query(
      collection(db, "transactions"),
      where("userId", "==", userId),
      where("status", "==", "completed")
    )
  );
  return snapshot.docs.map((row) => ({ id: row.id, ...row.data() }) as Transaction);
};

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const MAX_ATTEMPTS = 3;

export interface BalanceSnapshot {
  /** initialBalance before the operation. */
  initialBalance: number;
  /** currentBalance before the operation. */
  currentBalance: number;
  /** SUM(signed(completed)) of the stored rows the operation used. */
  ledgerSum: number;
}

/**
 * Run `decide` against a consistent (profile, ledger sum) pair and write what it
 * returns. `decide` returns the new `{ initialBalance, currentBalance }`.
 */
const withLedgerSnapshot = async (
  userId: string,
  decide: (snapshot: BalanceSnapshot) => { initialBalance: number; currentBalance: number }
): Promise<{ before: BalanceSnapshot; after: { initialBalance: number; currentBalance: number } }> => {
  const userRef = doc(db, "users", userId);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const profileSnap = await getDoc(userRef);
    if (!profileSnap.exists()) throw new Error("User profile not found");
    const profile = profileSnap.data() as UserProfile;
    const ledgerSum = sumLedger(await getCompletedTransactions(userId));

    const before: BalanceSnapshot = {
      initialBalance: finiteOr(profile.initialBalance, 0),
      currentBalance: finiteOr(profile.currentBalance, 0),
      ledgerSum,
    };
    const after = decide(before);

    const committed = await runTransaction(db, async (tx) => {
      const fresh = await tx.get(userRef);
      if (!fresh.exists()) throw new Error("User profile not found");
      const now = fresh.data() as UserProfile;
      if (
        now.currentBalance !== profile.currentBalance ||
        now.initialBalance !== profile.initialBalance
      ) {
        return false; // a completion landed after the sum was taken: start over
      }
      tx.update(userRef, {
        initialBalance: cleanMoney(after.initialBalance),
        currentBalance: cleanMoney(after.currentBalance),
        balanceLastUpdatedAt: getTodayKey(),
        updatedAt: Timestamp.now(),
      });
      return true;
    });
    if (committed) return { before, after };
  }
  throw new Error("Your balance changed while it was being updated. Please try again.");
};

/**
 * Recovery tool behind "Recalculate Balance": set `currentBalance` to
 * `initialBalance + SUM(signed(completed))` over ALL stored completed rows.
 */
export const recalculateBalance = async (
  userId: string
): Promise<{ previous: number; computed: number }> => {
  const { before, after } = await withLedgerSnapshot(userId, (s) => ({
    initialBalance: s.initialBalance,
    currentBalance: s.initialBalance + s.ledgerSum,
  }));
  return { previous: before.currentBalance, computed: after.currentBalance };
};

/**
 * "Update Initial Balance": the baseline changes and the current balance follows,
 * so the invariant holds.
 */
export const setInitialBalance = async (userId: string, initialBalance: number): Promise<number> => {
  const { after } = await withLedgerSnapshot(userId, (s) => ({
    initialBalance,
    currentBalance: initialBalance + s.ledgerSum,
  }));
  return after.currentBalance;
};

/**
 * "Override Current Balance": the user states what the balance really is (for
 * example after comparing with the bank). The history is left exactly as it is
 * and the BASELINE absorbs the correction:
 *
 *   initialBalance = target - SUM(signed(completed))
 *
 * so the invariant keeps holding, Recalculate does not undo the override, and no
 * fake income/expense entry pollutes totals, charts or the health score.
 */
export const overrideCurrentBalance = async (userId: string, target: number): Promise<void> => {
  if (!Number.isFinite(target)) throw new Error("Balance must be a number");
  await withLedgerSnapshot(userId, (s) => ({
    initialBalance: target - s.ledgerSum,
    currentBalance: target,
  }));
};
