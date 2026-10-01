/**
 * Deterministic stand-in for app/lib/services/geminiService.ts (aliased in
 * when FINTRACK_E2E=1). No network. Signatures mirror the real module.
 *
 * Test hooks on window.__fintrackE2E:
 *   geminiResponse  string  -> text analyzeBudget() resolves with
 *   geminiError     string  -> analyzeBudget() resolves with "Error: <string>"
 *                              (the real one swallows errors into a string too)
 *   geminiCalls     array   -> every call, { model, context, prompt } (context is the
 *                              AnalysisContext the page passed in; prompt is the text the
 *                              real buildAnalysisPrompt makes from it)
 */
import { buildAnalysisPrompt } from "@/lib/services/analysisPrompt";
import { getCurrencySymbol } from "@/lib/utils/currency";
import type {
  Transaction,
  IncomeSource,
  ExpenseRule,
  BillCoverageReport,
  VarianceReport,
} from "@/lib/types";

export interface GeminiModel {
  name: string;
  displayName: string;
  description: string;
  supportedGenerationMethods: string[];
}

export const DEFAULT_MODEL = "gemini-2.5-flash";

export interface AnalysisContext {
  transactions: Transaction[];
  incomeSources: IncomeSource[];
  expenseRules: ExpenseRule[];
  currentBalance: number;
  billCoverage?: BillCoverageReport;
  varianceReport?: VarianceReport;
  currencySymbol?: string;
  periodSummary?: {
    dateRange: { start: string; end: string };
    actualIncome: number;
    actualExpenses: number;
    budgetedIncome: number;
    budgetedExpenses: number;
    savingsRate: number;
  };
}

export interface AnalysisResult {
  summary: string;
  insights: string[];
  recommendations: string[];
  warnings: string[];
  opportunities: string[];
}

export const FAKE_MODELS: GeminiModel[] = [
  {
    name: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash (E2E fake)",
    description: "Deterministic fake model",
    supportedGenerationMethods: ["generateContent"],
  },
  {
    name: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro (E2E fake)",
    description: "Deterministic fake model",
    supportedGenerationMethods: ["generateContent"],
  },
];

export const FAKE_ANALYSIS_TEXT =
  "**1. Financial Health Overview**\nE2E FAKE AI ANALYSIS - deterministic response.\n\n" +
  "**2. Key Observations**\n- Fake observation one\n- Fake observation two";

type BridgeShape = {
  geminiCalls?: unknown[];
  geminiResponse?: string | null;
  geminiError?: string | null;
};
const bridge = (): BridgeShape | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { __fintrackE2E?: BridgeShape }).__fintrackE2E;

export const fetchAvailableModels = async (): Promise<GeminiModel[]> => FAKE_MODELS;

export const analyzeBudget = async (
  context: AnalysisContext,
  model: string = DEFAULT_MODEL
): Promise<string> => {
  const b = bridge();
  // `prompt` is the text the REAL prompt builder would send (pure module, no SDK): specs assert on what the AI
  // would actually be told, not on a re-implementation of the selection.
  b?.geminiCalls?.push({
    model,
    context: JSON.parse(JSON.stringify(context)),
    prompt: buildAnalysisPrompt(context),
  });
  if (b?.geminiError) return `Error: ${b.geminiError}`;
  return b?.geminiResponse ?? FAKE_ANALYSIS_TEXT;
};

export const getSmartInsights = async (context: AnalysisContext): Promise<AnalysisResult> => ({
  summary: await analyzeBudget(context),
  insights: [],
  recommendations: [],
  warnings: [],
  opportunities: [],
});

// Formatters are pure string builders; keep them trivial but stable.
export const formatTransactionsForAI = (transactions: Transaction[], symbol = getCurrencySymbol()): string =>
  transactions.map((t) => `- ${t.name}: ${symbol}${t.actualAmount ?? t.projectedAmount}`).join("\n");
export const formatIncomeSourcesForAI = (sources: IncomeSource[], symbol = getCurrencySymbol()): string =>
  sources.map((s) => `- ${s.name}: ${symbol}${s.amount}`).join("\n");
export const formatExpenseRulesForAI = (rules: ExpenseRule[], symbol = getCurrencySymbol()): string =>
  rules.map((r) => `- ${r.name}: ${symbol}${r.amount}`).join("\n");
