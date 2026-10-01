import {
  Transaction,
  IncomeSource,
  ExpenseRule,
  BillCoverageReport,
  VarianceReport,
} from "@/lib/types";
import { GoogleGenAI } from "@google/genai";
import { getCurrencySymbol } from "@/lib/utils/currency";
import { buildAnalysisPrompt, type AnalysisContext } from "./analysisPrompt";
import { getEffectiveApiKey, isApiKeyConfigured, isProduction } from "./apiKeyService";

// ============================================================================
// MODEL TYPES
// ============================================================================

export interface GeminiModel {
  name: string;
  displayName: string;
  description: string;
  supportedGenerationMethods: string[];
}

interface ModelsApiResponse {
  models: Array<{
    name: string;
    displayName: string;
    description: string;
    supportedGenerationMethods: string[];
  }>;
}

// Default model to use
export const DEFAULT_MODEL = "gemini-2.5-flash";

// ============================================================================
// FETCH AVAILABLE MODELS
// ============================================================================

/**
 * Fetches available Gemini models from the Google Generative Language API.
 * Filters to only include models that support generateContent.
 */
export const fetchAvailableModels = async (): Promise<GeminiModel[]> => {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) {
    throw new Error("API key required to fetch models");
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data: ModelsApiResponse = await response.json();

    // Filter to only Gemini 2.5+ models that support generateContent
    // Exclude preview, experimental, and older models
    return data.models
      .filter((model) => {
        const name = model.name.toLowerCase();
        // Must support generateContent
        if (!model.supportedGenerationMethods?.includes("generateContent")) return false;
        // Only include gemini-2.5 or newer
        if (!name.includes("gemini-2.5")) return false;
        // Exclude preview and experimental models
        if (name.includes("preview") || name.includes("exp")) return false;
        // Exclude nano models (check both name and displayName)
        if (name.includes("nano") || model.displayName.toLowerCase().includes("nano")) return false;
        return true;
      })
      .map((model) => ({
        name: model.name.replace("models/", ""), // Strip "models/" prefix
        displayName: model.displayName,
        description: model.description,
        supportedGenerationMethods: model.supportedGenerationMethods,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch (error) {
    console.error("Error fetching models:", error);
    throw error;
  }
};

// ============================================================================
// ANALYSIS TYPES
// ============================================================================

export type { AnalysisContext };

export interface AnalysisResult {
  summary: string;
  insights: string[];
  recommendations: string[];
  warnings: string[];
  opportunities: string[];
}

// Initialize Gemini AI client
const getGeminiClient = () => {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) {
    if (isProduction()) {
      throw new Error("API key required. Please configure your Gemini API key.");
    }
    throw new Error("NEXT_PUBLIC_GEMINI_API_KEY is not configured and no user key provided.");
  }
  return new GoogleGenAI({ apiKey });
};

export const analyzeBudget = async (
  context: AnalysisContext,
  model: string = DEFAULT_MODEL
): Promise<string> => {
  try {
    const ai = getGeminiClient();
    const prompt = buildAnalysisPrompt(context);

    // Generate content using Gemini with selected model
    const response = await ai.models.generateContent({
      model,
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
  currencySymbol: string = getCurrencySymbol()
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
  currencySymbol: string = getCurrencySymbol()
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
  currencySymbol: string = getCurrencySymbol()
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
