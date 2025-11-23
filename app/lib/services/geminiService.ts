import { Transaction, IncomeRule } from "@/lib/types";

export const analyzeBudget = async (
  transactions: Transaction[],
  rules: IncomeRule[],
  currentBalance: number
): Promise<string> => {
  try {
    const response = await fetch("/api/analyze-budget", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transactions,
        rules,
        currentBalance,
      }),
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
