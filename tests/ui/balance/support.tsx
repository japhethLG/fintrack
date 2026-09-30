/**
 * Local helpers for the balance-ownership / settings / auth-lifecycle specs.
 *
 * Nothing here calls app code to derive an expected value: the invariant takes
 * hand-computed numbers from the test, and every figure is read off the screen
 * with the harness' independent money parser.
 */
import * as React from "react";
import { expect } from "vitest";
import { act } from "@testing-library/react";
import { Settings } from "@/components/pages/settings";
import { Dashboard } from "@/components/pages/dashboard";
import { CalendarView } from "@/components/pages/calendar";
import { Forecast } from "@/components/pages/forecast";
import {
  screen,
  within,
  waitFor,
  moneyNear,
  moneyIn,
  spacedText,
  type AppHandle,
} from "../harness";
import type { Transaction } from "@/lib/types";

export type App = AppHandle;

export type ScreenName = "settings" | "dashboard" | "calendar" | "forecast";

/**
 * Screens that print a balance, mounted side by side inside ONE real provider
 * tree (every screen subscribes to the same live state, exactly as it would
 * after navigating between routes). `only` trims the set for speed.
 */
export const Screens: React.FC<{ only?: ScreenName[] }> = ({
  only = ["settings", "dashboard", "calendar", "forecast"],
}) => (
  <>
    {only.includes("settings") && (
      <section data-screen="settings">
        <Settings />
      </section>
    )}
    {only.includes("dashboard") && (
      <section data-screen="dashboard">
        <Dashboard />
      </section>
    )}
    {only.includes("calendar") && (
      <section data-screen="calendar">
        <CalendarView />
      </section>
    )}
    {only.includes("forecast") && (
      <section data-screen="forecast">
        <Forecast />
      </section>
    )}
  </>
);
export const AllScreens = Screens;

export const screenEl = (name: ScreenName): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-screen="${name}"]`);
  // a spec that rendered the /settings ROUTE (not <Screens>) has only that one page on screen
  if (!el && name === "settings") return document.body;
  if (!el) throw new Error(`screen ${name} is not mounted`);
  return el;
};
const isMounted = (name: ScreenName): boolean =>
  document.querySelector(`[data-screen="${name}"]`) !== null;

// ---------------------------------------------------------------------------
// Reading balances off the screen
// ---------------------------------------------------------------------------

export const settingsCurrent = (root: HTMLElement = document.body): number =>
  moneyNear("Current", { within: root });
export const settingsComputed = (root: HTMLElement = document.body): number =>
  moneyNear(/^Computed from \d+ transactions?$/, { within: root });
export const settingsInitial = (root: HTMLElement = document.body): number =>
  moneyNear("Starting Balance (Baseline)", { within: root });
export const settingsComputedCount = (root: HTMLElement = document.body): number => {
  const el = within(root).getByText(/^Computed from \d+ transactions?$/);
  return Number(/(\d+)/.exec(el.textContent ?? "")![1]);
};

/** The amount quoted by the "Balance mismatch detected" banner, or null when it is absent. */
export const mismatchBanner = (root: HTMLElement = document.body): number | null => {
  const el = within(root).queryByText(/Balance mismatch detected/);
  if (!el) return null;
  return moneyIn(el)[0];
};

export const dashboardCurrent = (): number =>
  moneyNear("Current Balance", { within: screenEl("dashboard") });
export const forecastCurrent = (): number =>
  moneyNear("Current Balance", { within: screenEl("forecast") });

/** Click "Today" on the calendar and read the day-detail panel's Opening / Closing. */
export const calendarToday = async (app: App): Promise<{ opening: number; closing: number }> => {
  const cal = screenEl("calendar");
  await app.user.click(within(cal).getByRole("button", { name: "Today" }));
  const heading = await within(cal).findByText(/^\w+day, \w{3} \d{1,2}$/);
  let panel: HTMLElement | null = heading;
  while (panel && !(/Opening/.test(panel.textContent ?? "") && /Closing/.test(panel.textContent ?? ""))) {
    panel = panel.parentElement;
  }
  if (!panel) throw new Error("day detail panel not found");
  return {
    opening: moneyNear("Opening", { within: panel }),
    closing: moneyNear("Closing", { within: panel }),
  };
};

export const storedBalance = (app: App): number =>
  (app.store.__get<{ currentBalance: number }>("users", app.uid) as { currentBalance: number })
    .currentBalance;

// ---------------------------------------------------------------------------
// The core invariant
// ---------------------------------------------------------------------------

export interface InvariantExpectation {
  /** initialBalance + Σ signed(completed), worked out by hand in the test. */
  balance: number;
  /** Also compare the calendar's closing balance for today (needs nothing pending <= today). */
  calendar?: boolean;
  /** Skip the stored-document comparison (for scenarios that assert it separately). */
  skipStore?: boolean;
  /** Number of completed rows Settings should say it computed from. */
  completedCount?: number;
}

/**
 * displayed current balance == initialBalance + Σ signed(completed), on every
 * screen, plus: the store holds the same number and the "mismatch" banner is
 * not showing (a derived value that disagrees with the stored one is itself a
 * symptom of two sources of truth).
 */
export const expectBalanceInvariant = async (
  app: App,
  expected: InvariantExpectation,
  label = ""
): Promise<void> => {
  const at = label ? ` [${label}]` : "";
  const settings = screenEl("settings");
  // preconditions first: the screens exist and show money at all
  expect(() => settingsCurrent(settings), `settings rendered${at}`).not.toThrow();
  if (!expected.skipStore) {
    expect(storedBalance(app), `stored users.currentBalance${at}`).toBeCloseTo(expected.balance, 2);
  }
  expect(settingsCurrent(settings), `Settings > Current${at}`).toBeCloseTo(expected.balance, 2);
  expect(settingsComputed(settings), `Settings > Computed${at}`).toBeCloseTo(expected.balance, 2);
  expect(mismatchBanner(settings), `mismatch banner${at}`).toBeNull();
  if (expected.completedCount !== undefined) {
    expect(settingsComputedCount(settings), `Settings > computed-from count${at}`).toBe(
      expected.completedCount
    );
  }
  if (isMounted("dashboard")) {
    expect(dashboardCurrent(), `Dashboard > Current Balance${at}`).toBeCloseTo(expected.balance, 2);
  }
  if (isMounted("forecast")) {
    expect(forecastCurrent(), `Forecast > Current Balance${at}`).toBeCloseTo(expected.balance, 2);
  }
  if (expected.calendar && isMounted("calendar")) {
    const { closing } = await calendarToday(app);
    expect(closing, `Calendar closing today${at}`).toBeCloseTo(expected.balance, 2);
  }
};

// ---------------------------------------------------------------------------
// Gestures through the real modals
// ---------------------------------------------------------------------------

export const findTxn = (app: App, pred: (t: Transaction) => boolean): Transaction => {
  const found = app.financial().transactions.find(pred);
  if (!found) throw new Error("findTxn: no transaction matched");
  return found;
};

const openTransactionModal = async (app: App, transaction: Transaction) => {
  await act(async () => {
    app.openModal("TransactionModal", { transaction });
  });
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByRole("button", { name: /Cancel/ });
  return dialog;
};

/** Complete a transaction through TransactionModal's real form. */
export const completeViaModal = async (
  app: App,
  transaction: Transaction,
  opts: { amount?: number } = {}
): Promise<void> => {
  const dialog = await openTransactionModal(app, transaction);
  if (opts.amount !== undefined) {
    const amt = await within(dialog).findByLabelText(/Actual Amount/);
    await app.user.clear(amt);
    await app.user.type(amt, String(opts.amount));
  }
  await app.user.click(within(dialog).getByRole("button", { name: /Mark Complete/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await app.settle();
};

export const modeButton = (dialog: HTMLElement, mode: "Complete" | "Skip" | "Revert") =>
  within(dialog)
    .getAllByRole("button")
    .find((b) => new RegExp(`(^|\\s)${mode}$`).test(spacedText(b)) && b.getAttribute("type") === "button")!;

export const skipViaModal = async (app: App, transaction: Transaction): Promise<void> => {
  const dialog = await openTransactionModal(app, transaction);
  await app.user.click(modeButton(dialog, "Skip"));
  await app.user.click(within(dialog).getByRole("button", { name: /Skip Transaction/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await app.settle();
};

export const revertViaModal = async (app: App, transaction: Transaction): Promise<void> => {
  const dialog = await openTransactionModal(app, transaction);
  await app.user.click(modeButton(dialog, "Revert"));
  await app.user.click(within(dialog).getByRole("button", { name: /Revert to Projected/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await app.settle();
};

export const deleteManualViaModal = async (app: App, transaction: Transaction): Promise<void> => {
  const dialog = await openTransactionModal(app, transaction);
  await app.user.click(within(dialog).getByRole("button", { name: /Delete$/ }));
  await app.user.click(within(dialog).getByRole("button", { name: /Delete Transaction/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await app.settle();
};

/** Drive the app's Radix <Select> (a combobox button + listbox portal). */
export const pickOption = async (
  app: App,
  dialog: HTMLElement,
  label: RegExp,
  optionName: string
): Promise<void> => {
  await app.user.click(within(dialog).getByLabelText(label));
  const options = await screen.findAllByRole("option");
  const target = options.find((o) => new RegExp(`^${optionName}`).test((o.textContent ?? "").trim()));
  if (!target) throw new Error(`option ${optionName} not found among ${options.map((o) => o.textContent)}`);
  await app.user.click(target);
};

/** Add a manual transaction through ManualTransactionFormModal's real form. */
export const addManualViaForm = async (
  app: App,
  f: { name: string; type: "income" | "expense"; amount: number; date: string; status: "completed" | "projected" | "skipped" }
): Promise<void> => {
  await act(async () => {
    app.openModal("ManualTransactionFormModal", { prefilledDate: f.date });
  });
  const dialog = await screen.findByRole("dialog");
  await app.user.type(await within(dialog).findByLabelText(/^Name/), f.name);
  await pickOption(app, dialog, /^Type/, f.type === "income" ? "Income" : "Expense");
  await app.user.type(within(dialog).getByLabelText(/^Amount/), String(f.amount));
  const date = within(dialog).getByLabelText(/^Date/) as HTMLInputElement;
  await app.user.clear(date);
  await app.user.type(date, f.date);
  await pickOption(app, dialog, /^Status/, f.status[0].toUpperCase() + f.status.slice(1));
  await app.user.click(within(dialog).getByRole("button", { name: "Create Transaction" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await app.settle();
};

// ---------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------

/** Open Selective Reset and tick the given checkboxes (by visible label); does not continue. */
export const openSelectiveReset = async (app: App, labels: string[] = []): Promise<HTMLElement> => {
  await app.user.click(within(screenEl("settings")).getByRole("button", { name: /Selective Reset/ }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText(/Choose which financial data/);
  for (const label of labels) {
    await app.user.click(within(dialog).getByRole("checkbox", { name: new RegExp(`^${label}`) }));
  }
  return dialog;
};

/** Full flow: tick boxes, Continue, type DELETE, confirm. Resolves once the confirm dialog is gone. */
export const runSelectiveReset = async (app: App, labels: string[]): Promise<void> => {
  const dialog = await openSelectiveReset(app, labels);
  await app.user.click(within(dialog).getByRole("button", { name: "Continue" }));
  const confirm = await screen.findByRole("dialog");
  await within(confirm).findByText(/Type DELETE to confirm/);
  await app.user.type(within(confirm).getByPlaceholderText(/Type "DELETE"/), "DELETE");
  await app.user.click(within(confirm).getByRole("button", { name: "Reset Selected Data" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await app.settle();
};

/** Edit a manual transaction through ManualTransactionFormModal's real form. */
export const editManualViaForm = async (
  app: App,
  transaction: Transaction,
  changes: { type?: "income" | "expense"; amount?: number }
): Promise<void> => {
  await act(async () => {
    app.openModal("ManualTransactionFormModal", { transaction });
  });
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByLabelText(/^Name/);
  if (changes.type) {
    await pickOption(app, dialog, /^Type/, changes.type === "income" ? "Income" : "Expense");
  }
  if (changes.amount !== undefined) {
    const amt = within(dialog).getByLabelText(/^Amount/);
    await app.user.clear(amt);
    await app.user.type(amt, String(changes.amount));
  }
  await app.user.click(within(dialog).getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await app.settle();
};

/** Click the Settings "Recalculate Balance" button and wait for the write to land. */
export const clickRecalculate = async (app: App): Promise<void> => {
  await app.user.click(
    within(screenEl("settings")).getByRole("button", { name: /Recalculate Balance/ })
  );
  await waitFor(() =>
    expect(within(screenEl("settings")).getByText("Balance updated successfully!")).toBeInTheDocument()
  );
  await app.settle();
};
