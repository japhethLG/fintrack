import * as yup from "yup";
import {
  ExpenseType,
  ExpenseCategory,
  ExpenseRule,
  ExpenseRuleFormData,
  IncomeFrequency,
  ScheduleConfig,
  LoanCalculationType,
  CreditPaymentStrategy,
  MinimumPaymentMethod,
} from "@/lib/types";
import {
  calculateAmortizationSchedule,
  calculateLoanPaymentAmount,
  sumScheduleInterest,
  type AmortizationStep,
} from "@/lib/logic/amortization";
import { getTodayKey, parseDate } from "@/lib/utils/dateUtils";
import {
  buildScheduleConfig as buildSharedScheduleConfig,
  startDateParts,
  toWholeNumber,
  validateSchedule,
  type RuleIssue,
} from "@/lib/logic/ruleSchedule";

// ============================================================================
// FORM SCHEMA TYPES
// ============================================================================

export interface ExpenseRuleFormValues {
  // Basic info
  expenseType: ExpenseType;
  name: string;
  amount: string;
  isVariableAmount: boolean;
  category: ExpenseCategory;
  isPriority: boolean;

  // Schedule
  frequency: IncomeFrequency;
  startDate: string;
  endDate: string;
  hasEndDate: boolean;
  weekendAdjustment: "before" | "after" | "none";
  specificDays: number[];
  /** Number, or the string a form input hands back. Follows the start date until the user changes it. */
  dayOfWeek: number | string;
  dayOfMonth: number | string;
  /** Carried through an edit untouched (no input): month of a yearly rule, weeks between bi-weekly payments. */
  monthOfYear?: number;
  intervalWeeks?: number;
  /** Carried through an edit untouched: an edit must not reactivate a deactivated rule or reset progress. */
  isActive: boolean;
  loanPaymentsMade: number;
  installmentsPaid: number;

  // Loan config
  loanPrincipal: string;
  loanCurrentBalance: string;
  loanInterestRate: string;
  loanTermMonths: string;
  loanCalculationType: LoanCalculationType;
  loanStartDate: string;

  // Credit config
  creditLimit: string;
  creditBalance: string;
  creditApr: string;
  creditMinPaymentPercent: string;
  creditMinPaymentFloor: string;
  creditStatementDate: string;
  creditDueDate: string;
  creditPaymentStrategy: CreditPaymentStrategy;
  creditMinPaymentMethod: MinimumPaymentMethod;
  creditFixedPayment: string;

  // Installment config
  installmentTotal: string;
  installmentCount: string;
  installmentHasInterest: boolean;
  installmentInterestRate: string;

  // Notes
  notes: string;
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

export const getDefaultValues = (
  initialData?: Partial<ExpenseRuleFormValues>
): ExpenseRuleFormValues => {
  // The start date is a LOCAL calendar day; the hidden schedule values default FROM IT, never from today.
  const startDate = initialData?.startDate || getTodayKey();
  const start = startDateParts(startDate);
  return {
    // Basic info
    expenseType: initialData?.expenseType || "fixed",
    name: initialData?.name || "",
    amount: initialData?.amount || "",
    isVariableAmount: initialData?.isVariableAmount || false,
    category: initialData?.category || "other",
    isPriority: initialData?.isPriority || false,
    isActive: initialData?.isActive ?? true,

    // Schedule
    frequency: initialData?.frequency || "monthly",
    startDate,
    endDate: initialData?.endDate || "",
    hasEndDate: !!initialData?.endDate,
    weekendAdjustment: initialData?.weekendAdjustment || "none",
    specificDays: initialData?.specificDays || [1],
    dayOfWeek: initialData?.dayOfWeek ?? start?.dayOfWeek ?? 0,
    dayOfMonth: initialData?.dayOfMonth ?? start?.dayOfMonth ?? 1,
    monthOfYear: initialData?.monthOfYear,
    intervalWeeks: initialData?.intervalWeeks,

    // Loan config
    loanPrincipal: initialData?.loanPrincipal || "",
    loanCurrentBalance: initialData?.loanCurrentBalance || "",
    loanInterestRate: initialData?.loanInterestRate || "",
    loanTermMonths: initialData?.loanTermMonths || "",
    loanCalculationType: initialData?.loanCalculationType || "amortized",
    loanStartDate: initialData?.loanStartDate || getTodayKey(),
    loanPaymentsMade: initialData?.loanPaymentsMade ?? 0,

    // Credit config
    creditLimit: initialData?.creditLimit || "",
    creditBalance: initialData?.creditBalance || "",
    creditApr: initialData?.creditApr || "",
    creditMinPaymentPercent: initialData?.creditMinPaymentPercent || "2",
    creditMinPaymentFloor: initialData?.creditMinPaymentFloor || "25",
    creditStatementDate: initialData?.creditStatementDate || "5",
    creditDueDate: initialData?.creditDueDate || "25",
    creditPaymentStrategy: initialData?.creditPaymentStrategy || "minimum",
    creditMinPaymentMethod: initialData?.creditMinPaymentMethod || "percent_only",
    creditFixedPayment: initialData?.creditFixedPayment || "",

    // Installment config
    installmentTotal: initialData?.installmentTotal || "",
    installmentCount: initialData?.installmentCount || "12",
    installmentHasInterest: initialData?.installmentHasInterest || false,
    installmentInterestRate: initialData?.installmentInterestRate || "",
    installmentsPaid: initialData?.installmentsPaid ?? 0,

    // Notes
    notes: initialData?.notes || "",
  };
};

// ============================================================================
// VALIDATION SCHEMA
// ============================================================================

export const EXPENSE_MESSAGES = {
  termMin: "Term must be a whole number of months, at least 1",
  rateMin: "Interest rate cannot be negative",
  balanceMin: "Current balance cannot be negative",
  countMin: "Number of installments must be a whole number, at least 1",
  countMax: "Number of installments cannot exceed 120",
  percentMax: "Percentage cannot exceed 100%",
  percentMin: "Percentage cannot be negative",
  floorMin: "Payment floor cannot be negative",
  limitMin: "Credit limit cannot be negative",
  day: "Day must be between 1 and 31",
  dueDateRequired: "Due date is required",
  fixedPayment: "Enter a fixed payment amount greater than 0",
} as const;

/**
 * Error types (yup test names) that show inline but do NOT stop "Continue" on the Details step: the wizard
 * lets the user look ahead, and these block the Schedule step's Continue and the final Create/Save instead
 * (see `collectExpenseIssues`). Everything else blocks the step it is on.
 */
export const SOFT_ERROR_TYPES: ReadonlySet<string> = new Set([
  "soft-term",
  "soft-rate",
  "soft-count",
  "soft-balance",
  "soft-fixed-payment",
]);

const isNumeric = (value: string | undefined | null): boolean =>
  value !== undefined && value !== null && value.trim() !== "" && Number.isFinite(Number(value));

/** Blank is fine (the field is optional or `required` reports it); otherwise a number satisfying `ok`. */
const blankOr = (ok: (n: number) => boolean) => (value: string | undefined | null) =>
  value === undefined ||
  value === null ||
  value.trim() === "" ||
  (isNumeric(value) && ok(Number(value)));

const isDayOfMonthText = blankOr((n) => Number.isInteger(n) && n >= 1 && n <= 31);

export const expenseRuleSchema = yup.object({
  // Basic info
  expenseType: yup.string().required("Expense type is required"),
  name: yup.string().required("Name is required").min(1, "Name is required"),
  amount: yup.string().when("expenseType", {
    is: (type: string) => ["fixed", "variable", "one-time"].includes(type),
    then: (schema) => schema.required("Amount is required"),
    otherwise: (schema) => schema.optional(),
  }),
  isVariableAmount: yup.boolean(),
  category: yup.string().required("Category is required"),
  isPriority: yup.boolean(),

  // Schedule. Day of week / day of month / end date / semi-monthly days are checked together, with the
  // start date, by `validateSchedule` (see `collectExpenseIssues`); here they only need to exist.
  frequency: yup.string().required("Frequency is required"),
  startDate: yup.string().nullable().required("Start date is required"),
  endDate: yup.string().nullable().optional(),
  hasEndDate: yup.boolean(),
  weekendAdjustment: yup.string().oneOf(["before", "after", "none"]),
  specificDays: yup.array().of(yup.number()),
  dayOfWeek: yup.mixed().optional(),
  dayOfMonth: yup.mixed().optional(),

  // Loan config
  loanPrincipal: yup.string().when("expenseType", {
    is: "cash_loan",
    then: (schema) => schema.required("Principal amount is required"),
    otherwise: (schema) => schema.optional(),
  }),
  loanCurrentBalance: yup.string().when("expenseType", {
    is: "cash_loan",
    then: (schema) =>
      schema.test(
        "soft-balance",
        EXPENSE_MESSAGES.balanceMin,
        blankOr((n) => n >= 0)
      ),
    otherwise: (schema) => schema.optional(),
  }),
  loanInterestRate: yup.string().when("expenseType", {
    is: "cash_loan",
    then: (schema) =>
      schema.required("Interest rate is required").test(
        "soft-rate",
        EXPENSE_MESSAGES.rateMin,
        blankOr((n) => n >= 0)
      ),
    otherwise: (schema) => schema.optional(),
  }),
  loanTermMonths: yup.string().when("expenseType", {
    is: "cash_loan",
    then: (schema) =>
      schema.required("Term is required").test(
        "soft-term",
        EXPENSE_MESSAGES.termMin,
        blankOr((n) => Number.isInteger(n) && n >= 1)
      ),
    otherwise: (schema) => schema.optional(),
  }),
  loanCalculationType: yup.string().optional(),
  loanStartDate: yup.string().optional(),

  // Credit config. Blank optional fields are read as their documented defaults (`resolveCreditInputs`).
  creditLimit: yup
    .string()
    .optional()
    .test(
      "limit-min",
      EXPENSE_MESSAGES.limitMin,
      blankOr((n) => n >= 0)
    ),
  creditBalance: yup.string().when("expenseType", {
    is: "credit_card",
    then: (schema) => schema.required("Current balance is required"),
    otherwise: (schema) => schema.optional(),
  }),
  creditApr: yup.string().when("expenseType", {
    is: "credit_card",
    then: (schema) =>
      schema.required("APR is required").test(
        "soft-rate",
        EXPENSE_MESSAGES.rateMin,
        blankOr((n) => n >= 0)
      ),
    otherwise: (schema) => schema.optional(),
  }),
  creditMinPaymentPercent: yup
    .string()
    .optional()
    .test(
      "max-percent",
      EXPENSE_MESSAGES.percentMax,
      blankOr((n) => n <= 100)
    )
    .test(
      "min-percent",
      EXPENSE_MESSAGES.percentMin,
      blankOr((n) => n >= 0)
    ),
  creditMinPaymentFloor: yup
    .string()
    .optional()
    .test(
      "floor-min",
      EXPENSE_MESSAGES.floorMin,
      blankOr((n) => n >= 0)
    ),
  creditStatementDate: yup
    .string()
    .optional()
    .test("valid-day", EXPENSE_MESSAGES.day, isDayOfMonthText),
  creditDueDate: yup.string().when("expenseType", {
    is: "credit_card",
    then: (schema) =>
      schema
        .test("due-required", EXPENSE_MESSAGES.dueDateRequired, (v) => !!v && v.trim() !== "")
        .test("valid-day", EXPENSE_MESSAGES.day, isDayOfMonthText),
    otherwise: (schema) => schema.optional(),
  }),
  creditPaymentStrategy: yup.string().optional(),
  creditMinPaymentMethod: yup.string().optional(),
  creditFixedPayment: yup.string().when(["expenseType", "creditPaymentStrategy"], {
    is: (type: string, strategy: string) => type === "credit_card" && strategy === "fixed",
    then: (schema) =>
      schema.test(
        "soft-fixed-payment",
        EXPENSE_MESSAGES.fixedPayment,
        (v) => isNumeric(v) && Number(v) > 0
      ),
    otherwise: (schema) => schema.optional(),
  }),

  // Installment config
  installmentTotal: yup.string().when("expenseType", {
    is: "installment",
    then: (schema) => schema.required("Total amount is required"),
    otherwise: (schema) => schema.optional(),
  }),
  installmentCount: yup.string().when("expenseType", {
    is: "installment",
    then: (schema) =>
      schema
        .required("Number of installments is required")
        .test(
          "soft-count",
          EXPENSE_MESSAGES.countMin,
          blankOr((n) => Number.isInteger(n) && n >= 1)
        )
        .test(
          "max-installments",
          EXPENSE_MESSAGES.countMax,
          blankOr((n) => n <= 120)
        ),
    otherwise: (schema) => schema.optional(),
  }),
  installmentHasInterest: yup.boolean(),
  installmentInterestRate: yup
    .string()
    .optional()
    .test(
      "installment-rate",
      EXPENSE_MESSAGES.rateMin,
      blankOr((n) => n >= 0)
    ),

  // Notes
  notes: yup.string().optional(),
});

// ============================================================================
// SCHEDULE: frequency, config, issues
// ============================================================================

/**
 * The frequency that is saved: a one-time expense is always "one-time" and loans, cards and installment
 * plans are always monthly, whatever the form's `frequency` field last held.
 */
export const getEffectiveFrequency = (
  values: Pick<ExpenseRuleFormValues, "expenseType" | "frequency">
): IncomeFrequency => {
  if (values.expenseType === "one-time") return "one-time";
  if (
    values.expenseType === "cash_loan" ||
    values.expenseType === "credit_card" ||
    values.expenseType === "installment"
  ) {
    return "monthly";
  }
  return values.frequency;
};

/**
 * The `scheduleConfig` this form persists AND the Schedule Preview previews: the shared builder on the
 * effective frequency, with a credit card's payment day taken from its due date.
 */
export const buildScheduleConfig = (values: ExpenseRuleFormValues): ScheduleConfig => {
  const dueDay = toWholeNumber(values.creditDueDate);
  return buildSharedScheduleConfig({
    frequency: getEffectiveFrequency(values),
    startDate: values.startDate,
    specificDays: values.specificDays,
    dayOfWeek: values.dayOfWeek,
    dayOfMonth:
      values.expenseType === "credit_card" && dueDay !== undefined ? dueDay : values.dayOfMonth,
    monthOfYear: values.monthOfYear,
    intervalWeeks: values.intervalWeeks,
  });
};

/**
 * Everything that must stop this rule from being saved, in one list: the schedule's problems (end date
 * before start, no semi-monthly days, bad day of month) plus the field-level ones (yup). Empty = saveable.
 */
export const collectExpenseIssues = (values: ExpenseRuleFormValues): RuleIssue[] => {
  const issues: RuleIssue[] = validateSchedule({
    frequency: getEffectiveFrequency(values),
    startDate: values.startDate,
    endDate: values.endDate,
    hasEndDate: values.hasEndDate,
    specificDays: values.specificDays,
    // a credit card's payment day is its due date, which is validated with the card fields
    dayOfMonth: values.expenseType === "credit_card" ? undefined : values.dayOfMonth,
  });
  try {
    expenseRuleSchema.validateSync(values, { abortEarly: false });
  } catch (error) {
    if (!(error instanceof yup.ValidationError)) throw error;
    for (const inner of error.inner) {
      const field = inner.path ?? "";
      if (!issues.some((i) => i.field === field)) issues.push({ field, message: inner.message });
    }
  }
  return issues;
};

/** A finite number, or `fallback` for blank / NaN input (`parseFloat("")`). */
const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

/**
 * The regular payment of a loan for its calculation type. 0 (never Infinity /
 * NaN) when the principal or term cannot describe a loan, e.g. a term of 0.
 * `interestBasis` is the original principal a flat-rate loan charges interest on.
 */
export const calculateLoanPayment = (
  principal: number,
  annualRate: number,
  termMonths: number,
  calculationType: LoanCalculationType = "amortized",
  interestBasis?: number
): number =>
  calculateLoanPaymentAmount({ principal, annualRate, termMonths, calculationType, interestBasis });

export interface LoanPlan {
  /** The balance the plan amortizes: the current balance if given, else the principal. */
  balance: number;
  /** The headline payment: the first payment of `schedule`. */
  payment: number;
  schedule: AmortizationStep[];
  /** Sum of the schedule's interest column. */
  totalInterest: number;
}

export type LoanPlanInput = Pick<
  ExpenseRuleFormValues,
  | "loanPrincipal"
  | "loanCurrentBalance"
  | "loanInterestRate"
  | "loanTermMonths"
  | "loanCalculationType"
  | "loanStartDate"
> & {
  /** Payments already made (an edit of a loan in progress): only the remaining term is amortized. */
  loanPaymentsMade?: number;
};

/**
 * One loan plan for the whole form: the headline payment, the schedule preview
 * and the total interest are all read off the SAME balance, term and type, so
 * they can never contradict each other. Null when the inputs describe no loan.
 */
export const calculateLoanPlan = (values: LoanPlanInput): LoanPlan | null => {
  const principal = parseFloat(values.loanPrincipal);
  const balance = values.loanCurrentBalance?.trim()
    ? parseFloat(values.loanCurrentBalance)
    : principal;
  const annualRate = parseFloat(values.loanInterestRate);
  const totalTerm = parseInt(values.loanTermMonths, 10);
  // The projections amortize the balance over `term - paymentsMade`; the headline must be that same number.
  const made = toWholeNumber(values.loanPaymentsMade) ?? 0;
  const termMonths = made > 0 && made < totalTerm ? totalTerm - made : totalTerm;
  const calculationType = values.loanCalculationType || "amortized";

  const payment = calculateLoanPayment(balance, annualRate, termMonths, calculationType, principal);
  if (!payment) return null;

  const start = values.loanStartDate ? parseDate(values.loanStartDate) : new Date();
  const schedule = calculateAmortizationSchedule({
    principal: balance,
    annualRate,
    termMonths,
    startDate: Number.isNaN(start.getTime()) ? new Date() : start,
    calculationType,
    interestBasis: principal,
  });
  return { balance, payment, schedule, totalInterest: sumScheduleInterest(schedule) };
};

/** Whole-cent installment amount; 0 when the count is not a whole number >= 1. */
export const calculateInstallmentAmount = (
  total: number,
  count: number,
  hasInterest: boolean,
  interestRate?: number
): number => {
  if (!Number.isFinite(total) || !Number.isFinite(count) || count < 1) return 0;
  const rate = hasInterest && interestRate ? finiteOr(interestRate, 0) / 100 : 0;
  const payable = total * (1 + rate);
  return Math.round((payable / Math.floor(count)) * 100) / 100;
};

export const calculateCreditCardPayment = (
  balance: number,
  apr: number,
  minPercent: number,
  floor: number,
  method: MinimumPaymentMethod
): number => {
  // Blank optional fields arrive as NaN; read them as 0 rather than propagating NaN
  const safeBalance = Math.max(0, finiteOr(balance, 0));
  const monthlyInterest = safeBalance * (finiteOr(apr, 0) / 100 / 12);
  const percent = finiteOr(minPercent, 0);
  const safeFloor = finiteOr(floor, 0);

  if (method === "percent_plus_interest") {
    const percentPortion = safeBalance * (percent / 100);
    return Math.max(safeFloor, percentPortion + monthlyInterest);
  }
  return Math.max(safeFloor, safeBalance * (percent / 100));
};

// ============================================================================
// CREDIT CARD INPUTS AND THE SAVED PAYLOAD
// ============================================================================

/** What a blank optional card field means (the placeholder the form shows). */
export const CREDIT_DEFAULTS = {
  creditLimit: 0, // no limit given: utilisation and available credit are not shown
  minPaymentPercent: 2,
  minPaymentFloor: 25,
  statementDate: 5,
  dueDate: 25,
} as const;

const numberOr = (text: string | undefined, fallback: number): number => {
  if (text === undefined || text === null || text.trim() === "") return fallback;
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
};

const wholeOr = (text: string | undefined, fallback: number): number =>
  toWholeNumber(text) ?? fallback;

export interface ResolvedCreditInputs {
  creditLimit: number;
  currentBalance: number;
  apr: number;
  minimumPaymentPercent: number;
  minimumPaymentFloor: number;
  statementDate: number;
  dueDate: number;
  fixedPayment: number | undefined;
}

/**
 * The card's numbers with every blank optional field replaced by its documented default, so a blank field
 * never becomes `NaN` in a saved document, a review figure or a projected bill (UI-RULE-42/44/45).
 */
export const resolveCreditInputs = (
  values: Pick<
    ExpenseRuleFormValues,
    | "creditLimit"
    | "creditBalance"
    | "creditApr"
    | "creditMinPaymentPercent"
    | "creditMinPaymentFloor"
    | "creditStatementDate"
    | "creditDueDate"
    | "creditFixedPayment"
  >
): ResolvedCreditInputs => ({
  creditLimit: numberOr(values.creditLimit, CREDIT_DEFAULTS.creditLimit),
  currentBalance: numberOr(values.creditBalance, 0),
  apr: numberOr(values.creditApr, 0),
  minimumPaymentPercent: numberOr(values.creditMinPaymentPercent, CREDIT_DEFAULTS.minPaymentPercent),
  minimumPaymentFloor: numberOr(values.creditMinPaymentFloor, CREDIT_DEFAULTS.minPaymentFloor),
  statementDate: wholeOr(values.creditStatementDate, CREDIT_DEFAULTS.statementDate),
  dueDate: wholeOr(values.creditDueDate, CREDIT_DEFAULTS.dueDate),
  fixedPayment: values.creditFixedPayment?.trim() ? numberOr(values.creditFixedPayment, 0) : undefined,
});

/** The regular payment the rule is saved with (and the Review step shows) for its type. */
export const calculateRuleAmount = (values: ExpenseRuleFormValues): number => {
  if (values.expenseType === "cash_loan") {
    return calculateLoanPlan(values)?.payment ?? 0;
  }
  if (values.expenseType === "credit_card") {
    const card = resolveCreditInputs(values);
    if (values.creditPaymentStrategy === "fixed" && card.fixedPayment) return card.fixedPayment;
    if (values.creditPaymentStrategy === "full_balance") return card.currentBalance;
    return calculateCreditCardPayment(
      card.currentBalance,
      card.apr,
      card.minimumPaymentPercent,
      card.minimumPaymentFloor,
      values.creditMinPaymentMethod
    );
  }
  if (values.expenseType === "installment") {
    return calculateInstallmentAmount(
      numberOr(values.installmentTotal, 0),
      numberOr(values.installmentCount, 0),
      values.installmentHasInterest,
      values.installmentInterestRate ? numberOr(values.installmentInterestRate, 0) : undefined
    );
  }
  return numberOr(values.amount, 0);
};

/**
 * The document the wizard saves, from the form's values. Created and edited rules go through the same
 * function. An edit carries `isActive`, `paymentsMade` and `installmentsPaid` through from the form's hidden
 * values (the action re-reads them from the stored rule), and `endDate` / `notes` are present-but-undefined
 * when cleared so the edit action can remove them.
 */
export const buildExpenseRulePayload = (values: ExpenseRuleFormValues): ExpenseRuleFormData => {
  const amount = calculateRuleAmount(values);
  const frequency = getEffectiveFrequency(values);

  const payload: ExpenseRuleFormData = {
    name: values.name.trim(),
    expenseType: values.expenseType,
    category: values.category,
    amount,
    isVariableAmount: values.expenseType === "variable" ? true : values.isVariableAmount,
    frequency,
    startDate: values.startDate,
    endDate: values.hasEndDate && values.endDate ? values.endDate : undefined,
    scheduleConfig: buildScheduleConfig(values),
    weekendAdjustment: values.weekendAdjustment,
    notes: values.notes?.trim() || undefined,
    isPriority: values.isPriority,
    isActive: values.isActive,
  };

  if (values.expenseType === "cash_loan" && amount > 0) {
    const principal = numberOr(values.loanPrincipal, 0);
    payload.loanConfig = {
      principalAmount: principal,
      currentBalance: values.loanCurrentBalance?.trim()
        ? numberOr(values.loanCurrentBalance, principal)
        : principal,
      interestRate: numberOr(values.loanInterestRate, 0),
      termMonths: wholeOr(values.loanTermMonths, 0),
      monthlyPayment: amount,
      calculationType: values.loanCalculationType,
      loanStartDate: values.loanStartDate,
      firstPaymentDate: values.startDate,
      paymentsMade: values.loanPaymentsMade ?? 0,
    };
  }

  if (values.expenseType === "credit_card") {
    const card = resolveCreditInputs(values);
    payload.creditConfig = {
      creditLimit: card.creditLimit,
      currentBalance: card.currentBalance,
      apr: card.apr,
      minimumPaymentPercent: card.minimumPaymentPercent,
      minimumPaymentFloor: card.minimumPaymentFloor,
      minimumPaymentMethod: values.creditMinPaymentMethod,
      statementDate: card.statementDate,
      dueDate: card.dueDate,
      paymentStrategy: values.creditPaymentStrategy,
      ...(values.creditPaymentStrategy === "fixed" && card.fixedPayment
        ? { fixedPaymentAmount: card.fixedPayment }
        : {}),
    };
  }

  if (values.expenseType === "installment" && amount > 0) {
    payload.installmentConfig = {
      totalAmount: numberOr(values.installmentTotal, 0),
      installmentCount: wholeOr(values.installmentCount, 0),
      installmentAmount: amount,
      installmentsPaid: values.installmentsPaid ?? 0,
      hasInterest: values.installmentHasInterest,
      ...(values.installmentHasInterest && values.installmentInterestRate
        ? { interestRate: numberOr(values.installmentInterestRate, 0) }
        : {}),
    };
  }

  return payload;
};

/** A finite number as text; `undefined` for a missing or non-finite (legacy NaN) value. */
const finiteText = (n: number | undefined): string | undefined =>
  typeof n === "number" && Number.isFinite(n) ? String(n) : undefined;

/**
 * A stored rule as the wizard's initial values. A schedule value the rule does not store (`dayOfWeek`,
 * `dayOfMonth`) stays undefined, so the form derives it from the start date, which is how the engine reads
 * a rule without it.
 */
export const expenseRuleToFormValues = (rule: ExpenseRule): Partial<ExpenseRuleFormValues> => ({
  name: rule.name,
  expenseType: rule.expenseType,
  category: rule.category,
  amount: rule.amount.toString(),
  isVariableAmount: rule.isVariableAmount,
  frequency: rule.frequency,
  startDate: rule.startDate,
  endDate: rule.endDate || "",
  hasEndDate: !!rule.endDate,
  weekendAdjustment: rule.weekendAdjustment,
  specificDays: rule.scheduleConfig?.specificDays || [1],
  dayOfWeek: rule.scheduleConfig?.dayOfWeek,
  dayOfMonth: rule.scheduleConfig?.dayOfMonth,
  monthOfYear: rule.scheduleConfig?.monthOfYear,
  intervalWeeks: rule.scheduleConfig?.intervalWeeks,
  isActive: rule.isActive,
  loanPrincipal: rule.loanConfig?.principalAmount?.toString() || "",
  loanCurrentBalance: rule.loanConfig?.currentBalance?.toString() || "",
  loanInterestRate: rule.loanConfig?.interestRate?.toString() || "",
  loanTermMonths: rule.loanConfig?.termMonths?.toString() || "",
  loanCalculationType: rule.loanConfig?.calculationType || "amortized",
  loanStartDate: rule.loanConfig?.loanStartDate || "",
  loanPaymentsMade: rule.loanConfig?.paymentsMade ?? 0,
  // 0 means "no limit given" and a legacy NaN means the same: both show as a blank field
  creditLimit: rule.creditConfig?.creditLimit ? String(rule.creditConfig.creditLimit) : "",
  creditBalance: rule.creditConfig?.currentBalance?.toString() || "",
  creditApr: rule.creditConfig?.apr?.toString() || "",
  creditMinPaymentPercent: finiteText(rule.creditConfig?.minimumPaymentPercent) ?? "2",
  creditMinPaymentFloor: finiteText(rule.creditConfig?.minimumPaymentFloor) ?? "25",
  creditStatementDate: finiteText(rule.creditConfig?.statementDate) ?? "5",
  creditDueDate: finiteText(rule.creditConfig?.dueDate) ?? "25",
  creditPaymentStrategy: rule.creditConfig?.paymentStrategy || "minimum",
  creditMinPaymentMethod: rule.creditConfig?.minimumPaymentMethod || "percent_only",
  creditFixedPayment: rule.creditConfig?.fixedPaymentAmount?.toString() || "",
  installmentTotal: rule.installmentConfig?.totalAmount?.toString() || "",
  installmentCount: rule.installmentConfig?.installmentCount?.toString() || "12",
  installmentHasInterest: rule.installmentConfig?.hasInterest || false,
  installmentInterestRate: rule.installmentConfig?.interestRate?.toString() || "",
  installmentsPaid: rule.installmentConfig?.installmentsPaid ?? 0,
  notes: rule.notes || "",
  isPriority: rule.isPriority,
});
