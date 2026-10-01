import type {
  Transaction,
  IncomeSource,
  ExpenseRule,
  BillCoverageReport,
  VarianceReport,
} from "@/lib/types";
import { getCurrencySymbol } from "@/lib/utils/currency";
import { addDays, formatDate, getTodayKey, parseDate } from "@/lib/utils/dateUtils";

/**
 * The text sent to the AI. Pure (no SDK, no network), so tests and the E2E stub run the REAL prompt builder.
 */

export interface AnalysisContext {
  transactions: Transaction[];
  incomeSources: IncomeSource[];
  expenseRules: ExpenseRule[];
  currentBalance: number;
  billCoverage?: BillCoverageReport;
  varianceReport?: VarianceReport;
  /** Currency symbol to use for formatting (defaults to the default currency's symbol) */
  currencySymbol?: string;
  /** Pre-computed summary for the selected period */
  periodSummary?: {
    dateRange: { start: string; end: string };
    actualIncome: number;
    actualExpenses: number;
    budgetedIncome: number;
    budgetedExpenses: number;
    savingsRate: number;
  };
}

// Format helper functions
const formatIncomeSources = (incomeSources: IncomeSource[], symbol: string) => {
  if (!incomeSources || incomeSources.length === 0) return "No income sources configured.";
  return incomeSources
    .filter((s) => s.isActive)
    .map((s) => {
      let freq: string = s.frequency;
      if (s.frequency === "semi-monthly" && s.scheduleConfig.specificDays) {
        freq = `semi-monthly (${s.scheduleConfig.specificDays.join(", ")})`;
      }
      return `- ${s.name}: ${symbol}${s.amount} ${s.isVariableAmount ? "(variable)" : ""} [${freq}]`;
    })
    .join("\n");
};

const formatExpenseRules = (expenseRules: ExpenseRule[], symbol: string) => {
  if (!expenseRules || expenseRules.length === 0) return "No expense rules configured.";
  return expenseRules
    .filter((r) => r.isActive)
    .map((r) => {
      let details = `- ${r.name}: ${symbol}${r.amount} [${r.frequency}] (${r.category})`;
      if (r.loanConfig) {
        details += `\n  Loan: ${symbol}${r.loanConfig.currentBalance} remaining of ${symbol}${r.loanConfig.principalAmount}, ${r.loanConfig.interestRate}% APR`;
      }
      if (r.creditConfig) {
        details += `\n  Credit Card: ${symbol}${r.creditConfig.currentBalance}/${symbol}${r.creditConfig.creditLimit}, ${r.creditConfig.apr}% APR`;
      }
      if (r.isPriority) details += " [PRIORITY]";
      return details;
    })
    .join("\n");
};

const formatTransactions = (transactions: Transaction[], symbol: string) => {
  if (transactions.length === 0) return "No transactions.";

  const completed = transactions.filter((t) => t.status === "completed");
  // "Upcoming" means due from today to today + 30 days. A still-projected row dated before today is
  // OVERDUE and says so in its own section (E2E-ROB-12: they used to be listed as upcoming).
  const today = getTodayKey();
  const horizon = formatDate(addDays(parseDate(today), 30));
  const projectedRows = transactions
    .filter((t) => t.status === "projected")
    .sort((a, b) => (a.scheduledDate < b.scheduledDate ? -1 : a.scheduledDate > b.scheduledDate ? 1 : 0));
  const overdue = projectedRows.filter((t) => t.scheduledDate < today);
  const upcoming = projectedRows.filter((t) => t.scheduledDate >= today && t.scheduledDate <= horizon);

  let text = "";

  if (completed.length > 0) {
    text += "Recent Completed:\n";
    completed.slice(-10).forEach((t) => {
      const amount = t.actualAmount ?? t.projectedAmount;
      const variance = t.variance
        ? ` (variance: ${t.variance > 0 ? "+" : ""}${symbol}${t.variance})`
        : "";
      text += `- ${t.scheduledDate}: ${t.name} ${t.type === "income" ? "+" : "-"}${symbol}${amount}${variance}\n`;
    });
  }

  if (overdue.length > 0) {
    text += "\nOverdue (past due, still unpaid):\n";
    overdue.slice(0, 15).forEach((t) => {
      text += `- ${t.scheduledDate}: ${t.name} ${t.type === "income" ? "+" : "-"}${symbol}${t.projectedAmount} [overdue]\n`;
    });
  }

  if (upcoming.length > 0) {
    text += "\nUpcoming (next 30 days):\n";
    upcoming.slice(0, 15).forEach((t) => {
      text += `- ${t.scheduledDate}: ${t.name} ${t.type === "income" ? "+" : "-"}${symbol}${t.projectedAmount} [${t.status}]\n`;
    });
  }

  return text;
};

const formatBillCoverage = (billCoverage: BillCoverageReport | undefined, symbol: string) => {
  if (!billCoverage) return "";

  const billsAtRisk = billCoverage.upcomingBills.filter((bill) => !bill.canCover);

  let text = `\nBill Coverage Analysis (next 14 days):
- Current Balance: ${symbol}${billCoverage.currentBalance}
- Total Bills: ${symbol}${billCoverage.totalUpcoming}
- Projected End Balance: ${symbol}${billCoverage.projectedBalance}`;

  if (billsAtRisk.length > 0) {
    text += `\n\n⚠️ BILLS AT RISK (${billsAtRisk.length}):\n`;
    billsAtRisk.forEach((bill) => {
      text += `- ${bill.transaction.name}: ${symbol}${bill.transaction.projectedAmount} on ${bill.transaction.scheduledDate} (Need ${symbol}${bill.shortfall || 0})\n`;
    });
  }

  return text;
};

export const buildAnalysisPrompt = (context: AnalysisContext): string => {
const {
  transactions,
  incomeSources,
  expenseRules,
  currentBalance,
  billCoverage,
  currencySymbol = getCurrencySymbol(),
  periodSummary,
} = context;

// Format period summary if available
const periodSummaryText = periodSummary
  ? `
## Period Summary (${periodSummary.dateRange.start} to ${periodSummary.dateRange.end})
- Actual Income: ${currencySymbol}${periodSummary.actualIncome.toFixed(2)}
- Actual Expenses: ${currencySymbol}${periodSummary.actualExpenses.toFixed(2)}
- Budgeted Income: ${currencySymbol}${periodSummary.budgetedIncome.toFixed(2)}
- Budgeted Expenses: ${currencySymbol}${periodSummary.budgetedExpenses.toFixed(2)}
- Savings Rate: ${periodSummary.savingsRate.toFixed(1)}%
`
  : "";

// Build the prompt
return `
You are an expert financial advisor AI. Analyze the following financial data and provide actionable insights.

## Current Financial Status
Balance: ${currencySymbol}${currentBalance}

## Income Sources
${formatIncomeSources(incomeSources, currencySymbol)}

## Expense Rules
${formatExpenseRules(expenseRules, currencySymbol)}

## Transaction History
${formatTransactions(transactions, currencySymbol)}
${formatBillCoverage(billCoverage, currencySymbol)}
${periodSummaryText}

## Your Analysis

Please provide a comprehensive but concise analysis in the following format:

**1. Financial Health Overview**
Assess the overall financial health. Are they cash flow positive? What's the monthly surplus/deficit?

**2. Key Observations**
- List 3-4 important observations about their spending patterns
- Note any concerning trends or positive behaviors

**3. Immediate Concerns**
- Point out any upcoming bills that may not be covered
- Identify any high-interest debt that should be prioritized
- Note any overdue items

**4. Recommendations**
Provide 3 specific, actionable recommendations to improve their financial situation:
1. [First priority action]
2. [Second priority action]
3. [Third priority action]

**5. Opportunities**
Suggest 1-2 opportunities for savings or financial optimization based on their data.

Be direct, specific, and helpful. Use the actual numbers from their data. Avoid generic advice.
`;
};
