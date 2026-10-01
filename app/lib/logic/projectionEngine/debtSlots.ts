/**
 * Payment SLOTS of a debt plan (loan, credit card, installment plan).
 *
 * Slot k (0-based) is the k-th monthly due date of the plan counted from its anchor: for a loan or an
 * installment plan `monthlyPaymentDate(startDate, dayOfMonth, k)`, for a card the due day of the k-th
 * month from its first due date. A slot's identity is the occurrence id of its LOGICAL date (never the
 * weekend-shifted or dragged date), the same id a completed payment row carries.
 *
 * Which slots are paid is recorded on the plan as `paidOccurrenceIds`, maintained by the ledger in the
 * same transaction as the payment counter. Payments are not always made in order (a later month paid
 * early, an earlier one reverted), so the remaining schedule goes to the plan's UNPAID slots, earliest
 * first, rather than to "the slots after the first `paymentsMade`" (MANUAL-M9).
 *
 * Plans written before the list existed, or whose list no longer matches the counter or the slots
 * (an edit moved the start date to another month), fall back to the old reading: the first
 * `paymentsMade` slots are the paid ones.
 */

import { ExpenseRule } from "@/lib/types";
import { parseDate } from "@/lib/utils/dateUtils";
import { monthlyPaymentDate } from "./dateUtils";
import { generateOccurrenceId } from "./occurrenceIdGenerator";

type DebtRule = Pick<
  ExpenseRule,
  "id" | "frequency" | "startDate" | "scheduleConfig" | "loanConfig" | "creditConfig" | "installmentConfig"
>;

const pad = (n: number): string => String(n).padStart(2, "0");

/** Date of `day` in month `monthIndex` (0-based, may overflow the year), clamped to that month's length. */
export const dueDateInMonth = (year: number, monthIndex: number, day: number): Date => {
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return parseDate(`${y}-${pad(m + 1)}-${pad(Math.min(day, lastDay))}`);
};

/** A usable day of month, 1-31; anything else falls back to `fallback`. */
export const usableDay = (day: number, fallback: number): number =>
  Number.isFinite(day) && day >= 1 ? Math.min(31, Math.floor(day)) : fallback;

/** The card's first due date: its due day in the start month (clamped), or next month's if already past. */
const firstCardDue = (rule: DebtRule): { year: number; month: number; day: number } => {
  const start = parseDate(rule.startDate);
  const day = usableDay(rule.creditConfig!.dueDate, start.getDate());
  let year = start.getFullYear();
  let month = start.getMonth();
  if (dueDateInMonth(year, month, day) < start) {
    month += 1;
    year += Math.floor(month / 12);
    month %= 12;
  }
  return { year, month, day };
};

/** Logical date of slot `k`. */
export const debtSlotDate = (rule: DebtRule, k: number): Date => {
  if (rule.creditConfig && !rule.loanConfig) {
    const first = firstCardDue(rule);
    return dueDateInMonth(first.year, first.month + k, first.day);
  }
  return monthlyPaymentDate(parseDate(rule.startDate), rule.scheduleConfig?.dayOfMonth, k);
};

/** Occurrence id of slot `k` (a `one-time` frequency is monthly for identity, as in the generators). */
export const debtSlotId = (rule: DebtRule, k: number, date: Date = debtSlotDate(rule, k)): string =>
  generateOccurrenceId(
    rule.id,
    rule.frequency === "one-time" ? "monthly" : rule.frequency,
    date,
    rule.startDate,
    rule.scheduleConfig
  );

/** The plan's payment counter (`paymentsMade` / `installmentsPaid`), a whole number >= 0. */
export const debtPaymentsMade = (rule: DebtRule): number => {
  const raw = rule.loanConfig
    ? rule.loanConfig.paymentsMade
    : rule.creditConfig
      ? rule.creditConfig.paymentsMade
      : rule.installmentConfig?.installmentsPaid;
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw as number)) : 0;
};

const storedPaidIds = (rule: DebtRule): unknown =>
  (rule.loanConfig ?? rule.creditConfig ?? rule.installmentConfig)?.paidOccurrenceIds;

/**
 * The paid slots' occurrence ids. The stored list is trusted only when it is consistent: one distinct
 * id per counted payment, each naming one of the plan's slots within reach (`horizon` slots). Otherwise
 * the first `paymentsMade` slots are taken as paid (the reading before the list existed).
 */
export const resolvePaidIds = (rule: DebtRule, horizon?: number): string[] => {
  const made = debtPaymentsMade(rule);
  const stored = storedPaidIds(rule);
  if (Array.isArray(stored) && stored.length === made && new Set(stored).size === made) {
    const reach = Math.max(horizon ?? 0, made) + made + 1;
    const ids = new Set(Array.from({ length: reach }, (_, k) => debtSlotId(rule, k)));
    if (stored.every((id) => typeof id === "string" && ids.has(id))) return [...(stored as string[])];
  }
  return Array.from({ length: made }, (_, k) => debtSlotId(rule, k));
};

export interface DebtSlot {
  /** 0-based slot position; the payment number is `index + 1`. */
  index: number;
  id: string;
  date: Date;
}

/** The first `count` UNPAID slots, earliest first: where the remaining schedule's payments fall. */
export const unpaidSlots = (rule: DebtRule, count: number): DebtSlot[] => {
  const paid = new Set(resolvePaidIds(rule, count));
  const slots: DebtSlot[] = [];
  for (let k = 0; slots.length < count && k < count + paid.size + 1; k++) {
    const date = debtSlotDate(rule, k);
    const id = debtSlotId(rule, k, date);
    if (!paid.has(id)) slots.push({ index: k, id, date });
  }
  return slots;
};
