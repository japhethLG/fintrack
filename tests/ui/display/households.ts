/**
 * Seeded households for the displayed-numbers / cross-screen suite.
 *
 * EVERY expected number lives in a comment next to the seed, derived by hand
 * from the rows below (never from app functions or the app formatter). The
 * seeds only use the public builders; nothing here imports from `app/`.
 *
 * ---------------------------------------------------------------------------
 * H1 "Reyes" — today Mon 2026-03-16 (noon), period under test = March 2026.
 *   Default projection window for that "today" = 2026-01-01 .. 2026-06-30.
 *   (2 months back from Mar => Jan 1; 4 months forward => Jun 30.)
 *
 * PRE-WINDOW history (before Jan 1, so outside the default window; manual rows,
 * always kept by the merger):
 *   +1,500.00  Year-end bonus   2025-12-20 completed (income)
 *   -  600.00  Holiday flights  2025-12-27 completed (expense)
 *   net pre-window = +900.00
 *
 * IN-WINDOW history (all completed/skipped, nothing overdue and unpaid):
 *   Payroll (semi-monthly 15th/30th, 2,000, start 2026-01-15)
 *     Jan 15 +2,000  Jan 30 +2,000  Feb 15 +1,950 (paid short)  Feb 28 +2,000
 *     (30th clamps to Feb 28)  Mar 15 +2,000
 *   Freelance (monthly on the 10th, 750 variable, start 2026-01-10)
 *     Jan 10 +900   Feb 10 SKIPPED   Mar 10 +820
 *   Rent (monthly on the 1st, 1,200, start 2026-01-01)
 *     Jan 1 -1,200  Feb 1 -1,200  Mar 1 -1,200
 *   Groceries (weekly Saturday, 150 variable, start 2026-03-07)
 *     Mar 7 -138.40   Mar 14 -162.55
 *   Gift (manual income) Mar 5 +300 completed
 *
 * STILL PROJECTED (from today onward):
 *   Freelance/… none.   Payroll Mar 30 +2,000
 *   Groceries Mar 21 -150, Mar 28 -150
 *   Electricity (monthly, 90, start 2026-03-18)             Mar 18 -90
 *   Car loan (12,000 @ 12% / 24 mo, start 2026-03-20)       Mar 20 -564.8817
 *        PMT = 12000 * 0.01 / (1 - 1.01^-24) = 564.8817 (displays $564.88)
 *   Visa card (1,000 @ 24%, min 2% / floor 25, due 22nd,
 *        start 2026-03-01) -> minimum = max(25, 2% of 1000 = 20) = 25   Mar 22 -25
 *   Laptop BNPL (6 x 200, start 2026-03-25)                 Mar 25 -200
 *   Dentist (one-time 250, 2026-03-27)                      Mar 27 -250
 *
 * MARCH 2026 hand totals (the selected period):
 *   income   = 2,000 (Mar15) + 2,000 (Mar30) + 820 (Mar10 actual) + 300 (gift) = 5,120.00
 *   expenses = 1,200 + 138.40 + 162.55 + 150 + 150 + 90 + 564.8817 + 25 + 200 + 250
 *            = 2,930.8317   -> $2,930.83
 *   net      = 5,120 - 2,930.8317 = +2,189.1683 -> +$2,189.17
 *   counts   : income 3 completed + 1 projected; expense 3 completed + 7 projected
 *
 * BALANCES (initial 5,000):
 *   completed income  = 1,500 + 2,000+2,000+900 + 1,950+2,000 + 2,000+820+300 = 13,470
 *   completed expense = 600 + 1,200*3 + 138.40 + 162.55                       =  4,500.95
 *   currentBalance    = 5,000 + 13,470 - 4,500.95 = 13,969.05
 *   opening Mar 1     = 5,000 + 900 + (Jan: +3,700) + (Feb: +2,750) = 12,350.00
 *                       (equivalently 13,969.05 - completed rows dated >= Mar 1
 *                        = 13,969.05 - 1,619.05)
 *   closing Mar 31    = 13,969.05 + 2,000 - 1,429.8817 = 14,539.1683
 *                       (= 12,350 + net 2,189.1683)
 * ---------------------------------------------------------------------------
 */
import {
  makeCompletedTransaction,
  makeCreditConfig,
  makeCreditRule,
  makeExpenseRule,
  makeIncomeSource,
  makeInstallmentRule,
  makeLoanRule,
  makeManualTransaction,
  makeSkippedTransaction,
  type AppSeed,
} from "../harness";

export const H1_TODAY = "2026-03-16";

export const H1 = {
  today: H1_TODAY,
  currentBalance: 13_969.05,
  initialBalance: 5_000,
  march: {
    income: 5_120,
    expenses: 2_930.83, // 2,930.8317 displayed to cents
    net: 2_189.17, // 2,189.1683 displayed to cents
    incomeCompleted: 3,
    incomeProjected: 1,
    expenseCompleted: 3,
    expenseProjected: 7,
    opening: 12_350,
    closing: 14_539.17, // 14,539.1683
  },
  /** what the daily-balance replay drops (pre-window net) */
  preWindowNet: 900,
};

/** Occurrence ids follow the app's documented shapes (`<id>_<period>`); see occurrenceIdGenerator.ts. */
const done = (
  o: Parameters<typeof makeCompletedTransaction>[0] & { sourceId: string; occurrenceId: string }
) => makeCompletedTransaction(o);

export function h1Seed(overrides: Partial<AppSeed> = {}): AppSeed {
  const payroll = makeIncomeSource({
    id: "pay",
    name: "Payroll",
    sourceType: "salary",
    category: "salary",
    amount: 2_000,
    frequency: "semi-monthly",
    startDate: "2026-01-15",
    scheduleConfig: { specificDays: [15, 30] },
  });
  const freelance = makeIncomeSource({
    id: "free",
    name: "Freelance",
    sourceType: "freelance",
    category: "freelance",
    amount: 750,
    isVariableAmount: true,
    frequency: "monthly",
    startDate: "2026-01-10",
  });
  const rent = makeExpenseRule({
    id: "rent",
    name: "Rent",
    category: "housing",
    amount: 1_200,
    frequency: "monthly",
    startDate: "2026-01-01",
    isPriority: true,
  });
  const groceries = makeExpenseRule({
    id: "groc",
    name: "Groceries",
    expenseType: "variable",
    category: "food" as never, // not in ExpenseCategory; the seed store does not validate it
    amount: 150,
    isVariableAmount: true,
    frequency: "weekly",
    startDate: "2026-03-07",
    scheduleConfig: { dayOfWeek: 6 },
  });
  const power = makeExpenseRule({
    id: "power",
    name: "Electricity",
    expenseType: "variable",
    category: "utilities",
    amount: 90,
    isVariableAmount: true,
    frequency: "monthly",
    startDate: "2026-03-18",
  });
  const loan = makeLoanRule(
    {
      id: "loan",
      name: "Car Loan",
      amount: 564.88,
      frequency: "monthly",
      startDate: "2026-03-20",
    },
    {
      principalAmount: 12_000,
      currentBalance: 12_000,
      interestRate: 12,
      termMonths: 24,
      // exact PMT (564.8816666791...), the unrounded figure the form persists; the engine now honours
      // the stored payment, and a pre-rounded 564.88 would hide UI-DISP-10 (3-decimal row amounts)
      monthlyPayment: 564.881666679176,
      loanStartDate: "2026-03-20",
      firstPaymentDate: "2026-03-20",
      paymentsMade: 0,
    }
  );
  const card = makeCreditRule(
    { id: "card", name: "Visa", amount: 25, frequency: "monthly", startDate: "2026-03-01" },
    {
      currentBalance: 1_000,
      apr: 24,
      minimumPaymentPercent: 2,
      minimumPaymentFloor: 25,
      dueDate: 22,
      statementDate: 1,
      paymentStrategy: "minimum",
    }
  );
  const laptop = makeInstallmentRule(
    { id: "lap", name: "Laptop BNPL", amount: 200, frequency: "monthly", startDate: "2026-03-25" },
    { totalAmount: 1_200, installmentCount: 6, installmentAmount: 200, installmentsPaid: 0 }
  );
  const dentist = makeExpenseRule({
    id: "dent",
    name: "Dentist",
    expenseType: "one-time",
    category: "healthcare",
    amount: 250,
    frequency: "one-time",
    startDate: "2026-03-27",
  });

  const transactions = [
    // ---- pre-window history (manual) ----
    makeManualTransaction({
      id: "m-bonus",
      name: "Year-end bonus",
      type: "income",
      category: "bonus",
      status: "completed",
      projectedAmount: 1_500,
      actualAmount: 1_500,
      scheduledDate: "2025-12-20",
      actualDate: "2025-12-20",
    }),
    makeManualTransaction({
      id: "m-flights",
      name: "Holiday flights",
      type: "expense",
      category: "travel",
      status: "completed",
      projectedAmount: 600,
      actualAmount: 600,
      scheduledDate: "2025-12-27",
      actualDate: "2025-12-27",
    }),
    // ---- payroll ----
    done({
      id: "t-pay-0115",
      sourceType: "income_source",
      sourceId: "pay",
      occurrenceId: "pay_2026-01-1",
      name: "Payroll",
      type: "income",
      category: "salary",
      projectedAmount: 2_000,
      scheduledDate: "2026-01-15",
    }),
    done({
      id: "t-pay-0130",
      sourceType: "income_source",
      sourceId: "pay",
      occurrenceId: "pay_2026-01-2",
      name: "Payroll",
      type: "income",
      category: "salary",
      projectedAmount: 2_000,
      scheduledDate: "2026-01-30",
    }),
    done({
      id: "t-pay-0215",
      sourceType: "income_source",
      sourceId: "pay",
      occurrenceId: "pay_2026-02-1",
      name: "Payroll",
      type: "income",
      category: "salary",
      projectedAmount: 2_000,
      actualAmount: 1_950,
      scheduledDate: "2026-02-15",
    }),
    done({
      id: "t-pay-0228",
      sourceType: "income_source",
      sourceId: "pay",
      occurrenceId: "pay_2026-02-2",
      name: "Payroll",
      type: "income",
      category: "salary",
      projectedAmount: 2_000,
      scheduledDate: "2026-02-28",
    }),
    done({
      id: "t-pay-0315",
      sourceType: "income_source",
      sourceId: "pay",
      occurrenceId: "pay_2026-03-1",
      name: "Payroll",
      type: "income",
      category: "salary",
      projectedAmount: 2_000,
      scheduledDate: "2026-03-15",
    }),
    // ---- freelance ----
    done({
      id: "t-free-0110",
      sourceType: "income_source",
      sourceId: "free",
      occurrenceId: "free_2026-01",
      name: "Freelance",
      type: "income",
      category: "freelance",
      projectedAmount: 750,
      actualAmount: 900,
      scheduledDate: "2026-01-10",
    }),
    makeSkippedTransaction({
      id: "t-free-0210",
      sourceType: "income_source",
      sourceId: "free",
      occurrenceId: "free_2026-02",
      name: "Freelance",
      type: "income",
      category: "freelance",
      projectedAmount: 750,
      scheduledDate: "2026-02-10",
    }),
    done({
      id: "t-free-0310",
      sourceType: "income_source",
      sourceId: "free",
      occurrenceId: "free_2026-03",
      name: "Freelance",
      type: "income",
      category: "freelance",
      projectedAmount: 750,
      actualAmount: 820,
      scheduledDate: "2026-03-10",
    }),
    // ---- rent ----
    ...["2026-01", "2026-02", "2026-03"].map((ym) =>
      done({
        id: `t-rent-${ym}`,
        sourceType: "expense_rule",
        sourceId: "rent",
        occurrenceId: `rent_${ym}`,
        name: "Rent",
        type: "expense",
        category: "housing",
        projectedAmount: 1_200,
        scheduledDate: `${ym}-01`,
      })
    ),
    // ---- groceries (ISO weeks 10 and 11 of 2026) ----
    done({
      id: "t-groc-0307",
      sourceType: "expense_rule",
      sourceId: "groc",
      occurrenceId: "groc_2026-W10",
      name: "Groceries",
      type: "expense",
      category: "food",
      projectedAmount: 150,
      actualAmount: 138.4,
      scheduledDate: "2026-03-07",
    }),
    done({
      id: "t-groc-0314",
      sourceType: "expense_rule",
      sourceId: "groc",
      occurrenceId: "groc_2026-W11",
      name: "Groceries",
      type: "expense",
      category: "food",
      projectedAmount: 150,
      actualAmount: 162.55,
      scheduledDate: "2026-03-14",
    }),
    // ---- manual gift ----
    makeManualTransaction({
      id: "m-gift",
      name: "Birthday gift",
      type: "income",
      category: "gift",
      status: "completed",
      projectedAmount: 300,
      actualAmount: 300,
      scheduledDate: "2026-03-05",
      actualDate: "2026-03-05",
    }),
  ];

  return {
    profile: {
      currentBalance: H1.currentBalance,
      initialBalance: H1.initialBalance,
      balanceLastUpdatedAt: "2026-03-15",
    },
    incomeSources: [payroll, freelance],
    expenseRules: [rent, groceries, power, loan, card, laptop, dentist],
    transactions,
    ...overrides,
  };
}

/** Handy re-exports so specs only import from one place. */
export { makeCreditConfig };
