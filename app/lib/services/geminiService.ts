import {
  Transaction,
  IncomeSource,
  ExpenseRule,
  BillCoverageReport,
  VarianceReport,
} from "@/lib/types";
import { GoogleGenAI } from "@google/genai";

export interface AnalysisContext {
  transactions: Transaction[];
  incomeSources: IncomeSource[];
  expenseRules: ExpenseRule[];
  currentBalance: number;
  billCoverage?: BillCoverageReport;
  varianceReport?: VarianceReport;
  /** Currency symbol to use for formatting (e.g., "$", "₱", "€") */
  currencySymbol?: string;
}

export interface AnalysisResult {
  summary: string;
  insights: string[];
  recommendations: string[];
  warnings: string[];
  opportunities: string[];
}

// Initialize Gemini AI client
const getGeminiClient = () => {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_GEMINI_API_KEY is not configured");
  }
  return new GoogleGenAI({ apiKey });
};

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
  const upcoming = transactions.filter((t) => t.status === "projected");

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

export const analyzeBudget = async (context: AnalysisContext): Promise<string> => {
  try {
    const ai = getGeminiClient();
    const {
      transactions,
      incomeSources,
      expenseRules,
      currentBalance,
      billCoverage,
      currencySymbol = "$",
    } = context;

    // Build the prompt
    const prompt = `
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

    // Generate content using Gemini
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    return response.text || "Unable to generate analysis at this time.";
  } catch (error) {
    console.error("Budget Analysis Error:", error);
    return error instanceof Error
      ? `Error: ${error.message}`
      : "Error connecting to AI service. Please check your API key configuration.";
  }
};

export const getSmartInsights = async (context: AnalysisContext): Promise<AnalysisResult> => {
  try {
    // For now, use the same analysis function
    const analysis = await analyzeBudget(context);

    return {
      summary: analysis,
      insights: [],
      recommendations: [],
      warnings: [],
      opportunities: [],
    };
  } catch (error) {
    console.error("Smart Insights Error:", error);
    return {
      summary: "Unable to connect to AI service.",
      insights: [],
      recommendations: [],
      warnings: [],
      opportunities: [],
    };
  }
};

// Helper to format transaction data for the AI
export const formatTransactionsForAI = (
  transactions: Transaction[],
  currencySymbol: string = "$"
): string => {
  const completed = transactions.filter((t) => t.status === "completed");
  const pending = transactions.filter((t) => t.status === "projected");

  let text = "## Completed Transactions\n";
  completed.forEach((t) => {
    const amount = t.actualAmount ?? t.projectedAmount;
    text += `- ${t.name}: ${t.type === "income" ? "+" : "-"}${currencySymbol}${amount} (${t.category})\n`;
  });

  text += "\n## Upcoming Transactions\n";
  pending.forEach((t) => {
    text += `- ${t.name}: ${t.type === "income" ? "+" : "-"}${currencySymbol}${t.projectedAmount} on ${t.scheduledDate} (${t.category})\n`;
  });

  return text;
};

// Helper to format income sources for the AI
export const formatIncomeSourcesForAI = (
  sources: IncomeSource[],
  currencySymbol: string = "$"
): string => {
  let text = "## Income Sources\n";
  sources
    .filter((s) => s.isActive)
    .forEach((s) => {
      text += `- ${s.name}: ${currencySymbol}${s.amount} (${s.frequency})\n`;
      if (s.isVariableAmount) text += "  Note: Amount varies\n";
    });
  return text;
};

// Helper to format expense rules for the AI
export const formatExpenseRulesForAI = (
  rules: ExpenseRule[],
  currencySymbol: string = "$"
): string => {
  let text = "## Expense Rules\n";
  rules
    .filter((r) => r.isActive)
    .forEach((r) => {
      text += `- ${r.name}: ${currencySymbol}${r.amount} (${r.frequency})\n`;
      if (r.loanConfig) {
        text += `  Loan: ${currencySymbol}${r.loanConfig.currentBalance} remaining, ${r.loanConfig.interestRate}% APR\n`;
      }
      if (r.creditConfig) {
        text += `  Credit Card: ${currencySymbol}${r.creditConfig.currentBalance} balance, ${r.creditConfig.apr}% APR\n`;
      }
    });
  return text;
};
