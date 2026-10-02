import type { ExpenseRule, Transaction } from "@/lib/types";

/**
 * Debt plans: a loan, a credit card or an installment plan. Their payments are OWED, so they cannot be
 * skipped (decision 2026-10-02): a payment the user can't make on its date is moved to the day they will
 * pay, or left unpaid, and then it shows as overdue until it is marked paid. Skipping one used to hide a
 * payment that was still owed (the plan's remaining schedule could no longer clear its balance).
 */
export const DEBT_EXPENSE_TYPES: readonly ExpenseRule["expenseType"][] = ["cash_loan", "credit_card", "installment"];

type DebtLike = Pick<ExpenseRule, "expenseType"> &
  Partial<Pick<ExpenseRule, "loanConfig" | "creditConfig" | "installmentConfig">>;

/** True for a loan, card or installment plan (by its type, or by the plan config it carries). */
export const isDebtRule = (rule: DebtLike | null | undefined): boolean =>
  !!rule &&
  (DEBT_EXPENSE_TYPES.includes(rule.expenseType) || !!rule.loanConfig || !!rule.creditConfig || !!rule.installmentConfig);

/** The debt rule a transaction pays, if it pays one. */
export const debtRuleOf = (
  transaction: Pick<Transaction, "sourceType" | "sourceId">,
  expenseRules: readonly ExpenseRule[]
): ExpenseRule | undefined => {
  if (transaction.sourceType !== "expense_rule" || !transaction.sourceId) return undefined;
  const rule = expenseRules.find((r) => r.id === transaction.sourceId);
  return isDebtRule(rule) ? rule : undefined;
};

/** What the dialog says instead of offering Skip on a debt payment. */
export const DEBT_PAYMENT_HINT =
  "Can't pay on this date? Drag it to the day you'll pay. If you leave it, it stays overdue until you mark it paid.";

/** Refusal raised by the write path when something still tries to skip a debt payment. */
export class DebtSkipError extends Error {
  constructor() {
    super("A loan, credit card or installment payment can't be skipped: it is still owed. " + DEBT_PAYMENT_HINT);
    this.name = "DebtSkipError";
  }
}
