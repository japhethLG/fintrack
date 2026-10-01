/**
 * Shared kit for the transaction-lifecycle UI suite (tests/ui/lifecycle).
 *
 * Everything here drives the REAL UI (the Transactions list, its
 * TransactionModal, the manual-transaction form, the Calendar) and reads the
 * result back from (a) the in-memory Firestore, (b) the merged
 * `financial().transactions`, and (c) numbers the screen prints. No app
 * function is ever used to compute an expected value.
 */
import * as React from "react";
import { expect } from "vitest";
import {
  renderApp,
  screen,
  within,
  waitFor,
  act,
  moneyNear,
  moneyIn,
  type AppHandle,
  type AppSeed,
  type RenderAppOptions,
} from "../harness";
import type { ExpenseRule, IncomeSource, Transaction, UserProfile } from "@/lib/types";
import TransactionsManager from "@/components/pages/transactions/TransactionsManager";
import BalanceSection from "@/components/pages/settings/components/BalanceSection";

export type App = AppHandle;

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------

/** The real Transactions page plus the real Settings balance card (the app's own balance readout). */
export const TxAndBalance: React.FC = () => (
  <>
    <BalanceSection />
    <TransactionsManager />
  </>
);

export async function mountTx(seed: AppSeed, opts: Partial<RenderAppOptions> = {}): Promise<App> {
  return renderApp({ ui: <TxAndBalance />, today: "2026-01-15", seed, ...opts });
}

// ---------------------------------------------------------------------------
// Store readers (independent of app logic)
// ---------------------------------------------------------------------------

export const storedTxs = (app: App): Transaction[] => app.store.__all<Transaction>("transactions");
export const storedUser = (app: App): UserProfile =>
  app.store.__get<UserProfile>("users", "user-1") as UserProfile;
export const storedRule = (app: App, id: string): ExpenseRule =>
  app.store.__get<ExpenseRule>("expense_rules", id) as ExpenseRule;
export const storedIncome = (app: App, id: string): IncomeSource =>
  app.store.__get<IncomeSource>("income_sources", id) as IncomeSource;
export const balanceOf = (app: App): number => storedUser(app).currentBalance;
export const merged = (app: App): Transaction[] => app.financial().transactions;

/** Signed cash effect of one stored transaction if it is completed. */
export const signedIfCompleted = (t: Transaction): number => {
  if (t.status !== "completed") return 0;
  const amount = t.actualAmount ?? t.projectedAmount;
  return t.type === "income" ? amount : -amount;
};

/** initialBalance + sum of signed(completed) over the STORED collection. */
export const expectedBalanceFromStore = (app: App): number =>
  storedUser(app).initialBalance + storedTxs(app).reduce((s, t) => s + signedIfCompleted(t), 0);

export const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/** The balance the Settings card prints ("Current $x"), scoped to that card so the scan stays cheap. */
export const displayedBalance = (): number => {
  const card = screen.getByText("Current Balance").parentElement as HTMLElement;
  return moneyNear("Current", { within: card });
};

/**
 * Returns the list of violated invariants ([] = all hold).
 *   I1  stored currentBalance == initialBalance + sum(signed(completed stored))
 *   I2a every stored transaction appears exactly once in merged
 *   I2b merged ids are unique
 *   I2c no two merged rows share (sourceId, occurrenceId) — no duplicate occurrence
 *   I3  the balance printed by the Settings card equals the stored balance
 *   I3b the app's own "Balance mismatch detected" warning is absent
 */
export function invariantViolations(app: App): string[] {
  const out: string[] = [];
  const bal = balanceOf(app);
  const want = expectedBalanceFromStore(app);
  if (round2(bal) !== round2(want)) {
    out.push(`I1 stored currentBalance ${bal} != initialBalance + sum(completed) ${want}`);
  }

  const m = merged(app);
  const mergedIds = m.map((t) => t.id);
  if (new Set(mergedIds).size !== mergedIds.length) {
    out.push(`I2b merged ids not unique: ${mergedIds.join(", ")}`);
  }
  for (const s of storedTxs(app)) {
    const n = mergedIds.filter((id) => id === s.id).length;
    if (n !== 1) out.push(`I2a stored ${s.id} (${s.name}) appears ${n}x in merged`);
  }
  const occ = new Map<string, number>();
  for (const t of m) {
    if (t.sourceId && t.occurrenceId) {
      const k = `${t.sourceId}|${t.occurrenceId}`;
      occ.set(k, (occ.get(k) ?? 0) + 1);
    }
  }
  for (const [k, n] of occ) if (n > 1) out.push(`I2c occurrence ${k} appears ${n}x in merged`);

  try {
    const shown = displayedBalance();
    if (round2(shown) !== round2(bal)) out.push(`I3 screen shows ${shown}, stored ${bal}`);
  } catch (e) {
    out.push(`I3 could not read the displayed balance: ${(e as Error).message}`);
  }
  if (screen.queryByText(/Balance mismatch detected/)) {
    out.push("I3b app shows 'Balance mismatch detected'");
  }
  return out;
}

/** Assert invariants; on failure the message carries the gesture trace. */
export function expectInvariants(app: App, trace: string[] = []): void {
  const v = invariantViolations(app);
  expect(v, `invariants violated after: ${trace.join(" -> ") || "(initial)"}`).toEqual([]);
}

// ---------------------------------------------------------------------------
// List / row access
// ---------------------------------------------------------------------------

const listCard = (): HTMLElement => {
  // the Calendar sidebar also prints "Transactions (n)" in an <h4>; the list header is an <h3>
  const heading = screen
    .getAllByText(/^Transactions \(\d+\)$/)
    .find((el) => el.tagName === "H3") as HTMLElement;
  return heading.parentElement!.parentElement as HTMLElement;
};

/** The rendered TransactionRow elements, in DOM (= sorted) order. */
export const listRows = (): HTMLElement[] =>
  Array.from(listCard().querySelectorAll<HTMLElement>("div.cursor-pointer.border-b"));

/** DOM row index of a merged transaction (the list is `financial().transactions` sorted by date). */
export const rowIndexOf = (app: App, id: string): number => {
  const ordered = [...merged(app)].sort((a, b) =>
    (a.actualDate || a.scheduledDate).localeCompare(b.actualDate || b.scheduledDate)
  );
  return ordered.findIndex((t) => t.id === id);
};

export const rowFor = (app: App, id: string): HTMLElement => {
  const idx = rowIndexOf(app, id);
  expect(idx, `transaction ${id} is not in merged`).toBeGreaterThanOrEqual(0);
  const row = listRows()[idx];
  const t = merged(app).find((x) => x.id === id)!;
  expect(row, `row #${idx} for ${id}`).toBeTruthy();
  expect(row.textContent, `row #${idx} should be ${t.name}`).toContain(t.name);
  return row;
};

/** Money amounts printed in a row: [main amount, optional variance]. */
export const rowMoney = (app: App, id: string): number[] => moneyIn(rowFor(app, id));

/** Id of the merged transaction matching a predicate (must be unique). */
export const findTx = (app: App, pred: (t: Transaction) => boolean): Transaction => {
  const hits = merged(app).filter(pred);
  expect(hits, "expected exactly one matching merged transaction").toHaveLength(1);
  return hits[0];
};

export const nth = (app: App, name: string, n: number): Transaction => {
  const hits = merged(app).filter((t) => t.name === name);
  expect(hits.length, `merged has ${hits.length} rows named ${name}`).toBeGreaterThan(n);
  return hits[n];
};

// ---------------------------------------------------------------------------
// Modal driving
// ---------------------------------------------------------------------------

const closeAfter = async (app: App) => {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await app.settle();
};

export async function openTx(app: App, id: string): Promise<HTMLElement> {
  await app.user.click(rowFor(app, id));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByRole("button", { name: "Cancel" });
  return dialog;
}

const clearAndType = async (app: App, el: HTMLElement, text: string) => {
  await app.user.clear(el);
  if (text !== "") await app.user.type(el, text);
};

/** Type a date into the antd picker input (Tab commits; Enter would submit the form). */
export async function typeDate(app: App, dialog: HTMLElement, label: RegExp, iso: string) {
  const input = within(dialog).getByLabelText(label);
  await app.user.click(input);
  await app.user.clear(input);
  await app.user.type(input, iso);
  await app.user.tab();
  expect((input as HTMLInputElement).value).toBe(iso);
}

export interface CompleteOpts {
  amount?: number;
  date?: string;
  notes?: string;
}

export async function setCompleteFields(app: App, dialog: HTMLElement, o: CompleteOpts) {
  if (o.amount !== undefined) {
    await clearAndType(app, within(dialog).getByLabelText(/Actual Amount/), String(o.amount));
  }
  if (o.date !== undefined) await typeDate(app, dialog, /Actual Date/, o.date);
  if (o.notes !== undefined) {
    await clearAndType(app, within(dialog).getByLabelText(/Notes/), o.notes);
  }
}

/** Open the row, choose Complete, optionally change amount/date/notes, submit. */
export async function completeTx(app: App, id: string, o: CompleteOpts = {}) {
  const dialog = await openTx(app, id);
  await app.user.click(within(dialog).getByRole("button", { name: /^check_circleComplete$/ }));
  await setCompleteFields(app, dialog, o);
  await app.user.click(within(dialog).getByRole("button", { name: "Mark Complete" }));
  await closeAfter(app);
}

export async function skipTx(app: App, id: string, notes?: string) {
  const dialog = await openTx(app, id);
  await app.user.click(within(dialog).getByRole("button", { name: /^skip_nextSkip$/ }));
  if (notes !== undefined) {
    await clearAndType(app, within(dialog).getByLabelText(/Notes/), notes);
  }
  await app.user.click(within(dialog).getByRole("button", { name: "Skip Transaction" }));
  await closeAfter(app);
}

export async function revertTx(app: App, id: string) {
  const dialog = await openTx(app, id);
  await app.user.click(within(dialog).getByRole("button", { name: /^undoRevert$/ }));
  await app.user.click(within(dialog).getByRole("button", { name: "Revert to Projected" }));
  await closeAfter(app);
}

/** Manual only: the modal's own Delete link, then confirm with the submit button. */
export async function deleteManualViaModal(app: App, id: string) {
  const dialog = await openTx(app, id);
  await app.user.click(within(dialog).getByRole("button", { name: /^deleteDelete$/ }));
  await app.user.click(within(dialog).getByRole("button", { name: "Delete Transaction" }));
  await closeAfter(app);
}

// ---------------------------------------------------------------------------
// Manual transaction form (create / edit)
// ---------------------------------------------------------------------------

export interface ManualFormOpts {
  name?: string;
  type?: "income" | "expense";
  amount?: number;
  date?: string;
  status?: "projected" | "completed" | "skipped";
  notes?: string;
}

const chooseOption = async (app: App, dialog: HTMLElement, triggerId: string, optionLabel: RegExp) => {
  const trigger = dialog.querySelector<HTMLElement>(`#${triggerId}`);
  expect(trigger, `select #${triggerId}`).toBeTruthy();
  await app.user.click(trigger!);
  const option = await screen.findByRole("option", { name: optionLabel });
  await app.user.click(option);
};

export async function fillManualForm(app: App, dialog: HTMLElement, o: ManualFormOpts) {
  if (o.name !== undefined) await clearAndType(app, within(dialog).getByLabelText(/^Name/), o.name);
  if (o.type !== undefined) {
    await chooseOption(app, dialog, "type", o.type === "income" ? /^Income$/ : /^Expense$/);
  }
  if (o.amount !== undefined) {
    await clearAndType(app, within(dialog).getByLabelText(/^Amount/), String(o.amount));
  }
  if (o.date !== undefined) {
    const d = within(dialog).getByLabelText(/^Date/);
    await clearAndType(app, d, o.date);
  }
  if (o.status !== undefined) {
    const label = { projected: /^Projected/, completed: /^Completed/, skipped: /^Skipped/ }[o.status];
    await chooseOption(app, dialog, "status", label);
  }
  if (o.notes !== undefined) {
    await clearAndType(app, within(dialog).getByLabelText(/^Notes/), o.notes);
  }
}

/** Transactions page -> "Add Transaction" -> fill -> "Create Transaction". */
export async function addManual(app: App, o: ManualFormOpts & { name: string; amount: number }) {
  await app.user.click(screen.getByRole("button", { name: /add transaction/i }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByLabelText(/^Name/);
  await fillManualForm(app, dialog, o);
  await app.user.click(within(dialog).getByRole("button", { name: "Create Transaction" }));
  await closeAfter(app);
}

/** Row -> modal "Edit" -> manual form -> "Save Changes". */
export async function editManual(app: App, id: string, o: ManualFormOpts) {
  const dlg = await openTx(app, id);
  await app.user.click(within(dlg).getByRole("button", { name: /^editEdit$/ }));
  await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByLabelText(/^Name/);
  await fillManualForm(app, dialog, o);
  await app.user.click(within(dialog).getByRole("button", { name: "Save Changes" }));
  await closeAfter(app);
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** One-shot flush of pending work after a direct store manipulation. */
export const flush = async (app: App) => {
  await act(async () => {
    app.store.__notify();
  });
  await app.settle();
};

// ---------------------------------------------------------------------------
// Calendar host + drag-to-reschedule
// ---------------------------------------------------------------------------

import CalendarView from "@/components/pages/calendar/CalendarView";
import { fireEvent } from "../harness";

/** Balance card + the real Calendar + the real Transactions list, all on one context. */
export const TxCalBalance: React.FC = () => (
  <>
    <BalanceSection />
    <CalendarView />
    <TransactionsManager />
  </>
);

export async function mountAll(seed: AppSeed, opts: Partial<RenderAppOptions> = {}): Promise<App> {
  return renderApp({ ui: <TxCalBalance />, today: "2026-01-15", seed, ...opts });
}

const calendarCells = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>("div.min-h-\\[100px\\]"));

const rect = (l: number, t: number, w: number, h: number): DOMRect =>
  ({ x: l, y: t, left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, toJSON() {} }) as DOMRect;

/** The calendar cell (current month grid) that renders day-of-month `day` of the displayed month. */
const cellForDay = (cells: HTMLElement[], day: number, inMonth: boolean): HTMLElement => {
  const hit = cells.find(
    (c) =>
      c.querySelector("span")?.textContent === String(day) &&
      (c.className.includes("opacity-50") ? !inMonth : inMonth)
  );
  expect(hit, `calendar cell for day ${day}`).toBeTruthy();
  return hit as HTMLElement;
};

/**
 * Drag the transaction's calendar chip onto the cell of `toIso` (must be visible in the
 * displayed month grid). jsdom has no layout, so every cell gets a synthetic 100x100 rect and
 * the drag overlay a 40x20 one; dnd-kit's rect-intersection then resolves the target exactly.
 * @param displayedMonth "YYYY-MM" the grid is showing
 */
export async function dragToDate(app: App, txId: string, toIso: string, displayedMonth = "2026-01") {
  const t = merged(app).find((x) => x.id === txId);
  expect(t, `merged tx ${txId}`).toBeTruthy();
  const ownIso = t!.actualDate || t!.scheduledDate;
  // D5 (docs/audit/fixes/display-numbers.md): a COMPLETED row dated after today was paid ahead of its
  // date; the calendar files it on the day it was paid, i.e. today.
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const fromIso = t!.status === "completed" && ownIso > todayIso ? todayIso : ownIso;
  const cells = calendarCells();
  expect(cells).toHaveLength(42);
  cells.forEach((c, i) => {
    const col = i % 7;
    const row = Math.floor(i / 7);
    c.getBoundingClientRect = () => rect(col * 100, 1000 + row * 100, 100, 100);
  });
  const inMonth = (iso: string) => iso.startsWith(displayedMonth);
  const fromCell = cellForDay(cells, Number(fromIso.slice(8, 10)), inMonth(fromIso));
  const toCell = cellForDay(cells, Number(toIso.slice(8, 10)), inMonth(toIso));
  const chips = Array.from(
    fromCell.querySelectorAll<HTMLElement>("[aria-roledescription='draggable']")
  ).filter((c) => c.textContent === t!.name);
  expect(chips.length, `chip for ${t!.name} on ${fromIso}`).toBeGreaterThan(0);
  const chip = chips[0];
  chip.getBoundingClientRect = () => rect(0, 0, 60, 20);

  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.classList?.contains("drop-shadow-lg")) return rect(0, 0, 40, 20);
    return original.call(this);
  };
  try {
    const to = toCell.getBoundingClientRect();
    const endX = 5 + to.left + 30;
    const endY = 5 + to.top + 40;
    await act(async () => {
      fireEvent.mouseDown(chip, { clientX: 5, clientY: 5, button: 0 });
    });
    await act(async () => {
      fireEvent.mouseMove(document, { clientX: 20, clientY: 20 });
    });
    await act(async () => {
      fireEvent.mouseMove(document, { clientX: endX, clientY: endY });
    });
    await app.advance(600);
    await act(async () => {
      fireEvent.mouseMove(document, { clientX: endX + 1, clientY: endY + 1 });
    });
    await app.advance(100);
    await act(async () => {
      fireEvent.mouseUp(document, { clientX: endX + 1, clientY: endY + 1 });
    });
    await app.advance(100);
    await app.settle();
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
}

// ---------------------------------------------------------------------------
// Debt-progress helpers
// ---------------------------------------------------------------------------

/** "(#3)" printed next to a row's name, or null when the row shows no payment number. */
export const paymentNo = (app: App, id: string): number | null => {
  const m = /\(#(\d+)\)/.exec(rowFor(app, id).textContent ?? "");
  return m ? Number(m[1]) : null;
};

/** Click the Calendar's "previous month" chevron n times (also widens the projection window). */
export async function calendarPrevMonth(app: App, n = 1) {
  for (let i = 0; i < n; i += 1) {
    const btn = screen.getAllByRole("button").find((b) => b.textContent === "chevron_left");
    expect(btn, "calendar previous-month button").toBeTruthy();
    await app.user.click(btn!);
    await app.settle();
  }
}

/** Independent amortization: level payment for principal P over n months at apr% (own PMT formula). */
export function amortize(P: number, aprPct: number, n: number) {
  const r = aprPct / 100 / 12;
  const pmt = r === 0 ? P / n : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const rows: { payment: number; interest: number; principal: number; balance: number }[] = [];
  let bal = P;
  for (let i = 0; i < n; i += 1) {
    const interest = bal * r;
    let principal = pmt - interest;
    let payment = pmt;
    if (i === n - 1) {
      principal = bal;
      payment = bal + interest;
    }
    bal -= principal;
    rows.push({ payment, interest, principal, balance: bal });
  }
  return { pmt, rows };
}

// ---------------------------------------------------------------------------
// Calendar readers
// ---------------------------------------------------------------------------

/** The in-month cell for a day-of-month of the displayed month. */
export const dayCell = (day: number): HTMLElement => cellForDay(calendarCells(), day, true);

/** Names of the draggable chips rendered inside a day's cell. */
export const chipNamesOnDay = (day: number): string[] =>
  Array.from(dayCell(day).querySelectorAll<HTMLElement>("[aria-roledescription='draggable']")).map(
    (c) => c.textContent ?? ""
  );

/** Click a day cell (selects it: the sidebar then lists that day's transactions). */
export async function selectDay(app: App, day: number) {
  await app.user.click(dayCell(day));
  await app.settle();
}

/** The Calendar sidebar's "Transactions (n)" panel text (h4 + its list). */
export const sidebarPanel = (): HTMLElement => {
  const h4 = screen
    .getAllByText(/^Transactions \(\d+\)$/)
    .find((el) => el.tagName === "H4") as HTMLElement;
  return h4.parentElement as HTMLElement;
};
