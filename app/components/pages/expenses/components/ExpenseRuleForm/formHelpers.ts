import * as yup from "yup";
import {
  ExpenseType,
  ExpenseCategory,
  IncomeFrequency,
  ScheduleConfig,
  LoanCalculationType,
  CreditPaymentStrategy,
  MinimumPaymentMethod,
} from "@/lib/types";

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
  dayOfWeek: number;
  dayOfMonth: number;

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
): ExpenseRuleFormValues => ({
  // Basic info
  expenseType: initialData?.expenseType || "fixed",
  name: initialData?.name || "",
  amount: initialData?.amount || "",
  isVariableAmount: initialData?.isVariableAmount || false,
  category: initialData?.category || "other",
  isPriority: initialData?.isPriority || false,

  // Schedule
  frequency: initialData?.frequency || "monthly",
  startDate: initialData?.startDate || new Date().toISOString().split("T")[0],
  endDate: initialData?.endDate || "",
  hasEndDate: !!initialData?.endDate,
  weekendAdjustment: initialData?.weekendAdjustment || "none",
  specificDays: initialData?.specificDays || [1],
  dayOfWeek: initialData?.dayOfWeek ?? new Date().getDay(),
  dayOfMonth: initialData?.dayOfMonth ?? new Date().getDate(),

  // Loan config
  loanPrincipal: initialData?.loanPrincipal || "",
  loanCurrentBalance: initialData?.loanCurrentBalance || "",
  loanInterestRate: initialData?.loanInterestRate || "",
  loanTermMonths: initialData?.loanTermMonths || "",
  loanCalculationType: initialData?.loanCalculationType || "amortized",
  loanStartDate: initialData?.loanStartDate || new Date().toISOString().split("T")[0],

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

  // Notes
  notes: initialData?.notes || "",
});

// ============================================================================
// VALIDATION SCHEMA
// ============================================================================

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

  // Schedule
  frequency: yup.string().required("Frequency is required"),
  startDate: yup.string().required("Start date is required"),
  endDate: yup.string().optional(),
  hasEndDate: yup.boolean(),
  weekendAdjustment: yup.string().oneOf(["before", "after", "none"]),
  specificDays: yup.array().of(yup.number()),
  dayOfWeek: yup.number().min(0).max(6),
  dayOfMonth: yup.number().min(1).max(31),

  // Loan config
  loanPrincipal: yup.string().when("expenseType", {
    is: "cash_loan",
    then: (schema) => schema.required("Principal amount is required"),
    otherwise: (schema) => schema.optional(),
  }),
  loanCurrentBalance: yup.string().optional(),
  loanInterestRate: yup.string().when("expenseType", {
    is: "cash_loan",
    then: (schema) => schema.required("Interest rate is required"),
    otherwise: (schema) => schema.optional(),
  }),
  loanTermMonths: yup.string().when("expenseType", {
    is: "cash_loan",
    then: (schema) => schema.required("Term is required"),
    otherwise: (schema) => schema.optional(),
  }),
  loanCalculationType: yup.string().optional(),
  loanStartDate: yup.string().optional(),

  // Credit config
  creditLimit: yup.string().optional(),
  creditBalance: yup.string().when("expenseType", {
    is: "credit_card",
    then: (schema) => schema.required("Current balance is required"),
    otherwise: (schema) => schema.optional(),
  }),
  creditApr: yup.string().when("expenseType", {
    is: "credit_card",
    then: (schema) => schema.required("APR is required"),
    otherwise: (schema) => schema.optional(),
  }),
  creditMinPaymentPercent: yup.string().optional(),
  creditMinPaymentFloor: yup.string().optional(),
  creditStatementDate: yup.string().optional(),
  creditDueDate: yup.string().optional(),
  creditPaymentStrategy: yup.string().optional(),
  creditMinPaymentMethod: yup.string().optional(),
  creditFixedPayment: yup.string().optional(),

  // Installment config
  installmentTotal: yup.string().when("expenseType", {
    is: "installment",
    then: (schema) => schema.required("Total amount is required"),
    otherwise: (schema) => schema.optional(),
  }),
  installmentCount: yup.string().when("expenseType", {
    is: "installment",
    then: (schema) => schema.required("Number of installments is required"),
    otherwise: (schema) => schema.optional(),
  }),
  installmentHasInterest: yup.boolean(),
  installmentInterestRate: yup.string().optional(),

  // Notes
  notes: yup.string().optional(),
});

// ============================================================================
// UTILITIES
// ============================================================================

export const buildScheduleConfig = (values: ExpenseRuleFormValues): ScheduleConfig => {
  const config: ScheduleConfig = {};

  switch (values.frequency) {
    case "semi-monthly":
      config.specificDays = values.specificDays;
      break;
    case "weekly":
    case "bi-weekly":
      config.dayOfWeek = values.dayOfWeek;
      if (values.frequency === "bi-weekly") {
        config.intervalWeeks = 2;
      }
      break;
    case "monthly":
      if (values.expenseType === "credit_card" && values.creditDueDate) {
        config.dayOfMonth = parseInt(values.creditDueDate);
      } else {
        config.dayOfMonth = values.dayOfMonth;
      }
      break;
  }

  return config;
};

export const calculateLoanPayment = (
  principal: number,
  annualRate: number,
  termMonths: number
): number => {
  const rate = annualRate / 100 / 12;
  if (rate === 0) {
    return principal / termMonths;
  }
  return (
    (principal * (rate * Math.pow(1 + rate, termMonths))) / (Math.pow(1 + rate, termMonths) - 1)
  );
};

export const calculateInstallmentAmount = (
  total: number,
  count: number,
  hasInterest: boolean,
  interestRate?: number
): number => {
  if (hasInterest && interestRate) {
    const rate = interestRate / 100;
    const totalWithInterest = total * (1 + rate);
    return totalWithInterest / count;
  }
  return total / count;
};

export const calculateCreditCardPayment = (
  balance: number,
  apr: number,
  minPercent: number,
  floor: number,
  method: MinimumPaymentMethod
): number => {
  const monthlyInterest = balance * (apr / 100 / 12);

  if (method === "percent_plus_interest") {
    const percentPortion = balance * (minPercent / 100);
    return Math.max(floor, percentPortion + monthlyInterest);
  }
  return Math.max(floor, balance * (minPercent / 100));
};
