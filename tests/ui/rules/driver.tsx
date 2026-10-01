/**
 * Shared drivers for the rule-form specs (income sources + expense rules).
 *
 * Everything here drives the REAL wizards through Testing Library / user-event
 * and reads back the persisted document, the form's own Schedule Preview and
 * the projections the provider actually generates. Nothing here computes an
 * expectation with app code: `pmt`, `label`, `sum` are written independently.
 */
import { expect } from "vitest";
import { screen, within, waitFor, type AppHandle } from "../harness";

// ---------------------------------------------------------------------------
// Low-level widget helpers
// ---------------------------------------------------------------------------

/** Open a Radix <Select> by its label and pick an option by its visible name. */
export async function pick(app: AppHandle, label: RegExp | string, option: string | RegExp) {
  await app.user.click(await screen.findByLabelText(label));
  await app.user.click(await screen.findByRole("option", { name: option }));
}

/** Replace the value of a text/number input found by label. */
export async function fill(app: AppHandle, label: RegExp | string, text: string) {
  const el = (await screen.findByLabelText(label)) as HTMLInputElement;
  await app.user.clear(el);
  if (text !== "") await app.user.type(el, text);
}

/** Type a date into an antd DatePicker found by label (ISO in, MM/DD/YYYY typed). */
export async function setDate(app: AppHandle, label: RegExp | string, iso: string) {
  const [y, m, d] = iso.split("-");
  const el = (await screen.findByLabelText(label)) as HTMLInputElement;
  await app.user.clear(el);
  await app.user.type(el, `${m}/${d}/${y}{Enter}`);
}

export async function check(app: AppHandle, name: RegExp | string) {
  await app.user.click(await screen.findByRole("checkbox", { name }));
}

export async function next(app: AppHandle) {
  await app.user.click(screen.getByRole("button", { name: "Continue" }));
  // the wizard advances after an async yup validation; DTL's fake-clock polling can outrun it
  await app.settle();
}

export const nextButton = () => screen.getByRole("button", { name: "Continue" });

// ---------------------------------------------------------------------------
// Schedule Preview reader
// ---------------------------------------------------------------------------

/** "Feb 6 Fri" style labels of the preview cards (max 8 are ever rendered). */
export function previewCards(): string[] {
  const heading = screen.queryByText("Schedule Preview");
  if (!heading) return [];
  const card = heading.parentElement!;
  const grid = card.querySelector(".grid");
  if (!grid) return [];
  return Array.from(grid.children).map((c) =>
    Array.from(c.querySelectorAll("p"))
      .map((p) => p.textContent)
      .join(" ")
  );
}

/** The "+N more occurrences" overflow count, or 0. */
export function previewMore(): number {
  const m = document.body.textContent?.match(/\+(\d+) more occurrences/);
  return m ? Number(m[1]) : 0;
}

// ---------------------------------------------------------------------------
// Independent calendar / money helpers (no app code)
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-02-06" -> "Feb 6 Fri" (the Schedule Preview card text). */
export function label(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${MONTHS[m - 1]} ${d} ${DOW[wd]}`;
}

/** Standard amortising payment, written from the textbook formula: P*r / (1 - (1+r)^-n). */
export function pmt(principal: number, annualPct: number, n: number): number {
  const r = annualPct / 100 / 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const cents = (n: number) => Math.round(n * 100) / 100;
/** true if `n` has no fractional cents (within float noise). */
export const isWholeCents = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

/** Every NaN / Infinity reachable in a persisted document, as dotted paths. */
export function nonFinitePaths(value: unknown, path = ""): string[] {
  if (typeof value === "number") return Number.isFinite(value) ? [] : [`${path}=${value}`];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      nonFinitePaths(v, path ? `${path}.${k}` : k)
    );
  }
  return [];
}

// ---------------------------------------------------------------------------
// Store / engine readers
// ---------------------------------------------------------------------------

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const incomeDocs = (app: AppHandle) => app.store.__all<Doc>("income_sources");
export const ruleDocs = (app: AppHandle) => app.store.__all<Doc>("expense_rules");

/**
 * The default projection window for `today: 2026-01-15` is Nov 2025 .. Apr 2026, but its two
 * edges move by a day in non-UTC zones (UI-OBS-07: the window is built with toISOString()).
 * Specs are TZ-robust by looking only at this safe interior unless they pass their own clip.
 */
export const SAFE_WINDOW = { from: "2025-11-02", to: "2026-04-28" };

/** Scheduled dates (sorted) of every projection/stored row of one source, clipped to the safe window. */
export function engineDates(
  app: AppHandle,
  sourceId: string,
  clip: { from?: string; to?: string } = SAFE_WINDOW
): string[] {
  return app
    .financial()
    .transactions.filter((t) => t.sourceId === sourceId)
    .map((t) => t.scheduledDate)
    .filter((d) => (!clip.from || d >= clip.from) && (!clip.to || d <= clip.to))
    .sort();
}

export function engineRows(app: AppHandle, sourceId: string) {
  return app
    .financial()
    .transactions.filter((t) => t.sourceId === sourceId)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
}

// ---------------------------------------------------------------------------
// INCOME wizard
// ---------------------------------------------------------------------------

export interface IncomeSpec {
  type?: string; // card heading, default "Salary"
  name?: string;
  amount?: string;
  category?: string; // option text; default form value is "Salary"
  variable?: boolean;
  frequency?: string; // option text, e.g. "Weekly", "Bi-weekly (Every 2 weeks)"
  start?: string; // ISO
  dayOfWeek?: string; // option text, e.g. "Friday"
  dayOfMonth?: string;
  /** replace the default [15, 30] semi-monthly days */
  specificDays?: number[];
  end?: string; // ISO
  weekend?: "before" | "after" | "none";
  notes?: string;
}

const INCOME_WEEKEND_LABEL = {
  before: "Pay on Friday if weekend",
  after: "Pay on Monday if weekend",
  none: "No adjustment",
} as const;

export async function openIncomeForm(app: AppHandle) {
  await app.user.click(screen.getByRole("button", { name: /add income/i }));
  await screen.findByText("Select Income Type");
}

/** Walk the wizard to step 3 (Schedule Configuration) with every field of the spec applied. */
export async function fillIncomeToSchedule(app: AppHandle, spec: IncomeSpec = {}) {
  await openIncomeForm(app);
  await app.user.click(screen.getByRole("heading", { name: spec.type ?? "Salary" }));
  await next(app);
  await fill(app, /^Source Name/, spec.name ?? "Test Income");
  await fill(app, /^Amount/, spec.amount ?? "1000");
  if (spec.category) await pick(app, /^Category/, spec.category);
  if (spec.variable) await check(app, /Variable Amount/);
  await next(app);
  await screen.findByText("Schedule Configuration");
  await applyIncomeSchedule(app, spec);
}

export async function applyIncomeSchedule(app: AppHandle, spec: IncomeSpec) {
  if (spec.frequency) await pick(app, /^Frequency/, spec.frequency);
  if (spec.start) await setDate(app, /^Start Date/, spec.start);
  if (spec.dayOfWeek) await pick(app, /^Day of Week/, spec.dayOfWeek);
  if (spec.dayOfMonth !== undefined) await fill(app, /^Day of Month/, spec.dayOfMonth);
  if (spec.specificDays) {
    // clear the defaults through the chips' close icons, then add the requested days
    for (const chip of screen.queryAllByText(/^\d+(st|nd|rd|th)$/)) {
      // the ordinal is its own element (so its text is exactly "1st"); the remove icon is its sibling
      await app.user.click(within(chip.parentElement!).getByText("close"));
    }
    for (const day of spec.specificDays) {
      await app.user.type(screen.getByPlaceholderText("Day (1-31)"), String(day));
      await app.user.click(screen.getByRole("button", { name: "Add Date" }));
    }
  }
  if (spec.end) {
    await check(app, /Set End Date/);
    await setDate(app, /^End Date/, spec.end);
  }
  if (spec.weekend) await pick(app, /^Weekend Adjustment/, INCOME_WEEKEND_LABEL[spec.weekend]);
}

/** From step 3: Continue to review, optional notes, click Create; resolve the new document. */
export async function finishIncome(app: AppHandle, spec: IncomeSpec = {}): Promise<Doc> {
  const before = new Set(incomeDocs(app).map((d) => d.id));
  await next(app);
  await screen.findByText("Review & Confirm");
  if (spec.notes) await fill(app, /^Notes/, spec.notes);
  await app.user.click(screen.getByRole("button", { name: "Create Income Source" }));
  await waitFor(() => expect(incomeDocs(app).length).toBe(before.size + 1));
  const doc = incomeDocs(app).find((d) => !before.has(d.id))!;
  await waitFor(() => expect(app.financial().incomeSources.some((s) => s.id === doc.id)).toBe(true));
  await screen.findByRole("button", { name: /add income/i }); // wizard closed, list view back
  return doc;
}

export async function createIncome(app: AppHandle, spec: IncomeSpec = {}): Promise<Doc> {
  await fillIncomeToSchedule(app, spec);
  return finishIncome(app, spec);
}

// ---------------------------------------------------------------------------
// EXPENSE wizard
// ---------------------------------------------------------------------------

export type ExpenseKind =
  | "Fixed Recurring"
  | "Variable"
  | "Loan"
  | "Credit Card"
  | "Installment"
  | "One-time";

export interface ExpenseSpec {
  kind?: ExpenseKind;
  name?: string;
  amount?: string; // fixed / variable / one-time
  category?: string;
  priority?: boolean;
  // schedule
  frequency?: string; // option text: "Weekly", "Bi-weekly", "Semi-monthly", "Monthly", "Quarterly", "Yearly"
  start?: string; // ISO (First Payment Date / Date / Start Tracking From)
  dayOfWeek?: string;
  dayOfMonth?: string;
  specificDays?: number[];
  end?: string;
  weekend?: "before" | "after" | "none";
  notes?: string;
  // loan
  principal?: string;
  currentBalance?: string;
  rate?: string;
  term?: string;
  calcType?: string;
  // credit card
  limit?: string;
  balance?: string;
  apr?: string;
  minPercent?: string; // "" clears the field
  minFloor?: string; // "" clears the field
  minMethod?: string;
  statementDate?: string;
  dueDate?: string;
  strategy?: string; // "Minimum Payment" | "Fixed Amount" | "Pay Full Balance"
  fixedPayment?: string;
  // installment
  total?: string;
  count?: string;
  interest?: string; // rate text -> ticks "Has Interest"
}

const EXPENSE_WEEKEND_LABEL = INCOME_WEEKEND_LABEL;

export async function openExpenseForm(app: AppHandle) {
  await app.user.click(screen.getByRole("button", { name: /add expense/i }));
  await screen.findByText("Select Expense Type");
}

/** Walk to the last step that contains the schedule (Details -> Schedule) and apply the spec. */
export async function fillExpenseToSchedule(app: AppHandle, spec: ExpenseSpec = {}) {
  const kind = spec.kind ?? "Fixed Recurring";
  await openExpenseForm(app);
  await app.user.click(screen.getByRole("heading", { name: kind }));
  await next(app);
  await fillExpenseDetails(app, { ...spec, kind });
  if (kind === "One-time") return; // 2-step form: Details is the last step
  await next(app);
  await applyExpenseSchedule(app, { ...spec, kind });
}

export async function fillExpenseDetails(app: AppHandle, spec: ExpenseSpec) {
  const kind = spec.kind ?? "Fixed Recurring";
  if (spec.category) await pick(app, /^Category/, spec.category);
  if (kind === "Fixed Recurring" || kind === "Variable" || kind === "One-time") {
    await fill(app, /^Expense Name/, spec.name ?? "Test Expense");
    await fill(app, /^Amount/, spec.amount ?? "100");
    if (spec.priority) await check(app, /Priority Bill/);
    if (kind === "One-time" && spec.start) await setDate(app, /^Date/, spec.start);
  } else if (kind === "Loan") {
    await fill(app, /^Loan Name/, spec.name ?? "Test Loan");
    await fill(app, /^Original Principal/, spec.principal ?? "12000");
    if (spec.currentBalance !== undefined) await fill(app, /^Current Balance/, spec.currentBalance);
    await fill(app, /^Annual Interest Rate/, spec.rate ?? "12");
    await fill(app, /^Term \(Months\)/, spec.term ?? "24");
    if (spec.calcType) await pick(app, /^Calculation Type/, spec.calcType);
    // THE loan date is the First Payment Date (the old separate "Loan Start Date" field is gone)
    if (spec.start) await setDate(app, /^First Payment Date/, spec.start);
  } else if (kind === "Credit Card") {
    await fill(app, /^Credit Card Name/, spec.name ?? "Test Card");
    if (spec.limit !== undefined) await fill(app, /^Credit Limit/, spec.limit);
    await fill(app, /^Current Balance/, spec.balance ?? "5000");
    await fill(app, /^APR/, spec.apr ?? "12");
    if (spec.minPercent !== undefined) await fill(app, /^Minimum Payment %/, spec.minPercent);
    if (spec.minFloor !== undefined) await fill(app, /^Min Payment Floor/, spec.minFloor);
    if (spec.minMethod) await pick(app, /^Min Payment Calculation/, spec.minMethod);
    if (spec.statementDate !== undefined) await fill(app, /^Statement Date/, spec.statementDate);
    if (spec.dueDate !== undefined) await fill(app, /^Due Date/, spec.dueDate);
    if (spec.strategy) await pick(app, /^Payment Strategy/, spec.strategy);
    if (spec.fixedPayment !== undefined) await fill(app, /^Fixed Payment Amount/, spec.fixedPayment);
  } else if (kind === "Installment") {
    await fill(app, /^Item Name/, spec.name ?? "Test Plan");
    await fill(app, /^Total Amount/, spec.total ?? "1200");
    if (spec.count !== undefined) await fill(app, /^Number of Installments/, spec.count);
    if (spec.interest !== undefined) {
      await check(app, /Has Interest/);
      await fill(app, /^Interest Rate/, spec.interest);
    }
  }
}

export async function applyExpenseSchedule(app: AppHandle, spec: ExpenseSpec) {
  if (spec.frequency) await pick(app, /^Frequency/, spec.frequency);
  if (spec.start) {
    await setDate(app, /^(First Payment Date|Start Tracking From|Date)/, spec.start);
  }
  if (spec.dayOfWeek) await pick(app, /^Day of Week/, spec.dayOfWeek);
  if (spec.dayOfMonth !== undefined) await fill(app, /^Day of Month/, spec.dayOfMonth);
  if (spec.specificDays) {
    for (const chip of screen.queryAllByText(/^\d+(st|nd|rd|th)$/)) {
      // the ordinal is its own element (so its text is exactly "1st"); the remove icon is its sibling
      await app.user.click(within(chip.parentElement!).getByText("close"));
    }
    for (const day of spec.specificDays) {
      await app.user.type(screen.getByPlaceholderText("Day (1-31)"), String(day));
      await app.user.click(screen.getByRole("button", { name: "Add Date" }));
    }
  }
  if (spec.end) {
    await check(app, /Set End Date/);
    await setDate(app, /^End Date/, spec.end);
  }
  if (spec.weekend) await pick(app, /^Weekend Adjustment/, EXPENSE_WEEKEND_LABEL[spec.weekend]);
}

/** Click Create on whichever step is last (advancing through Continue on the way). */
export async function finishExpense(app: AppHandle, spec: ExpenseSpec = {}): Promise<Doc> {
  const before = new Set(ruleDocs(app).map((d) => d.id));
  // 4-step types need one more Continue to reach Review; 2/3-step forms already show Create.
  if (screen.queryByRole("button", { name: "Continue" })) {
    await next(app);
    await screen.findByText("Review & Confirm");
  }
  if (spec.notes) await fill(app, /^Notes/, spec.notes);
  await app.user.click(screen.getByRole("button", { name: "Create Expense" }));
  await waitFor(() => expect(ruleDocs(app).length).toBe(before.size + 1));
  const doc = ruleDocs(app).find((d) => !before.has(d.id))!;
  await waitFor(() => expect(app.financial().expenseRules.some((r) => r.id === doc.id)).toBe(true));
  await screen.findByRole("button", { name: /add expense/i }); // wizard closed, list view back
  return doc;
}

export async function createExpense(app: AppHandle, spec: ExpenseSpec = {}): Promise<Doc> {
  await fillExpenseToSchedule(app, spec);
  return finishExpense(app, spec);
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** On /income or /expenses: select the card by name and open its edit wizard. */
export async function openEdit(app: AppHandle, name: string) {
  await app.user.click(screen.getAllByText(name)[0]);
  await app.user.click(await screen.findByRole("button", { name: /edit/i }));
  await screen.findByRole("button", { name: /^(Back|Cancel)$/ });
}

/** Continue through every step and press the final Save Changes. */
export async function saveEdit(app: AppHandle) {
  for (let i = 0; i < 8 && !screen.queryByRole("button", { name: "Save Changes" }); i++) {
    await next(app);
    await app.settle(); // the wizard advances after an async validation
  }
  await app.user.click(await screen.findByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull());
  await app.settle();
}
