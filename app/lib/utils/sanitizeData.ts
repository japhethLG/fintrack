import type { ExpenseRule, IncomeSource, OccurrenceOverride, Transaction } from "@/lib/types";

/**
 * Ingestion guard for hostile or legacy documents (E2E-ROB-09/10).
 *
 * Firestore has no schema and (in this repo) no rules, so any document shape can reach the client:
 * `amount: null`, `"abc"`, NaN. The calculators and the UI assume finite numbers; one bad rule used to
 * crash the Calendar and print NaN on five screens.
 *
 * Policy, applied once at the subscription boundary:
 *  - nothing is dropped silently and nothing is written back: the stored document is untouched;
 *  - a numeric STRING ("1250.50") is a legacy way of storing a number: coerced, not reported;
 *  - any other bad money field becomes 0 (a bad optional `actualAmount`/`variance`/override amount is removed);
 *  - a rule or source with a bad number is set INACTIVE, so it projects nothing and cannot feed a 0 or NaN
 *    into a schedule, but it stays visible in Income / Expenses where the user can fix or delete it;
 *  - the record is reported as a DataIssue; the app shows a non-blocking "N items have invalid data" notice.
 */

export type DataIssueKind = "income_source" | "expense_rule" | "transaction";

export interface DataIssue {
  kind: DataIssueKind;
  id: string;
  name: string;
  /** Dotted paths of the fields that were repaired, e.g. "amount", "loanConfig.principalAmount". */
  fields: string[];
}

export interface Sanitized<T> {
  items: T[];
  issues: DataIssue[];
}

/** A finite number from a number or a numeric string; null for anything else. */
const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/**
 * Check a required number: ok (maybe coerced from a numeric string), or bad (reported, replaced by 0).
 * Returns the value to store and whether it changed.
 */
const requiredNumber = (value: unknown): { value: number; changed: boolean; bad: boolean } => {
  const n = toNumber(value);
  if (n === null) return { value: 0, changed: true, bad: true };
  return { value: n, changed: n !== value, bad: false };
};

/** Optional number: absent (undefined or null) stays absent; present but unusable is bad. */
const optionalNumber = (
  value: unknown
): { value: number | undefined; changed: boolean; bad: boolean } => {
  if (value === undefined) return { value: undefined, changed: false, bad: false };
  if (value === null) return { value: undefined, changed: true, bad: false };
  const n = toNumber(value);
  if (n === null) return { value: undefined, changed: true, bad: true };
  return { value: n, changed: n !== value, bad: false };
};

interface ConfigFields {
  /** Present-but-unusable (null, NaN, text) is an issue and becomes 0; absent is left alone. */
  required: readonly string[];
  /** Absent or null means "not set"; present-but-unusable text is an issue and is removed. */
  optional: readonly string[];
}

const LOAN_FIELDS: ConfigFields = {
  required: ["principalAmount", "currentBalance", "interestRate", "termMonths", "monthlyPayment"],
  optional: ["paymentsMade"],
};
const CREDIT_FIELDS: ConfigFields = {
  required: [
    "creditLimit",
    "currentBalance",
    "apr",
    "minimumPaymentPercent",
    "minimumPaymentFloor",
    "statementDate",
    "dueDate",
  ],
  optional: ["fixedPaymentAmount", "paymentsMade"],
};
const INSTALLMENT_FIELDS: ConfigFields = {
  required: ["totalAmount", "installmentCount", "installmentAmount", "installmentsPaid"],
  optional: ["interestRate"],
};

/** Repair the numbers of one nested config. A field that is simply absent is not an issue (legacy data). */
const sanitizeConfig = <C extends object>(
  config: C,
  path: string,
  fields: ConfigFields,
  reported: string[]
): { config: C; changed: boolean } => {
  const source = config as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  for (const field of fields.required) {
    if (source[field] === undefined) continue;
    const { value, changed, bad } = requiredNumber(source[field]);
    if (!changed) continue;
    next ??= { ...source };
    next[field] = value;
    if (bad) reported.push(`${path}.${field}`);
  }
  for (const field of fields.optional) {
    if (source[field] === undefined) continue;
    const { value, changed, bad } = optionalNumber(source[field]);
    if (!changed) continue;
    next ??= { ...source };
    if (value === undefined) delete next[field];
    else next[field] = value;
    if (bad) reported.push(`${path}.${field}`);
  }
  return next ? { config: next as C, changed: true } : { config, changed: false };
};

/** Drop an unusable `amount` from each occurrence override. */
const sanitizeOverrides = (
  overrides: Record<string, OccurrenceOverride> | undefined,
  fields_out: string[]
): { overrides: Record<string, OccurrenceOverride> | undefined; changed: boolean } => {
  if (!overrides || typeof overrides !== "object") return { overrides, changed: false };
  let next: Record<string, OccurrenceOverride> | null = null;
  for (const [key, override] of Object.entries(overrides)) {
    if (!override || typeof override !== "object" || !("amount" in override)) continue;
    const { value, changed, bad } = optionalNumber(override.amount);
    if (!changed) continue;
    next ??= { ...overrides };
    const { amount: _amount, ...rest } = override;
    void _amount;
    next[key] = value === undefined ? rest : { ...rest, amount: value };
    if (bad) fields_out.push(`occurrenceOverrides.${key}.amount`);
  }
  return next ? { overrides: next, changed: true } : { overrides, changed: false };
};

export const sanitizeIncomeSources = (sources: IncomeSource[]): Sanitized<IncomeSource> => {
  const issues: DataIssue[] = [];
  const items = sources.map((source) => {
    const reported: string[] = [];
    let next: IncomeSource = source;
    const amount = requiredNumber(source.amount);
    if (amount.changed) {
      next = { ...next, amount: amount.value };
      if (amount.bad) reported.push("amount");
    }
    const overrides = sanitizeOverrides(source.occurrenceOverrides, reported);
    if (overrides.changed) next = { ...next, occurrenceOverrides: overrides.overrides };
    if (amount.bad) next = { ...next, isActive: false };
    if (reported.length > 0) {
      issues.push({ kind: "income_source", id: source.id, name: source.name, fields: reported });
    }
    return next;
  });
  return { items, issues };
};

export const sanitizeExpenseRules = (rules: ExpenseRule[]): Sanitized<ExpenseRule> => {
  const issues: DataIssue[] = [];
  const items = rules.map((rule) => {
    const reported: string[] = [];
    let next: ExpenseRule = rule;
    let deactivate = false;

    const amount = requiredNumber(rule.amount);
    if (amount.changed) {
      next = { ...next, amount: amount.value };
      if (amount.bad) {
        reported.push("amount");
        deactivate = true;
      }
    }
    const nestedBefore = reported.length;
    if (rule.loanConfig) {
      const r = sanitizeConfig(rule.loanConfig, "loanConfig", LOAN_FIELDS, reported);
      if (r.changed) next = { ...next, loanConfig: r.config };
    }
    if (rule.creditConfig) {
      const r = sanitizeConfig(rule.creditConfig, "creditConfig", CREDIT_FIELDS, reported);
      if (r.changed) next = { ...next, creditConfig: r.config };
    }
    if (rule.installmentConfig) {
      const r = sanitizeConfig(rule.installmentConfig, "installmentConfig", INSTALLMENT_FIELDS, reported);
      if (r.changed) next = { ...next, installmentConfig: r.config };
    }
    if (reported.length > nestedBefore) deactivate = true;

    const overrides = sanitizeOverrides(rule.occurrenceOverrides, reported);
    if (overrides.changed) next = { ...next, occurrenceOverrides: overrides.overrides };

    if (deactivate) next = { ...next, isActive: false };
    if (reported.length > 0) {
      issues.push({ kind: "expense_rule", id: rule.id, name: rule.name, fields: reported });
    }
    return next;
  });
  return { items, issues };
};

export const sanitizeTransactions = (transactions: Transaction[]): Sanitized<Transaction> => {
  const issues: DataIssue[] = [];
  const items = transactions.map((txn) => {
    const reported: string[] = [];
    let next: Transaction = txn;

    const projected = requiredNumber(txn.projectedAmount);
    if (projected.changed) {
      next = { ...next, projectedAmount: projected.value };
      if (projected.bad) reported.push("projectedAmount");
    }
    for (const field of ["actualAmount", "variance"] as const) {
      if (!(field in txn)) continue;
      const result = optionalNumber(txn[field]);
      if (!result.changed) continue;
      const { [field]: _removed, ...rest } = next;
      void _removed;
      next = (result.value === undefined ? rest : { ...rest, [field]: result.value }) as Transaction;
      if (result.bad) reported.push(field);
    }

    if (reported.length > 0) {
      issues.push({ kind: "transaction", id: txn.id, name: txn.name, fields: reported });
    }
    return next;
  });
  return { items, issues };
};

/** Copy for the notice: "N item(s) have invalid data" plus the first few names. */
export const describeDataIssues = (
  issues: DataIssue[],
  maxNames = 3
): { title: string; names: string[]; more: number } | null => {
  if (issues.length === 0) return null;
  const count = issues.length;
  return {
    title: `${count} ${count === 1 ? "item has" : "items have"} invalid data`,
    names: issues.slice(0, maxNames).map((i) => i.name),
    more: Math.max(0, count - maxNames),
  };
};
