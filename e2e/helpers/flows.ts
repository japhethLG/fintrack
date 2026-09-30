/**
 * Thin UI flows discovered while building the harness. Selectors are
 * role/label/text based (no data-testid in the app). Keep these dumb: they
 * drive the UI, they never assert product behaviour.
 */
import { expect, type Page } from "@playwright/test";

/** Sidebar entries (desktop layout, viewport >= 1024px). Buttons, not links. */
export type NavLabel =
  | "Dashboard"
  | "Financial Calendar"
  | "Income Manager"
  | "Expense Manager"
  | "Transactions"
  | "AI Forecast"
  | "Settings";

/** Client-side navigation via the sidebar (no full page load). */
export const navigateVia = async (page: Page, label: NavLabel): Promise<void> => {
  // Accessible name is "<material-icon-ligature> <Label>", e.g. "calendar_month Financial Calendar".
  await page.getByRole("navigation").getByRole("button", { name: new RegExp(`${label}$`) }).click();
};

/** Wait until the app shell has left its "Loading..." state. */
export const waitForAppReady = async (page: Page): Promise<void> => {
  await expect(page.getByText("Loading...")).toHaveCount(0);
};

export interface AddIncomeOptions {
  /** Card title on step 1: Salary | Freelance | Business | Investment | Rental | Government | Gift | Other */
  type?: string;
  name: string;
  amount: number | string;
  notes?: string;
}

/**
 * Income Manager -> "Add Income" 4-step wizard with default schedule
 * (monthly, start = today, day-of-month = today). Ends on the saved state.
 * Precondition: you are on /income.
 */
export const addIncomeViaWizard = async (page: Page, o: AddIncomeOptions): Promise<void> => {
  await page.getByRole("button", { name: /Add Income/ }).click();
  await page.getByRole("heading", { name: o.type ?? "Salary", level: 4 }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Source Name *").fill(o.name);
  await page.getByLabel("Amount *").fill(String(o.amount));
  await page.getByRole("button", { name: "Continue" }).click(); // -> schedule
  await page.getByRole("button", { name: "Continue" }).click(); // -> review
  if (o.notes) await page.getByLabel("Notes (Optional)").fill(o.notes);
  await page.getByRole("button", { name: "Create Income Source" }).click();
};

/**
 * Open a transaction from the calendar / transaction lists by its name and
 * complete it with the default (projected) amount. Works for stored
 * transactions and for projected occurrences (the app then materialises a
 * completed transaction doc). Precondition: the name is visible on the page.
 */
export const completeTransactionByName = async (page: Page, name: string, actualAmount?: number): Promise<void> => {
  await page.getByText(name, { exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Transaction" });
  if (actualAmount !== undefined) await dialog.getByLabel("Actual Amount").fill(String(actualAmount));
  await dialog.getByRole("button", { name: "Mark Complete" }).click();
};

/**
 * Fill and submit the real /login form. Precondition: you are on /login.
 * GOTCHA: `getByLabel("Password")` is ambiguous (the "Show password" toggle
 * button matches too) and so is `getByRole("button", {name:"Sign In"})` (it
 * substring-matches "Sign in with Google") — `exact: true` is required for both.
 */
export const loginViaForm = async (page: Page, email: string, password = "e2e-password"): Promise<void> => {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
};
