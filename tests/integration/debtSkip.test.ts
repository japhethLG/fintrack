import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("firebase/firestore", () => import("../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../helpers/firebaseConfigMock"));

import type { ExpenseRule, Transaction, UserProfile } from "@/lib/types";
import {
  markTransactionCompleteAction,
  markTransactionSkippedAction,
} from "@/contexts/FinancialContext/actions/transactionActions";
import * as store from "../helpers/firestoreEmulator";
import { makeCreditRule, makeExpenseRule, makeInstallmentRule, makeLoanRule, makeUserProfile } from "../helpers/builders";
import { freezeToday } from "../helpers/time";
import { DebtSkipError } from "@/lib/utils/debtRules";

/**
 * Decision 2026-10-02: a loan / credit card / installment payment is OWED. It can be moved to another day
 * or left unpaid (then it shows as overdue), never skipped. A skip used to hide a payment still owed: the
 * remaining schedule could no longer clear the balance (a 6-payment loan showed 5 after one skip).
 */

const USER = "user-1";
const rules = () => store.__all<ExpenseRule>("expense_rules") as ExpenseRule[];
const rows = () => store.__all<Transaction>("transactions") as Transaction[];
const balance = () => store.__get<UserProfile>("users", USER)!.currentBalance;
const skip = (id: string) => markTransactionSkippedAction(id, undefined, USER, [], rules());

beforeEach(() => {
  store.__reset();
  freezeToday("2026-01-01");
  store.__seed("users", USER, makeUserProfile({ uid: USER, currentBalance: 20_000 }) as unknown as Record<string, unknown>);
  store.__seedEntities("expense_rules", [
    makeLoanRule({ id: "loan-1", userId: USER, startDate: "2026-01-01" }),
    makeCreditRule({ id: "card-1", userId: USER, startDate: "2026-01-01" }),
    makeInstallmentRule({ id: "inst-1", userId: USER, startDate: "2026-01-05" }),
    makeExpenseRule({ id: "gym", userId: USER, amount: 50, startDate: "2026-01-10", scheduleConfig: { dayOfMonth: 10 } }),
  ]);
});

describe("debt payments cannot be skipped", () => {
  it.each([
    ["loan", "proj_loan-1::2026-02-01::loan-1_2026-02"],
    ["credit card", "proj_card-1::2026-02-15::card-1_2026-02"],
    ["installment", "proj_inst-1::2026-02-05::inst-1_2026-02"],
  ])("a projected %s payment: the skip is refused and nothing is written", async (_kind, id) => {
    const rulesBefore = JSON.stringify(rules());
    await expect(skip(id)).rejects.toBeInstanceOf(DebtSkipError);
    expect(rows()).toEqual([]);
    expect(JSON.stringify(rules())).toBe(rulesBefore);
    expect(balance()).toBe(20_000);
  });

  it("a completed card payment: the skip is refused and the payment stays completed", async () => {
    await markTransactionCompleteAction("proj_card-1::2026-01-15::card-1_2026-01", { actualAmount: 100 }, USER, [], rules());
    const [paid] = rows();
    const cardBefore = rules().find((r) => r.id === "card-1")!.creditConfig;

    await expect(skip(paid.id)).rejects.toBeInstanceOf(DebtSkipError);

    expect(rows().map((t) => t.status)).toEqual(["completed"]);
    expect(rules().find((r) => r.id === "card-1")!.creditConfig).toEqual(cardBefore);
    expect(balance()).toBe(19_900);
  });

  it("an ordinary bill can still be skipped", async () => {
    await skip("proj_gym::2026-01-10::gym_2026-01");
    expect(rows().map((t) => [t.sourceId, t.status])).toEqual([["gym", "skipped"]]);
    expect(balance()).toBe(20_000);
  });
});
