/**
 * Stubs for the two modules that talk to third-party HTTP APIs. Registered by
 * `tests/ui/setup.ts`. Override behaviour per test through the exported spies,
 * e.g. `analyzeBudget.mockResolvedValueOnce({...})`.
 */
import { vi } from "vitest";

const EMPTY_ANALYSIS = {
  summary: "AI disabled in tests",
  insights: [] as string[],
  recommendations: [] as string[],
  warnings: [] as string[],
  opportunities: [] as string[],
};

export const geminiServiceMock = {
  DEFAULT_MODEL: "gemini-2.5-flash",
  fetchAvailableModels: vi.fn(async () => []),
  analyzeBudget: vi.fn(async () => EMPTY_ANALYSIS),
  getSmartInsights: vi.fn(async () => EMPTY_ANALYSIS),
  formatTransactionsForAI: vi.fn(() => ""),
  formatIncomeSourcesForAI: vi.fn(() => ""),
  formatExpenseRulesForAI: vi.fn(() => ""),
};

export const imageBBServiceMock = {
  validateImageFile: vi.fn(() => ({ valid: true })),
  uploadToImageBB: vi.fn(async () => "https://images.invalid/fake.png"),
};
