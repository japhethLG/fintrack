import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { Transaction, IncomeSource, ExpenseRule, BillCoverageReport } from "@/lib/types";

// Route Segment Config - Next.js 15 pattern
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AnalysisRequestBody {
  transactions: Transaction[];
  incomeSources: IncomeSource[];
  expenseRules: ExpenseRule[];
  currentBalance: number;
  billCoverage?: BillCoverageReport;
  mode?: "analysis" | "insights";
}

export async function POST(request: NextRequest) {
  try {
    const body: AnalysisRequestBody = await request.json();
    const {
      transactions,
      incomeSources,
      expenseRules,
      currentBalance,
      billCoverage,
      mode = "analysis",
    } = body;

    // Validate required fields
    if (!transactions || currentBalance === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Get API key from environment variables
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
    }

    // Initialize the Gemini API client
    const ai = new GoogleGenAI({ apiKey });

    // Format data for AI
    const formatIncomeSources = () => {
      if (!incomeSources || incomeSources.length === 0) return "No income sources configured.";
      return incomeSources
        .filter((s) => s.isActive)
        .map((s) => {
          let freq: string = s.frequency;
          if (s.frequency === "semi-monthly" && s.scheduleConfig.specificDays) {
            freq = `semi-monthly (${s.scheduleConfig.specificDays.join(", ")})`;
          }
          return `- ${s.name}: $${s.amount} ${s.isVariableAmount ? "(variable)" : ""} [${freq}]`;
        })
        .join("\n");
    };

    const formatExpenseRules = () => {
      if (!expenseRules || expenseRules.length === 0) return "No expense rules configured.";
      return expenseRules
        .filter((r) => r.isActive)
        .map((r) => {
          let details = `- ${r.name}: $${r.amount} [${r.frequency}] (${r.category})`;
          if (r.loanConfig) {
            details += `\n  Loan: $${r.loanConfig.currentBalance} remaining of $${r.loanConfig.principalAmount}, ${r.loanConfig.interestRate}% APR`;
          }
          if (r.creditConfig) {
            details += `\n  Credit Card: $${r.creditConfig.currentBalance}/$${r.creditConfig.creditLimit}, ${r.creditConfig.apr}% APR`;
          }
          if (r.isPriority) details += " [PRIORITY]";
          return details;
        })
        .join("\n");
    };

    const formatTransactions = () => {
      if (transactions.length === 0) return "No transactions.";

      const completed = transactions.filter((t) => t.status === "completed");
      const upcoming = transactions.filter(
        (t) => t.status === "pending" || t.status === "projected"
      );

      let text = "";

      if (completed.length > 0) {
        text += "Recent Completed:\n";
        completed.slice(-10).forEach((t) => {
          const amount = t.actualAmount ?? t.projectedAmount;
          const variance = t.variance
            ? ` (variance: ${t.variance > 0 ? "+" : ""}$${t.variance})`
            : "";
          text += `- ${t.scheduledDate}: ${t.name} ${t.type === "income" ? "+" : "-"}$${amount}${variance}\n`;
        });
      }

      if (upcoming.length > 0) {
        text += "\nUpcoming (next 30 days):\n";
        upcoming.slice(0, 15).forEach((t) => {
          text += `- ${t.scheduledDate}: ${t.name} ${t.type === "income" ? "+" : "-"}$${t.projectedAmount} [${t.status}]\n`;
        });
      }

      return text;
    };

    const formatBillCoverage = () => {
      if (!billCoverage) return "";

      const billsAtRisk = billCoverage.upcomingBills.filter((bill) => !bill.canCover);

      let text = `\nBill Coverage Analysis (next 14 days):
- Current Balance: $${billCoverage.currentBalance}
- Total Bills: $${billCoverage.totalUpcoming}
- Projected End Balance: $${billCoverage.projectedBalance}`;

      if (billsAtRisk.length > 0) {
        text += `\n\n⚠️ BILLS AT RISK (${billsAtRisk.length}):\n`;
        billsAtRisk.forEach((bill) => {
          text += `- ${bill.transaction.name}: $${bill.transaction.projectedAmount} on ${bill.transaction.scheduledDate} (Need $${bill.shortfall || 0})\n`;
        });
      }

      return text;
    };

    // Build the prompt
    const prompt = `
You are an expert financial advisor AI. Analyze the following financial data and provide actionable insights.

## Current Financial Status
Balance: $${currentBalance}

## Income Sources
${formatIncomeSources()}

## Expense Rules
${formatExpenseRules()}

## Transaction History
${formatTransactions()}
${formatBillCoverage()}

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

    const analysis = response.text || "Unable to generate analysis at this time.";

    return NextResponse.json({ analysis });
  } catch (error) {
    console.error("Gemini API Error:", error);

    if (error instanceof Error) {
      return NextResponse.json({ error: `Error: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json(
      { error: "Error connecting to AI service. Please check your API key configuration." },
      { status: 500 }
    );
  }
}
