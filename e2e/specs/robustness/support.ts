/**
 * Local helpers for the robustness specs. Nothing here imports app logic.
 */
import { expect, type Page } from "@playwright/test";
import type { Diagnostics } from "../../fixtures";
import { COLLECTIONS, readCollection, readDocument, TEST_UID } from "../../index";

export interface AppPage {
  path: string;
  /** Text of the page's <h1>. */
  h1: string;
  label: string;
}

export const APP_PAGES: AppPage[] = [
  { path: "/dashboard", h1: "Dashboard", label: "Dashboard" },
  { path: "/calendar", h1: "Financial Calendar", label: "Financial Calendar" },
  { path: "/income", h1: "Income Management", label: "Income Manager" },
  { path: "/expenses", h1: "Expense Management", label: "Expense Manager" },
  { path: "/transactions", h1: "Transactions", label: "Transactions" },
  { path: "/forecast", h1: "AI Financial Forecaster", label: "AI Forecast" },
  { path: "/settings", h1: "Settings", label: "Settings" },
];

/** True when the page's main thread answers within `ms`. A frozen tab never does. */
export const isResponsive = async (page: Page, ms = 5_000): Promise<boolean> => {
  const result = await Promise.race([
    page.evaluate(() => 1).then(() => true).catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
  return result;
};

/** Tokens that must never be rendered as user-visible text. */
export const BAD_TOKENS = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object Object\]|Invalid Date/;

/** Every bad token found in the visible text of the page. */
export const badTokens = async (page: Page): Promise<string[]> =>
  page.evaluate((src) => {
    const re = new RegExp(src, "g");
    return (document.body.innerText.match(re) ?? []).slice(0, 10);
  }, BAD_TOKENS.source);

/** Horizontal overflow of the document (0 when none). */
export const horizontalOverflow = async (page: Page): Promise<{ scrollWidth: number; innerWidth: number }> =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

/** Firestore doc shape used for invariants. */
interface Txn {
  status: string;
  type: "income" | "expense";
  projectedAmount: number;
  actualAmount?: number;
}

/**
 * The bookkeeping invariant: currentBalance == initialBalance + sum(signed completed).
 * Returns both sides so a failure message shows the drift.
 */
export const balanceInvariant = async (
  page: Page,
  uid: string = TEST_UID
): Promise<{ current: number; expected: number; completed: number; drift: number }> => {
  const user = await readDocument<{ currentBalance: number; initialBalance: number }>(page, COLLECTIONS.users, uid);
  const txns = await readCollection<Txn>(page, COLLECTIONS.transactions);
  const completed = txns.filter((t) => t.status === "completed");
  const signed = completed.reduce((sum, t) => sum + (t.type === "income" ? 1 : -1) * (t.actualAmount ?? t.projectedAmount), 0);
  const expected = (user?.initialBalance ?? 0) + signed;
  const current = user?.currentBalance ?? NaN;
  return { current, expected, completed: completed.length, drift: current - expected };
};

/** Collect page errors / console errors from an ADDITIONAL tab (the fixture only watches `page`). */
export const watchTab = (tab: Page, into: Diagnostics): void => {
  tab.on("pageerror", (err) => into.pageErrors.push(`${err.name}: ${err.message}`));
  tab.on("console", (msg) => {
    if (msg.type() === "error") into.consoleErrors.push(msg.text());
    else if (msg.type() === "warning") into.consoleWarnings.push(msg.text());
  });
};

/** Console noise that is known-benign (Recharts sizing on first paint). */
export const isBenignConsole = (text: string): boolean => /width\(-?\d+\) and height\(-?\d+\)/.test(text);

export const seriousConsoleErrors = (d: Diagnostics): string[] => d.consoleErrors.filter((m) => !isBenignConsole(m));

export const expectClean = (d: Diagnostics, label = ""): void => {
  expect(d.pageErrors, `uncaught page errors ${label}`).toEqual([]);
};

// ---------------------------------------------------------------------------
// Flows shared by several robustness specs
// ---------------------------------------------------------------------------

/** Transaction modal (data-testid is set by the app's modal host). */
export const txnModal = (page: Page) => page.getByTestId("transaction-modal");

/** Click a transaction/occurrence by name on the calendar / lists and return its modal. */
export const openTransaction = async (page: Page, name: string) => {
  await page.getByText(name, { exact: true }).first().click();
  const modal = txnModal(page);
  await expect(modal).toBeVisible();
  return modal;
};

/** Expenses page -> "Add Expense" -> Fixed Recurring -> defaults -> "Create Expense" (last click included). */
export const addFixedExpenseViaWizard = async (page: Page, name: string, amount: number): Promise<void> => {
  await page.getByRole("button", { name: /Add Expense/ }).click();
  await page.getByRole("heading", { name: "Fixed Recurring", level: 4 }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/Expense Name/).fill(name);
  await page.getByLabel(/Amount/).fill(String(amount));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Expense" }).click();
};

/** Visible fault text produced by the harness for any injected Firestore fault. */
export const FAULT_TEXT = /Firestore fault injected by E2E harness/;
