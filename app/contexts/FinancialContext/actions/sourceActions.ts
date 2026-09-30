import {
  IncomeSource,
  ExpenseRule,
  IncomeSourceFormData,
  ExpenseRuleFormData,
  OccurrenceOverride,
} from "@/lib/types";
import { deleteField } from "firebase/firestore";
import {
  addIncomeSource,
  updateIncomeSource,
  deleteIncomeSource,
  addExpenseRule,
  getExpenseRule,
  updateExpenseRule,
  deleteExpenseRule,
  setIncomeSourceOverride,
  removeIncomeSourceOverride,
  setExpenseRuleOverride,
  removeExpenseRuleOverride,
} from "@/lib/firebase/firestore";

// ============================================================================
// INCOME SOURCE ACTIONS
// ============================================================================

/**
 * Create a new income source
 */
export async function createIncomeSourceAction(
  data: IncomeSourceFormData,
  userId: string
): Promise<IncomeSource> {
  return addIncomeSource(userId, {
    ...data,
    isActive: true,
  });
}

// ============================================================================
// EDIT PAYLOADS
//
// A form edit sends the WHOLE form, so three things must not happen by accident:
//   - a cleared optional value must be REMOVED (the Firestore layer drops `undefined`, so a
//     present-but-undefined `endDate` / `notes` is translated to `deleteField()` here);
//   - activation is changed by the Activate / Deactivate button only, never by an edit;
//   - nested progress (`paymentsMade`, `installmentsPaid`) and any config field the form does not manage
//     survive, because a top-level key in an update REPLACES the whole nested object.
// ============================================================================

/** Stored values an edit may clear by sending the key with the value `undefined`. */
const CLEARABLE_KEYS = ["endDate", "notes"] as const;

const withClearedValues = <T extends object>(data: T): Record<string, unknown> => {
  const update: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const key of CLEARABLE_KEYS) {
    if (key in data && update[key] === undefined) update[key] = deleteField();
  }
  return update;
};

/** The update an income-source edit writes. */
export function buildIncomeSourceUpdate(
  data: Partial<IncomeSourceFormData>
): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { isActive, ...rest } = data;
  return withClearedValues(rest);
}

/**
 * The update an expense-rule edit writes, merged over the stored rule `existing`:
 * `loanConfig` / `installmentConfig` / `creditConfig` keep every stored field the form did not send, the
 * progress counters always come from the stored rule, and a config that no longer applies (the type was
 * changed in the wizard) is removed.
 */
export function buildExpenseRuleUpdate(
  existing: ExpenseRule | null,
  data: Partial<ExpenseRuleFormData>
): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { isActive, ...rest } = data;
  const update = withClearedValues(rest);

  if (data.loanConfig) {
    update.loanConfig = {
      ...existing?.loanConfig,
      ...data.loanConfig,
      paymentsMade: existing?.loanConfig?.paymentsMade ?? data.loanConfig.paymentsMade ?? 0,
    };
  }
  if (data.installmentConfig) {
    update.installmentConfig = {
      ...existing?.installmentConfig,
      ...data.installmentConfig,
      installmentsPaid:
        existing?.installmentConfig?.installmentsPaid ?? data.installmentConfig.installmentsPaid ?? 0,
    };
  }
  if (data.creditConfig) {
    const merged: Record<string, unknown> = { ...existing?.creditConfig, ...data.creditConfig };
    if (!("fixedPaymentAmount" in data.creditConfig)) delete merged.fixedPaymentAmount;
    update.creditConfig = merged;
  }

  // Changing the type drops the previous type's config instead of leaving it to be projected
  if (data.expenseType) {
    if (data.expenseType !== "cash_loan" && existing?.loanConfig) update.loanConfig = deleteField();
    if (data.expenseType !== "credit_card" && existing?.creditConfig) {
      update.creditConfig = deleteField();
    }
    if (data.expenseType !== "installment" && existing?.installmentConfig) {
      update.installmentConfig = deleteField();
    }
  }
  return update;
}

/**
 * Update an existing income source
 */
export async function editIncomeSourceAction(
  id: string,
  data: Partial<IncomeSourceFormData>
): Promise<void> {
  await updateIncomeSource(id, buildIncomeSourceUpdate(data) as Partial<IncomeSourceFormData>);
}

/**
 * Delete an income source
 */
export async function removeIncomeSourceAction(id: string): Promise<void> {
  await deleteIncomeSource(id);
}

/**
 * Toggle income source active state
 */
export async function toggleIncomeSourceActiveAction(id: string, isActive: boolean): Promise<void> {
  await updateIncomeSource(id, { isActive });
}

// ============================================================================
// EXPENSE RULE ACTIONS
// ============================================================================

/**
 * Create a new expense rule with tracking fields initialized
 */
export async function createExpenseRuleAction(
  data: ExpenseRuleFormData,
  userId: string
): Promise<ExpenseRule> {
  const ruleData: Omit<ExpenseRule, "id" | "userId" | "createdAt" | "updatedAt"> = {
    ...data,
    isActive: true,
    loanConfig: data.loanConfig ? { ...data.loanConfig, paymentsMade: 0 } : undefined,
    installmentConfig: data.installmentConfig
      ? { ...data.installmentConfig, installmentsPaid: 0 }
      : undefined,
  };

  return addExpenseRule(userId, ruleData);
}

/**
 * Update an existing expense rule
 */
export async function editExpenseRuleAction(
  id: string,
  data: Partial<ExpenseRuleFormData>
): Promise<void> {
  const existing = await getExpenseRule(id);
  await updateExpenseRule(
    id,
    buildExpenseRuleUpdate(existing, data) as Partial<ExpenseRuleFormData>
  );
}

/**
 * Delete an expense rule
 */
export async function removeExpenseRuleAction(id: string): Promise<void> {
  await deleteExpenseRule(id);
}

/**
 * Toggle expense rule active state
 */
export async function toggleExpenseRuleActiveAction(id: string, isActive: boolean): Promise<void> {
  await updateExpenseRule(id, { isActive });
}

/**
 * Set an occurrence-level override for a source or rule
 */
export async function setOccurrenceOverrideAction(
  sourceId: string,
  occurrenceId: string,
  override: OccurrenceOverride,
  isIncome: boolean
): Promise<void> {
  if (isIncome) {
    await setIncomeSourceOverride(sourceId, occurrenceId, override);
  } else {
    await setExpenseRuleOverride(sourceId, occurrenceId, override);
  }
}

/**
 * Remove an occurrence-level override for a source or rule
 */
export async function removeOccurrenceOverrideAction(
  sourceId: string,
  occurrenceId: string,
  isIncome: boolean
): Promise<void> {
  if (isIncome) {
    await removeIncomeSourceOverride(sourceId, occurrenceId);
  } else {
    await removeExpenseRuleOverride(sourceId, occurrenceId);
  }
}

