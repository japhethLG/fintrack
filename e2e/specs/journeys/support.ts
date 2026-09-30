/**
 * Journey helpers: thin UI drivers and read-only probes used only by the
 * specs in this folder. Nothing here imports app logic and nothing asserts
 * product behaviour on its own except `expectBalancesEverywhere`, which
 * compares what the UI *displays* with a value the caller derived by hand.
 */
import { expect, type Page, type Locator } from "@playwright/test";
import { COLLECTIONS, readCollection, readStore } from "../../index";
import { navigateVia, waitForAppReady, loginViaForm, type NavLabel } from "../../helpers/flows";

export type { NavLabel };
export { navigateVia, waitForAppReady, loginViaForm };

// ---------------------------------------------------------------------------
// Formatting (mirrors what a user reads on screen; deliberately re-implemented)
// ---------------------------------------------------------------------------

/** "1234.5" -> "1,234.50" (en-US grouping, 2 decimals). */
export const fmt2 = (n: number): string =>
  Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "1234" -> "1,234" (0 decimals). */
export const fmt0 = (n: number): string =>
  Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** "₱1,234.50" / "-₱1,234.50" */
export const money = (n: number, symbol = "₱"): string => `${n < 0 ? "-" : ""}${symbol}${fmt2(n)}`;
export const money0 = (n: number, symbol = "₱"): string => `${n < 0 ? "-" : ""}${symbol}${fmt0(n)}`;

export const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Store probes
// ---------------------------------------------------------------------------

export interface StoredTxn {
  id: string;
  name: string;
  type: "income" | "expense";
  status: "projected" | "completed" | "skipped";
  scheduledDate: string;
  actualDate?: string;
  projectedAmount: number;
  actualAmount?: number;
  sourceId?: string;
  sourceType: string;
  occurrenceId?: string;
  paymentBreakdown?: { paymentNumber: number; totalPayments: number; remainingBalance: number };
}

export interface StoredUser {
  currentBalance: number;
  initialBalance?: number;
  balanceLastUpdatedAt?: string;
  preferences: { currency: string; defaultWarningThreshold: number };
}

export const readUser = async (page: Page): Promise<StoredUser> => {
  const users = await readCollection<StoredUser & { uid: string }>(page, COLLECTIONS.users);
  expect(users, "exactly one users/{uid} document").toHaveLength(1);
  return users[0];
};

export const readTxns = (page: Page): Promise<StoredTxn[]> => readCollection<StoredTxn>(page, COLLECTIONS.transactions);

/** Signed sum of COMPLETED transactions: +income, -expense (actualAmount ?? projectedAmount). */
export const signedCompleted = (txns: StoredTxn[]): number =>
  txns
    .filter((t) => t.status === "completed")
    .reduce((s, t) => s + (t.type === "income" ? 1 : -1) * (t.actualAmount ?? t.projectedAmount), 0);

export const readRule = async <T = Record<string, unknown>>(page: Page, name: string): Promise<T & { id: string }> => {
  const [income, expense] = await Promise.all([
    readCollection<{ name: string }>(page, COLLECTIONS.incomeSources),
    readCollection<{ name: string }>(page, COLLECTIONS.expenseRules),
  ]);
  const hit = [...income, ...expense].filter((r) => r.name === name);
  expect(hit, `rule named ${name}`).toHaveLength(1);
  return hit[0] as unknown as T & { id: string };
};

export const storeOps = async (page: Page) => (await readStore(page)).ops;

// ---------------------------------------------------------------------------
// Navigation / clock
// ---------------------------------------------------------------------------

/** Move the frozen browser clock, then hard-load `path` (the app reads `new Date()` at mount). */
export const moveClockAndLoad = async (page: Page, iso: string, path: string, label: NavLabel): Promise<void> => {
  await page.clock.setFixedTime(new Date(iso));
  await loadPage(page, path, label);
};

export const PAGE_HEADING: Record<NavLabel, string> = {
  Dashboard: "Dashboard",
  "Financial Calendar": "Financial Calendar",
  "Income Manager": "Income Management",
  "Expense Manager": "Expense Management",
  Transactions: "Transactions",
  "AI Forecast": "AI Financial Forecaster",
  Settings: "Settings",
};

/** Client-side navigation, then wait for the destination's own <h1> (pages show a spinner first). */
export const gotoPage = async (page: Page, label: NavLabel): Promise<void> => {
  await navigateVia(page, label);
  await expect(page.getByRole("heading", { name: PAGE_HEADING[label], level: 1 })).toBeVisible();
  await waitForAppReady(page);
};

/** Hard-load a route (after moving the clock, for instance) and wait for its h1. */
export const loadPage = async (page: Page, path: string, label: NavLabel): Promise<void> => {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: PAGE_HEADING[label], level: 1 })).toBeVisible();
  await waitForAppReady(page);
};

/** "-₱1,234.50" / "+₱2,000" / "₱8,662.5" -> number. */
export const parseMoney = (text: string): number => {
  const neg = /^\s*[-\u2212]/.test(text);
  const n = Number(text.replace(/[^0-9.]/g, ""));
  if (Number.isNaN(n)) throw new Error(`parseMoney: no number in ${JSON.stringify(text)}`);
  return neg ? -n : n;
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Real /signup form. Ends on the dashboard. */
export const signUpViaForm = async (page: Page, email: string, password = "e2e-password"): Promise<void> => {
  await page.goto("/signup");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign Up", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
};

// ---------------------------------------------------------------------------
// Form primitives (antd DatePicker, Radix Select)
// ---------------------------------------------------------------------------

/** Type MM/DD/YYYY into an antd date input (by id) and commit by blurring (Tab). */
export const fillDate = async (page: Page, id: string, ymd: string): Promise<void> => {
  const [y, m, d] = ymd.split("-");
  const input = page.locator(`#${id}`);
  await input.click();
  await input.fill(`${m}/${d}/${y}`);
  // NOT Enter: inside these wizards Enter submits the whole <form> (see JRN enter-submits probe).
  await input.press("Tab");
  await expect(input).toHaveValue(`${m}/${d}/${y}`);
};

/** Choose an option of a Radix <Select> by its label text (trigger is labelled). */
export const chooseOption = async (page: Page, label: string | RegExp, option: string | RegExp): Promise<void> => {
  await page.getByLabel(label).click();
  await page.getByRole("option", { name: option }).click();
};

const cont = (page: Page): Promise<void> => page.getByRole("button", { name: "Continue" }).click();

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const setInitialBalanceViaSettings = async (page: Page, amount: number): Promise<void> => {
  await page.getByRole("button", { name: /Update Initial Balance/ }).click();
  await page.getByLabel("Set Initial Balance").fill(String(amount));
  await page.getByRole("button", { name: "Update Initial Balance", exact: true }).click();
  // With completed history the app asks for confirmation first.
  const confirm = page.getByRole("button", { name: "Update & Recalculate" });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
};

// ---------------------------------------------------------------------------
// Wizards
// ---------------------------------------------------------------------------

export interface IncomeWizardInput {
  name: string;
  amount: number;
  frequency?: "One-time" | "Daily" | "Weekly" | "Bi-weekly" | "Semi-monthly" | "Monthly" | "Quarterly" | "Yearly";
  /** YYYY-MM-DD; default is the wizard's own default (today, UTC-derived). */
  startDate?: string;
  /** semi-monthly: replace the default 15/30 with these days. */
  specificDays?: number[];
  dayOfMonth?: number;
  weekday?: string;
  weekendAdjustment?: "Pay on Friday if weekend" | "Pay on Monday if weekend" | "No adjustment";
}

export const removeSpecificDay = async (page: Page, day: number): Promise<void> => {
  // the chip is <div><span>15th</span><icon>close</icon></div>: find the ordinal's own element, then its chip
  const ordinalEl = page.getByText(new RegExp(`^${day}(st|nd|rd|th)$`)).last();
  await ordinalEl.locator("xpath=..").getByText("close").click();
};

export const addIncomeViaWizardFull = async (page: Page, o: IncomeWizardInput): Promise<void> => {
  await page.getByRole("button", { name: /Add Income/ }).click();
  await page.getByRole("heading", { name: "Salary", level: 4 }).click();
  await cont(page);
  await page.getByLabel("Source Name *").fill(o.name);
  await page.getByLabel("Amount *").fill(String(o.amount));
  await cont(page);
  if (o.frequency) await chooseOption(page, "Frequency *", new RegExp(`^${o.frequency}`));
  if (o.startDate) await fillDate(page, "startDate", o.startDate);
  if (o.specificDays) {
    for (const d of [15, 30]) if (!o.specificDays.includes(d)) await removeSpecificDay(page, d);
    for (const d of o.specificDays.filter((x) => x !== 15 && x !== 30)) {
      await page.getByPlaceholder("Day (1-31)").fill(String(d));
      await page.getByRole("button", { name: "Add Date" }).click();
    }
  }
  if (o.dayOfMonth !== undefined) await page.getByLabel("Day of Month").fill(String(o.dayOfMonth));
  if (o.weekday) await chooseOption(page, "Day of Week", o.weekday);
  if (o.weekendAdjustment) await chooseOption(page, "Weekend Adjustment", o.weekendAdjustment);
  await cont(page);
  await page.getByRole("button", { name: "Create Income Source" }).click();
  await expect(page.getByRole("heading", { name: o.name, level: 2 }).or(page.getByRole("heading", { name: o.name, level: 4 })).first()).toBeVisible();
};

export interface ExpenseWizardCommon {
  name: string;
  startDate?: string;
  weekendAdjustment?: "Pay on Friday if weekend" | "Pay on Monday if weekend" | "No adjustment";
}

const pickExpenseType = async (page: Page, title: RegExp | string): Promise<void> => {
  await page.getByRole("button", { name: /Add Expense/ }).click();
  await page.getByRole("heading", { name: title, level: 4 }).click();
  await cont(page);
};

const finishExpense = async (page: Page, name: string): Promise<void> => {
  await page.getByRole("button", { name: "Create Expense" }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
};

export const addFixedExpenseViaWizard = async (
  page: Page,
  o: ExpenseWizardCommon & { amount: number; dayOfMonth?: number; frequency?: string; weekday?: string; variable?: boolean }
): Promise<void> => {
  await pickExpenseType(page, o.variable ? "Variable" : "Fixed Recurring");
  await page.getByLabel("Expense Name *").fill(o.name);
  await page.getByLabel("Amount *").fill(String(o.amount));
  await cont(page);
  if (o.frequency) await chooseOption(page, /^Frequency/, new RegExp(`^${o.frequency}`));
  if (o.startDate) await fillDate(page, "startDate", o.startDate);
  if (o.dayOfMonth !== undefined) await page.getByLabel("Day of Month").fill(String(o.dayOfMonth));
  if (o.weekday) await chooseOption(page, "Day of Week", o.weekday);
  if (o.weekendAdjustment) await chooseOption(page, "Weekend Adjustment", o.weekendAdjustment);
  // fixed / variable wizards are 3 steps: "Schedule & Review" ends with Create Expense.
  await finishExpense(page, o.name);
};

export const addLoanViaWizard = async (
  page: Page,
  o: ExpenseWizardCommon & { principal: number; ratePct: number; termMonths: number; firstPayment: string; loanStart?: string; currentBalance?: number }
): Promise<void> => {
  await pickExpenseType(page, "Loan");
  await page.getByLabel("Loan Name *").fill(o.name);
  await page.getByLabel(/Original Principal/).fill(String(o.principal));
  if (o.currentBalance !== undefined) await page.getByLabel(/Current Balance/).fill(String(o.currentBalance));
  await page.getByLabel(/Annual Interest Rate/).fill(String(o.ratePct));
  await page.getByLabel(/Term \(Months\)/).fill(String(o.termMonths));
  if (o.loanStart) await fillDate(page, "loanStartDate", o.loanStart);
  await cont(page);
  await fillDate(page, "startDate", o.firstPayment);
  const dom = page.getByLabel("Day of Month");
  if (await dom.isVisible().catch(() => false)) await dom.fill(String(Number(o.firstPayment.slice(8))));
  if (o.weekendAdjustment) await chooseOption(page, "Weekend Adjustment", o.weekendAdjustment);
  await cont(page);
  await finishExpense(page, o.name);
};

export const addInstallmentViaWizard = async (
  page: Page,
  o: ExpenseWizardCommon & { total: number; count: number; firstPayment: string }
): Promise<void> => {
  await pickExpenseType(page, "Installment");
  await page.getByLabel("Item Name *").fill(o.name);
  await page.getByLabel(/Total Amount/).fill(String(o.total));
  await page.getByLabel(/Number of Installments/).fill(String(o.count));
  await cont(page);
  await fillDate(page, "startDate", o.firstPayment);
  const dom = page.getByLabel("Day of Month");
  if (await dom.isVisible().catch(() => false)) await dom.fill(String(Number(o.firstPayment.slice(8))));
  if (o.weekendAdjustment) await chooseOption(page, "Weekend Adjustment", o.weekendAdjustment);
  await cont(page);
  await finishExpense(page, o.name);
};

export const addCreditCardViaWizard = async (
  page: Page,
  o: ExpenseWizardCommon & {
    limit: number;
    balance: number;
    aprPct: number;
    dueDay: number;
    strategy?: "Minimum Payment" | "Fixed Amount" | "Pay Full Balance";
    fixedPayment?: number;
    minPct?: number;
    minFloor?: number;
    startDate: string;
  }
): Promise<void> => {
  await pickExpenseType(page, "Credit Card");
  await page.getByLabel("Credit Card Name *").fill(o.name);
  await page.getByLabel(/Credit Limit/).fill(String(o.limit));
  await page.getByLabel(/Current Balance/).fill(String(o.balance));
  await page.getByLabel(/^APR/).fill(String(o.aprPct));
  if (o.minPct !== undefined) await page.getByLabel(/Minimum Payment %/).fill(String(o.minPct));
  if (o.minFloor !== undefined) await page.getByLabel(/Min Payment Floor/).fill(String(o.minFloor));
  await page.getByLabel(/^Due Date/).fill(String(o.dueDay));
  if (o.strategy) await chooseOption(page, /Payment Strategy/, o.strategy);
  if (o.fixedPayment !== undefined) await page.getByLabel(/Fixed Payment Amount/).fill(String(o.fixedPayment));
  await cont(page);
  await fillDate(page, "startDate", o.startDate);
  await cont(page);
  await finishExpense(page, o.name);
};

// ---------------------------------------------------------------------------
// Transaction modal (calendar / lists / widgets all open the same dialog)
// ---------------------------------------------------------------------------

export const transactionDialog = (page: Page): Locator => page.getByRole("dialog");

/** Open a transaction from the calendar day sidebar: select the day, click the row by name. */
export const openCalendarDay = async (page: Page, dayNumber: number): Promise<void> => {
  // Day cells are buttons/divs containing the day number; choose the one inside the month grid.
  await page.locator("div.grid.grid-cols-7 > div").filter({ hasText: new RegExp(`^${dayNumber}(\\D|$)`) }).first().click();
};

export const completeInDialog = async (page: Page, amount?: number | string): Promise<void> => {
  const d = transactionDialog(page);
  await expect(d).toBeVisible();
  if (amount !== undefined) await d.getByLabel("Actual Amount").fill(String(amount));
  await d.getByRole("button", { name: "Mark Complete" }).click();
  await expect(d).toBeHidden();
};

export const skipInDialog = async (page: Page): Promise<void> => {
  const d = transactionDialog(page);
  await expect(d).toBeVisible();
  await d.getByRole("button", { name: /Skip$/ }).click();
  await d.getByRole("button", { name: "Skip Transaction" }).click();
  await expect(d).toBeHidden();
};

export const revertInDialog = async (page: Page): Promise<void> => {
  const d = transactionDialog(page);
  await expect(d).toBeVisible();
  await d.getByRole("button", { name: /Revert$/ }).first().click();
  await d.getByRole("button", { name: "Revert to Projected" }).click();
  await expect(d).toBeHidden();
};

// ---------------------------------------------------------------------------
// Displayed balances (what the user actually reads)
// ---------------------------------------------------------------------------

export interface DisplayedBalances {
  /** Dashboard "Current Balance" KPI. */
  dashboard: string;
  /** Calendar: closing balance of the day selected with the "Today" button. */
  calendarTodayClosing: string;
  /** Forecast "Current Balance" insight card. */
  forecast: string;
  /** Settings > Balance Management "Current". */
  settings: string;
  /** Settings > "Computed from N transactions" figure. */
  settingsComputed: string;
}

export const dashboardBalanceText = async (page: Page): Promise<string> => {
  const el = page.locator("p", { hasText: /^Current Balance$/ }).locator("xpath=../following-sibling::h2").first();
  await expect(el).toBeVisible();
  return (await el.innerText()).trim();
};

export const calendarTodayClosingText = async (page: Page): Promise<string> => {
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const el = page.locator("span", { hasText: /^Closing$/ }).locator("xpath=following-sibling::span").first();
  await expect(el).toBeVisible();
  return (await el.innerText()).trim();
};

export const forecastBalanceText = async (page: Page): Promise<string> => {
  const el = page.locator("p", { hasText: /^Current Balance$/ }).locator("xpath=following-sibling::p").first();
  await expect(el).toBeVisible();
  return (await el.innerText()).trim();
};

export const settingsBalanceTexts = async (page: Page): Promise<{ current: string; computed: string }> => {
  const cur = page.locator("p", { hasText: /^Current$/ }).locator("xpath=following-sibling::p").first();
  await expect(cur).toBeVisible();
  const comp = page.getByText(/^Computed from \d+ transactions$/).locator("xpath=following-sibling::span").first();
  return { current: (await cur.innerText()).trim(), computed: (await comp.innerText()).trim() };
};

/** Visit Dashboard, Calendar, Forecast and Settings (client-side) and read each balance figure. */
export const readDisplayedBalances = async (page: Page): Promise<DisplayedBalances> => {
  await gotoPage(page, "Dashboard");
  const dashboard = await dashboardBalanceText(page);
  await gotoPage(page, "Financial Calendar");
  const calendarTodayClosing = await calendarTodayClosingText(page);
  await gotoPage(page, "AI Forecast");
  const forecast = await forecastBalanceText(page);
  await gotoPage(page, "Settings");
  const { current, computed } = await settingsBalanceTexts(page);
  return { dashboard, calendarTodayClosing, forecast, settings: current, settingsComputed: computed };
};

/**
 * The journey invariant. `expected` is the caller's hand-derived balance:
 *   initialBalance + sum(signed completed transactions).
 * Asserts the persisted profile, the persisted history and all four screens.
 */
export const expectBalanceInvariant = async (
  page: Page,
  o: { initial: number; expected: number; completedCount?: number; tolerance?: number }
): Promise<DisplayedBalances> => {
  const tol = o.tolerance ?? 0.005;
  const user = await readUser(page);
  const txns = await readTxns(page);
  const derived = o.initial + signedCompleted(txns);
  expect(derived, "hand value vs signed sum of stored completed transactions").toBeCloseTo(o.expected, 2);
  expect(user.currentBalance, "users/{uid}.currentBalance == initialBalance + sum(signed completed)").toBeCloseTo(o.expected, 2);
  if (o.completedCount !== undefined) expect(txns.filter((t) => t.status === "completed")).toHaveLength(o.completedCount);
  const shown = await readDisplayedBalances(page);
  for (const [where, text] of Object.entries({
    Dashboard: shown.dashboard,
    "Calendar (today closing)": shown.calendarTodayClosing,
    Forecast: shown.forecast,
    Settings: shown.settings,
    "Settings (computed)": shown.settingsComputed,
  })) {
    expect(Math.abs(parseMoney(text) - o.expected), `${where} shows ${text}, expected ${o.expected}`).toBeLessThanOrEqual(
      // calendar / forecast round to whole units when integral; allow their display precision
      where.startsWith("Calendar") ? 0.5 + tol : tol
    );
  }
  return shown;
};

// ---------------------------------------------------------------------------
// Calendar: open a transaction by day + name
// ---------------------------------------------------------------------------

/** Navigate the month grid to `monthLabel` (e.g. "April 2026") using the chevrons (forward or back). */
export const calendarShowMonth = async (page: Page, monthLabel: string): Promise<void> => {
  const heading = page.getByRole("heading", { name: /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/ });
  const order = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const idx = (label: string) => {
    const [m, y] = label.split(" ");
    return Number(y) * 12 + order.indexOf(m);
  };
  for (let i = 0; i < 24; i++) {
    const cur = (await heading.innerText()).trim();
    if (cur === monthLabel) return;
    const forward = idx(monthLabel) > idx(cur);
    await page.locator("button:has(span:text-is('" + (forward ? "chevron_right" : "chevron_left") + "'))").first().click();
    await expect(heading).not.toHaveText(cur);
  }
  throw new Error(`could not reach ${monthLabel}`);
};

/** Select day-of-month `day` in the visible month grid (current-month cells only). */
export const calendarSelectDay = async (page: Page, day: number): Promise<void> => {
  await page.getByRole("button", { name: "Month", exact: true }).click(); // clears any selection
  await page
    .locator("div.min-h-\\[100px\\]:not(.opacity-50)")
    .filter({ hasText: new RegExp(`^${day}(?!\\d)`) })
    .first()
    .locator("span")
    .first() // the day number: clicking the cell centre would hit a transaction chip and open its modal
    .click();
};

/** Open transaction `name` scheduled on `day` of the visible month via the day sidebar. */
export const openCalendarTxn = async (page: Page, day: number, name: string): Promise<void> => {
  await calendarSelectDay(page, day);
  const sidebar = page.locator("div.sticky");
  await sidebar.getByText(name, { exact: true }).first().click();
  await expect(transactionDialog(page)).toBeVisible();
};

/** Rows listed in the calendar day sidebar for the selected day: [{name,text}] */
export const calendarSidebarRows = async (page: Page): Promise<string[]> => {
  const sidebar = page.locator("div.sticky");
  return (await sidebar.locator("div.cursor-pointer").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
};

// ---------------------------------------------------------------------------
// Timezones
// ---------------------------------------------------------------------------

/** UTC offset in minutes (east positive) that `timeZone` has at the given UTC instant. */
const tzOffsetMinutes = (timeZone: string, at: Date): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
};

/** The UTC instant at which the wall clock in `timeZone` reads `ymd` `hh:mm` (test-side helper). */
export const localInstant = (timeZone: string, ymd: string, hhmm: string): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0);
  let guess = new Date(wall - tzOffsetMinutes(timeZone, new Date(wall)) * 60000);
  guess = new Date(wall - tzOffsetMinutes(timeZone, guess) * 60000); // refine across DST edges
  return guess.toISOString();
};
