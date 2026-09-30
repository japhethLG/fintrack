/**
 * Screen-reading helpers for the displayed-numbers suite.
 *
 * Everything here reads what a USER can see (text in the DOM) and parses it
 * with the harness's independent money parser. Nothing imports the app's
 * formatter or calculators.
 */
import * as React from "react";
import { vi } from "vitest";
import {
  renderApp,
  resolveNow,
  screen,
  within,
  moneyNear,
  moneyIn,
  spacedText,
  type AppHandle,
  type RenderAppOptions,
} from "../harness";

export type PageName = "dashboard" | "calendar" | "forecast" | "income" | "expenses";

const LOADERS: Record<PageName, () => Promise<{ default: React.ComponentType }>> = {
  dashboard: () => import("@/(protected)/dashboard/page"),
  calendar: () => import("@/(protected)/calendar/page"),
  forecast: () => import("@/(protected)/forecast/page"),
  income: () => import("@/(protected)/income/page"),
  expenses: () => import("@/(protected)/expenses/page"),
};

export interface Pages {
  app: AppHandle;
  /** The `<section>` that wraps one page, for `within()` scoping. */
  page: (name: PageName) => HTMLElement;
}

/**
 * Mount several REAL pages side by side under ONE set of providers (one shared
 * FinancialContext), each in its own `<section data-page>`. Lets a single test
 * compare what different screens show for the same household, and watch them
 * all react to one mutation.
 */
export async function renderPages(
  names: PageName[],
  options: Omit<RenderAppOptions, "ui" | "route"> = {}
): Promise<Pages> {
  // Page modules build date presets (dayjs()) at import time. Import them under the test's clock,
  // not the wall clock (renderApp only fakes time AFTER we hand it the tree).
  if (options.timeZone) process.env.TZ = options.timeZone;
  vi.useFakeTimers({ now: resolveNow(options.today), toFake: ["Date"] });
  const comps = await Promise.all(names.map(async (n) => (await LOADERS[n]()).default));
  const ui = React.createElement(
    React.Fragment,
    null,
    ...names.map((n, i) =>
      React.createElement("section", { key: n, "data-page": n }, React.createElement(comps[i]))
    )
  );
  const app = await renderApp({ ...options, ui });
  const page = (n: PageName): HTMLElement => {
    const el = document.querySelector<HTMLElement>(`[data-page="${n}"]`);
    if (!el) throw new Error(`page section ${n} not mounted`);
    return el;
  };
  return { app, page };
}

const ownText = (el: Element): string =>
  Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? "")
    .join("")
    .trim();

/** The Card (`.rounded-2xl`) whose own-text heading matches. Throws when absent. */
export function card(root: HTMLElement, heading: string | RegExp): HTMLElement {
  const ok = (t: string) => (typeof heading === "string" ? t === heading : heading.test(t));
  const hit = Array.from(root.querySelectorAll<HTMLElement>("*")).find((el) => {
    const t = ownText(el);
    return t !== "" && ok(t);
  });
  if (!hit) throw new Error(`card: no element with own text ${String(heading)}`);
  const c = hit.closest<HTMLElement>(".rounded-2xl");
  if (!c) throw new Error(`card: ${String(heading)} is not inside a Card`);
  return c;
}

/** Amount that follows `label` inside `root`. Thin wrapper so specs read as prose. */
export const money = (
  root: HTMLElement,
  label: string | RegExp,
  opts: { index?: number; occurrence?: number } = {}
): number => moneyNear(label, { within: root, ...opts });

/** Like `money`, but returns null (instead of throwing) when no amount is printed, e.g. '—'. */
export const moneyOrNull = (
  root: HTMLElement,
  label: string | RegExp,
  opts: { index?: number; occurrence?: number } = {}
): number | null => {
  try {
    return moneyNear(label, { within: root, ...opts });
  } catch {
    return null;
  }
};

/** Every amount inside an element, in reading order. */
export const amounts = (el: HTMLElement): number[] => moneyIn(el);

/** The "NN/100" figure that follows a health-score label ("Cash Runway" ...). */
export function healthComponent(healthCard: HTMLElement, label: string): number {
  const el = Array.from(healthCard.querySelectorAll<HTMLElement>("span")).find(
    (s) => ownText(s) === label
  );
  if (!el) throw new Error(`health component ${label} not found`);
  const m = /(\d+)\/100/.exec(el.parentElement?.textContent ?? "");
  if (!m) throw new Error(`no NN/100 next to ${label}`);
  return Number(m[1]);
}

/** Overall health score from the big "96/100". */
export function healthScore(healthCard: HTMLElement): { score: number; grade: string } {
  const h2 = healthCard.querySelector("h2");
  const m = /^(\d+)\/100$/.exec(h2?.textContent ?? "");
  if (!m) throw new Error(`health score heading not parsable: ${h2?.textContent}`);
  const g = /Grade ([A-F])/.exec(healthCard.textContent ?? "");
  return { score: Number(m[1]), grade: g ? g[1] : "?" };
}

/** Balance printed in a month-grid day cell (absolute value: the cell prints Math.abs). */
export function dayCell(root: HTMLElement, day: number): HTMLElement {
  const cells = Array.from(root.querySelectorAll<HTMLElement>('[class*="min-h-[100px]"]')).filter(
    (c) => !c.className.includes("opacity-50")
  );
  const hit = cells.find((c) => c.querySelector("span")?.textContent === String(day));
  if (!hit) throw new Error(`calendar day cell ${day} not found`);
  return hit;
}

/** The first money amount printed in a day cell (its balance chip). */
export function dayCellBalance(root: HTMLElement, day: number): number {
  const values = moneyIn(dayCell(root, day));
  if (values.length === 0) throw new Error(`day ${day} shows no balance`);
  return values[0];
}

/** Text of the chip that carries the day's balance (used to inspect sign / symbol). */
export function dayCellBalanceText(root: HTMLElement, day: number): string {
  const cell = dayCell(root, day);
  const chip = Array.from(cell.querySelectorAll<HTMLElement>("span")).find(
    (s) => /\d/.test(s.textContent ?? "") && s.textContent !== String(day)
  );
  if (!chip) throw new Error(`day ${day} has no balance chip`);
  return spacedText(chip);
}

/** Row of a Bill-coverage list (Dashboard "Bills" tab) by bill name. */
export function billRow(root: HTMLElement, name: string): { text: string; covered: boolean; need?: number } {
  let el: HTMLElement | null = within(root).getByText(name);
  while (el && !/Covered|Need/.test(el.textContent ?? "")) el = el.parentElement;
  if (!el) throw new Error(`bill row for ${name} not found`);
  const text = spacedText(el);
  const covered = /Covered/.test(text);
  const need = /Need\s*\$?\s*([\d,]+(?:\.\d+)?)/.exec(text);
  return { text, covered, need: need ? Number(need[1].replace(/,/g, "")) : undefined };
}

/** Switch the Dashboard "Upcoming Activity" widget to a tab. */
export async function openTab(app: AppHandle, root: HTMLElement, name: RegExp): Promise<void> {
  await app.user.click(within(root).getByRole("tab", { name }));
}

export { screen, within };

/** Text of the element right after the one whose own text is `label` (stat cards: label then value). */
export function stat(root: HTMLElement, label: string): string {
  const el = Array.from(root.querySelectorAll<HTMLElement>("*")).find((e) => ownText(e) === label);
  if (!el) throw new Error(`stat: no element with own text ${label}`);
  const next = el.nextElementSibling;
  if (!next) throw new Error(`stat: ${label} has no following sibling`);
  return spacedText(next);
}

/** The semantic colour token on an element or its nearest coloured ancestor. */
export function colorToken(el: Element): string {
  let cursor: Element | null = el;
  while (cursor) {
    const m = /text-(success|danger|warning|primary|white|gray-\d+)/.exec(cursor.getAttribute("class") ?? "");
    if (m) return m[1];
    cursor = cursor.parentElement;
  }
  return "none";
}

/**
 * The change chip (arrow + percent) next to a Period Comparison row label.
 * Returns the rendered text ("arrow_downward 13.9 %"), the arrow and the colour.
 */
export function changeChip(
  pc: HTMLElement,
  label: string
): { text: string; arrow: "up" | "down" | "none"; color: string; percent: number | null } {
  const el = Array.from(pc.querySelectorAll<HTMLElement>("span")).find((e) => ownText(e) === label);
  if (!el) throw new Error(`changeChip: row ${label} not found`);
  const chip = el.nextElementSibling as HTMLElement | null;
  if (!chip) throw new Error(`changeChip: ${label} has no chip`);
  const text = spacedText(chip);
  const arrow = /arrow_upward/.test(text) ? "up" : /arrow_downward/.test(text) ? "down" : "none";
  const m = /([\d.]+)\s*%/.exec(text);
  return { text, arrow, color: colorToken(chip), percent: m ? Number(m[1]) : null };
}

/** Labels printed on a recharts Y axis inside `root`. */
export function yAxisLabels(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<SVGTextElement>("text.recharts-cartesian-axis-tick-value")).map((t) =>
    (t.textContent ?? "").trim()
  );
}
