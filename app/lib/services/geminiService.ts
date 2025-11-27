import {
  Transaction,
  IncomeSource,
  ExpenseRule,
  BillCoverageReport,
  VarianceReport,
} from "@/lib/types";

export interface AnalysisContext {
  transactions: Transaction[];
  incomeSources: IncomeSource[];
  expenseRules: ExpenseRule[];
  currentBalance: number;
  billCoverage?: BillCoverageReport;
  varianceReport?: VarianceReport;
}

export interface AnalysisResult {
  summary: string;
  insights: string[];
  recommendations: string[];
  warnings: string[];
  opportunities: string[];
}

export const analyzeBudget = async (context: AnalysisContext): Promise<string> => {
  try {
    const response = await fetch("/api/analyze-budget", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(context),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to analyze budget");
    }

    const data = await response.json();
    return data.analysis || "Unable to generate analysis at this time.";
  } catch (error) {
    console.error("Budget Analysis Error:", error);
    return error instanceof Error
      ? `Error: ${error.message}`
      : "Error connecting to AI service. Please check your API key configuration.";
  }
};

export const getSmartInsights = async (context: AnalysisContext): Promise<AnalysisResult> => {
  try {
    const response = await fetch("/api/analyze-budget", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...context,
        mode: "insights",
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to get insights");
    }

    const data = await response.json();
    return (
      data.result || {
        summary: "Unable to generate insights.",
        insights: [],
        recommendations: [],
        warnings: [],
        opportunities: [],
      }
    );
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
export const formatTransactionsForAI = (transactions: Transaction[]): string => {
  const completed = transactions.filter((t) => t.status === "completed");
  const pending = transactions.filter((t) => t.status === "pending" || t.status === "projected");

  let text = "## Completed Transactions\n";
  completed.forEach((t) => {
    const amount = t.actualAmount ?? t.projectedAmount;
    text += `- ${t.name}: ${t.type === "income" ? "+" : "-"}$${amount} (${t.category})\n`;
  });

  text += "\n## Upcoming Transactions\n";
  pending.forEach((t) => {
    text += `- ${t.name}: ${t.type === "income" ? "+" : "-"}$${t.projectedAmount} on ${t.scheduledDate} (${t.category})\n`;
  });

  return text;
};

// Helper to format income sources for the AI
export const formatIncomeSourcesForAI = (sources: IncomeSource[]): string => {
  let text = "## Income Sources\n";
  sources
    .filter((s) => s.isActive)
    .forEach((s) => {
      text += `- ${s.name}: $${s.amount} (${s.frequency})\n`;
      if (s.isVariableAmount) text += "  Note: Amount varies\n";
    });
  return text;
};

// Helper to format expense rules for the AI
export const formatExpenseRulesForAI = (rules: ExpenseRule[]): string => {
  let text = "## Expense Rules\n";
  rules
    .filter((r) => r.isActive)
    .forEach((r) => {
      text += `- ${r.name}: $${r.amount} (${r.frequency})\n`;
      if (r.loanConfig) {
        text += `  Loan: $${r.loanConfig.currentBalance} remaining, ${r.loanConfig.interestRate}% APR\n`;
      }
      if (r.creditConfig) {
        text += `  Credit Card: $${r.creditConfig.currentBalance} balance, ${r.creditConfig.apr}% APR\n`;
      }
    });
  return text;
};
