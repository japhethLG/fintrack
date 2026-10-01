/**
 * Helpers private to the calendar/transactions E2E specs. Pure UI driving and
 * hand-rolled date arithmetic — nothing here imports app logic, and nothing
 * asserts product behaviour except the small `expect`-based waits.
 */
import type { Locator, Page } from "@playwright/test";
import { COLLECTIONS, expect, readCollection } from "../../index";

// ---------------------------------------------------------------------------
// Date arithmetic on YYYY-MM-DD strings (UTC maths => timezone independent)
// ---------------------------------------------------------------------------

export const addDaysISO = (iso: string, n: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
export const dowOf = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
export const dayDiff = (later: string, earlier: string): number => {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(later) - p(earlier)) / 86_400_000);
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthHeading = (viewMonth: string): string => {
  const [y, m] = viewMonth.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

// ---------------------------------------------------------------------------
// Calendar page
// ---------------------------------------------------------------------------

/** Day cells of the month grid (42) or week grid (7): the only `.grid-cols-7` children that are clickable. */
export const gridCells = (page: Page): Locator => page.locator("div.grid-cols-7 > div.cursor-pointer");

/** Cell for `date` in the MONTH view currently showing `viewMonth` (YYYY-MM). Grid starts on Sunday. */
export const monthCell = (page: Page, viewMonth: string, date: string): Locator => {
  const first = `${viewMonth}-01`;
  const gridStart = addDaysISO(first, -dowOf(first));
  const idx = dayDiff(date, gridStart);
  if (idx < 0 || idx > 41) throw new Error(`${date} is not on the ${viewMonth} grid`);
  return gridCells(page).nth(idx);
};

/** Cell for `date` in the WEEK view (Sunday first). */
export const weekCell = (page: Page, date: string): Locator => gridCells(page).nth(dowOf(date));

/** Select a day by clicking the empty top-left corner of its cell (the centre is often a chip). */
export const selectDay = async (cell: Locator): Promise<void> => {
  await cell.click({ position: { x: 8, y: 8 } });
};

export const sidebar = (page: Page): Locator => page.locator("div.sticky");

export const viewedHeading = (page: Page): Locator => page.getByRole("heading", { level: 2 }).first();

export const nextButton = (page: Page): Locator => page.getByRole("button", { name: "chevron_right" });
export const prevButton = (page: Page): Locator => page.getByRole("button", { name: "chevron_left" });

/** Click next/prev until the heading shows `viewMonth`; `from` is the month currently shown. */
export const navigateToMonth = async (page: Page, from: string, to: string): Promise<void> => {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  let delta = (ty - fy) * 12 + (tm - fm);
  const btn = delta >= 0 ? nextButton(page) : prevButton(page);
  while (delta !== 0) {
    await btn.click();
    delta += delta > 0 ? -1 : 1;
  }
  await expect(viewedHeading(page)).toHaveText(monthHeading(to));
};

/** Names of the chips shown in a MONTH-view cell (first two only; the rest are "+N more"). */
export const monthChipNames = async (cell: Locator): Promise<string[]> =>
  (await cell.locator("div.truncate").allInnerTexts()).map((s) => s.trim());

/** Names of the chips shown in a WEEK-view cell. */
export const weekChipNames = async (cell: Locator): Promise<string[]> =>
  (await cell.locator("span.truncate").allInnerTexts()).map((s) => s.trim());

/** The 4 tiles of the month summary: "Income" | "Expenses" | "Net Change" | "Transactions". */
export const summaryTile = (page: Page, label: "Income" | "Expenses" | "Net Change" | "Transactions"): Locator =>
  page
    .locator("div.grid.grid-cols-2")
    .first()
    .locator("p", { hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::p[1]");

/** Opening / Closing figure in the "Balance Overview" card. */
export const periodFigure = (page: Page, which: "Opening" | "Closing"): Locator =>
  page
    .locator("span", { hasText: new RegExp(`^${which}$`) })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'p-4')][1]")
    .locator("p.text-2xl");

/** Parse "$1,234", "-$50", "+$300", "−$5" ... into a number. */
export const money = (text: string | null): number => {
  if (text === null) return NaN;
  const t = text.replace(/\s/g, "");
  const neg = /^[-−–]/.test(t) || /^\(/.test(t) || /^[+]?[-−]\$/.test(t);
  const n = Number(t.replace(/[^0-9.]/g, ""));
  return neg ? -n : n;
};

// ---------------------------------------------------------------------------
// Drag and drop (dnd-kit MouseSensor: needs > 8px travel before it activates)
// ---------------------------------------------------------------------------

/** The floating copy dnd-kit renders while dragging (the app gives it a fixed 221px width). */
export const dragOverlay = (page: Page): Locator => page.locator("div.drop-shadow-lg");

/**
 * Drag `source` and drop it on `target`.
 *  - "pointer" (default): the pointer itself is placed on the target cell centre (what a person actually
 *    does). The calendar picks the cell under the pointer (E2E-CAL-03, fixed).
 *  - "overlay": the pointer is placed so that the CENTRE OF THE FLOATING OVERLAY is over the centre of the
 *    target cell. Kept for tests that need the overlay, not the pointer, over a cell.
 */
export const dragTo = async (
  page: Page,
  source: Locator,
  target: Locator,
  mode: "overlay" | "pointer" = "pointer"
): Promise<void> => {
  await source.scrollIntoViewIfNeeded();
  const s = await source.boundingBox();
  if (!s) throw new Error("drag source has no box");
  let px = s.x + s.width / 2;
  let py = s.y + s.height / 2;
  await page.mouse.move(px, py);
  await page.mouse.down();
  px += 14;
  py += 14;
  await page.mouse.move(px, py, { steps: 4 });
  const overlay = dragOverlay(page);
  await expect(overlay).toBeVisible();
  const t = await target.boundingBox();
  if (!t) throw new Error("drag target has no box");
  const tx = t.x + t.width / 2;
  const ty = t.y + t.height / 2;
  if (mode === "pointer") {
    await page.mouse.move(tx, ty, { steps: 16 });
  } else {
    const o = (await overlay.boundingBox())!;
    await page.mouse.move(px + (tx - (o.x + o.width / 2)), py + (ty - (o.y + o.height / 2)), { steps: 16 });
  }
  await page.mouse.up();
};

// ---------------------------------------------------------------------------
// Store readers
// ---------------------------------------------------------------------------


export interface StoredOverrides {
  [occurrenceId: string]: { scheduledDate?: string; amount?: number; skipped?: boolean; notes?: string };
}

export const overridesOf = async (page: Page, collection: "income_sources" | "expense_rules", id: string): Promise<StoredOverrides | undefined> => {
  const docs = await readCollection<{ id: string; occurrenceOverrides?: StoredOverrides }>(page, collection);
  return docs.find((d) => d.id === id)?.occurrenceOverrides;
};

export interface StoredTxn {
  id: string;
  name: string;
  status: string;
  sourceType: string;
  sourceId?: string;
  occurrenceId?: string;
  scheduledDate: string;
  actualDate?: string;
  projectedAmount: number;
  actualAmount?: number;
  type: string;
  notes?: string;
}
export const storedTxns = (page: Page): Promise<StoredTxn[]> => readCollection<StoredTxn>(page, COLLECTIONS.transactions);

export const userBalance = async (page: Page): Promise<number> => {
  const users = await readCollection<{ currentBalance: number }>(page, COLLECTIONS.users);
  return users[0].currentBalance;
};

// ---------------------------------------------------------------------------
// Transaction modal
// ---------------------------------------------------------------------------

export const txnDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Transaction" });

export const openTxnFromCell = async (page: Page, cell: Locator, name: string): Promise<Locator> => {
  await cell.getByText(name, { exact: true }).first().click();
  const d = txnDialog(page);
  await expect(d).toBeVisible();
  return d;
};

/**
 * Complete the open transaction. Paying ahead of the date defaults Actual Date to today (MANUAL-k), so a
 * test about WHICH occurrence gets completed passes `actualDate` (YYYY-MM-DD) to say it was paid on its day.
 */
export const completeInDialog = async (page: Page, o: { amount?: number; actualDate?: string } = {}): Promise<void> => {
  const d = txnDialog(page);
  if (o.amount !== undefined) await d.getByLabel("Actual Amount").fill(String(o.amount));
  if (o.actualDate !== undefined) {
    const field = d.locator("#actualDate");
    await field.click();
    await field.press("Control+a");
    await field.pressSequentially(o.actualDate);
    // typed text is only committed when a day is picked: pick it in the open panel (cells carry the date as title)
    await page.locator(`.ant-picker-dropdown:not(.ant-picker-dropdown-hidden) td[title="${o.actualDate}"]`).click();
    await expect(field).toHaveValue(o.actualDate);
  }
  await d.getByRole("button", { name: "Mark Complete" }).click();
  await expect(d).toBeHidden();
};

export const revertInDialog = async (page: Page): Promise<void> => {
  const d = txnDialog(page);
  await d.getByRole("button", { name: /Revert$/ }).click();
  await d.getByRole("button", { name: "Revert to Projected" }).click();
  await expect(d).toBeHidden();
};

export const skipInDialog = async (page: Page): Promise<void> => {
  const d = txnDialog(page);
  await d.getByRole("button", { name: /Skip$/ }).first().click();
  await d.getByRole("button", { name: "Skip Transaction" }).click();
  await expect(d).toBeHidden();
};

/** Dates (YYYY-MM-DD) on which a chip named `name` is drawn in the MONTH grid, one entry per chip. */
export const daysShowing = async (page: Page, viewMonth: string, name: string): Promise<string[]> => {
  const out: string[] = [];
  const count = await gridCells(page).count();
  const first = `${viewMonth}-01`;
  for (let i = 0; i < count; i++) {
    const n = await gridCells(page).nth(i).getByText(name, { exact: true }).count();
    const d = addDaysISO(first, i - dowOf(first));
    for (let k = 0; k < n; k++) out.push(d);
  }
  return out;
};

/** "Transactions (N)" heading count in the day sidebar. */
export const sidebarCount = async (page: Page): Promise<number> => {
  const t = await sidebar(page).getByRole("heading", { level: 4 }).innerText();
  return Number(/\((\d+)\)/.exec(t)![1]);
};
export const sidebarRows = (page: Page): Locator => sidebar(page).locator("div.cursor-grab");
