import {
  IncomeSource,
  ExpenseRule,
  IncomeSourceFormData,
  ExpenseRuleFormData,
  OccurrenceOverride,
} from "@/lib/types";
import {
  addIncomeSource,
  updateIncomeSource,
  deleteIncomeSource,
  addExpenseRule,
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

/**
 * Update an existing income source
 */
export async function editIncomeSourceAction(
  id: string,
  data: Partial<IncomeSourceFormData>
): Promise<void> {
  await updateIncomeSource(id, data);
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
  await updateExpenseRule(id, data);
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

