import { describe, expect, it } from "vitest";
import * as React from "react";
import {
  renderApp,
  screen,
  within,
  waitFor,
  knownDefect,
  moneyNear,
  makeExpenseRule,
  makeManualTransaction,
} from "../harness";
import {
  Screens,
  completeViaModal,
  dashboardCurrent,
  findTxn,
  pickOption,
  screenEl,
  settingsCurrent,
  storedBalance,
} from "./support";

/**
 * Settings > Preferences (currency, threshold, week start, date format, theme) and how the
 * currency reaches every screen. Amounts on screen are compared as RAW strings only when
 * the point is "the same number must be printed the same way on two screens".
 */

const TODAY = "2026-01-15";

type Prefs = {
  currency: string;
  dateFormat: string;
  startOfWeek: number;
  theme: string;
  defaultWarningThreshold: number;
};
const prefsOf = (app: { store: { __get: <T>(c: string, id: string) => T | undefined } }) =>
  app.store.__get<{ preferences: Prefs }>("users", "user-1")!.preferences;

const settings = () => within(screenEl("settings"));
const saveButton = () => settings().queryByRole("button", { name: "Save Preferences" });

/** Raw amount text: everything from the first currency symbol / sign to the last digit. */
const rawAmount = (text: string): string => {
  const m = /[-+]?\s*[A-Z]{0,3}[₱$€£¥₹]\s*[-+]?\d[\d.,]*/.exec(text);
  if (!m) throw new Error(`no amount in "${text}"`);
  return m[0].replace(/\s+/g, "");
};
const settingsCurrentRaw = () => rawAmount(settings().getByText("Current").parentElement!.textContent!);
const dashboardCurrentRaw = () =>
  rawAmount(within(screenEl("dashboard")).getByText("Current Balance").parentElement!.parentElement!.textContent!);
const forecastCurrentRaw = () =>
  rawAmount(within(screenEl("forecast")).getByText("Current Balance").parentElement!.textContent!);

describe("saving preferences", () => {
  it("Save Preferences appears only once something changed; saving writes preferences only, never money", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: TODAY,
      seed: { profile: { currentBalance: 1_234.5, initialBalance: 1_234.5 } },
    });
    expect(saveButton()).not.toBeInTheDocument();
    await pickOption(app, screenEl("settings"), /^Currency$/, "EUR");
    expect(saveButton()).toBeInTheDocument();
    const before = app.store.__get<Record<string, unknown>>("users", "user-1")!;
    await app.user.click(saveButton()!);
    await settings().findByText("Preferences saved successfully!");
    await app.settle();
    const after = app.store.__get<Record<string, unknown>>("users", "user-1")!;
    // REWRITTEN (MANUAL-L5): the fixture profile now carries the real default date format
    expect(prefsOf(app)).toMatchObject({ currency: "EUR", dateFormat: "MM/DD/YYYY", startOfWeek: 0, theme: "dark", defaultWarningThreshold: 500 });
    // only `preferences` and `updatedAt` moved: balance fields, identity and stamps are byte-identical
    for (const key of ["currentBalance", "initialBalance", "balanceLastUpdatedAt", "email", "displayName", "uid"]) {
      expect(after[key]).toEqual(before[key]);
    }
    expect(app.store.__opsFor("users")).toHaveLength(1);
    // the number is NOT converted: 1,234.50 stays 1,234.50, only the symbol changes
    expect(storedBalance(app)).toBe(1_234.5);
    expect(settingsCurrentRaw()).toContain("€");
    expect(dashboardCurrentRaw()).toContain("€");
    // the button disappears again once the form matches the stored profile
    await waitFor(() => expect(saveButton()).not.toBeInTheDocument());
  }, 40_000);

  it("numeric preferences are stored as numbers: startOfWeek 1, threshold 499.99", async () => {
    const app = await renderApp({ route: "/settings", today: TODAY });
    await pickOption(app, document.body, /^Start of Week$/, "Monday");
    const threshold = screen.getByLabelText("Low Balance Warning Threshold");
    await app.user.clear(threshold);
    await app.user.type(threshold, "499.99");
    await app.user.click(screen.getByRole("button", { name: "Save Preferences" }));
    await screen.findByText("Preferences saved successfully!");
    expect(prefsOf(app).startOfWeek).toBe(1);
    expect(prefsOf(app).defaultWarningThreshold).toBe(499.99);
  });

  it("an empty threshold is refused with a message and nothing is written", async () => {
    const app = await renderApp({ route: "/settings", today: TODAY });
    const threshold = screen.getByLabelText("Low Balance Warning Threshold");
    await app.user.clear(threshold);
    await app.user.click(await screen.findByRole("button", { name: "Save Preferences" }));
    expect(await screen.findByText("Warning threshold is required")).toBeInTheDocument();
    expect(app.store.__opsFor("users")).toEqual([]);
    expect(prefsOf(app).defaultWarningThreshold).toBe(500);
  });

  it(
    "UI-BAL-24 — a stored threshold of 0 is displayed as 500 in the Preferences form",
    async () => {
      // observed: the input reads "500" for a profile whose defaultWarningThreshold is 0 (`|| 500`)
      const app = await renderApp({
        route: "/settings",
        today: TODAY,
        seed: { profile: { preferences: { defaultWarningThreshold: 0 } } },
      });
      expect(prefsOf(app).defaultWarningThreshold).toBe(0);
      const input = screen.getByLabelText("Low Balance Warning Threshold") as HTMLInputElement;
      expect(input.value).toBe("0");
    }
  );

  it(
    "UI-BAL-25 — changing only the THEME silently rewrites a stored threshold of 0 to 500",
    async () => {
      // observed: after saving a theme change, users/user-1.preferences.defaultWarningThreshold === 500
      const app = await renderApp({
        route: "/settings",
        today: TODAY,
        seed: { profile: { preferences: { defaultWarningThreshold: 0 } } },
      });
      expect(prefsOf(app).defaultWarningThreshold).toBe(0);
      await pickOption(app, document.body, /^Theme$/, "Light");
      await app.user.click(await screen.findByRole("button", { name: "Save Preferences" }));
      await screen.findByText("Preferences saved successfully!");
      expect(prefsOf(app).theme).toBe("light"); // the change the user asked for landed
      expect(prefsOf(app).defaultWarningThreshold).toBe(0); // and nothing else moved
    }
  );

  it.todo("DECISION: should a NEGATIVE low-balance threshold be rejected (it can never fire) or allowed?");
  it.todo("DECISION: what should the 'light' theme change? Nothing in the app reads preferences.theme.");
});

describe("low-balance threshold drives the calendar status colours", () => {
  // The calendar prints NO balances at all when the user has zero transactions (UI-BAL-40, below), so
  // every scenario here carries one skipped row: it moves no money but switches the calendar on.
  const filler = [makeManualTransaction({ id: "filler", status: "skipped", scheduledDate: "2026-01-02" })];
  const dayBalanceEl = (): HTMLElement => {
    const cal = screenEl("calendar");
    const num = within(cal).getAllByText("15").find((el) => el.nextElementSibling && /\d/.test(el.nextElementSibling.textContent ?? ""));
    if (!num) throw new Error("no day-15 cell");
    return num.nextElementSibling as HTMLElement;
  };
  const statusOf = () => {
    const c = dayBalanceEl().className;
    return /text-danger/.test(c) ? "danger" : /text-warning/.test(c) ? "warning" : /text-success/.test(c) ? "safe" : "none";
  };

  // "warned when your balance falls below this amount": strictly below.
  it.each([
    { balance: 500, threshold: 500, status: "safe" }, // equal is not "below"
    { balance: 499.99, threshold: 500, status: "warning" },
    { balance: 0, threshold: 500, status: "warning" },
    { balance: -0.01, threshold: 500, status: "danger" }, // overdrawn always beats a threshold
    { balance: 0, threshold: 0, status: "safe" },
    { balance: 1_000, threshold: 2_000, status: "warning" },
  ])("balance $balance with threshold $threshold is '$status'", async ({ balance, threshold, status }) => {
    await renderApp({
      ui: <Screens only={["calendar"]} />,
      today: TODAY,
      seed: { profile: { currentBalance: balance, initialBalance: balance, preferences: { defaultWarningThreshold: threshold } }, transactions: filler },
    });
    expect(statusOf()).toBe(status);
  }, 30_000);

  it("saving a higher threshold in Settings re-colours the calendar without a reload", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings", "calendar"]} />,
      today: TODAY,
      seed: { profile: { currentBalance: 800, initialBalance: 800 }, transactions: filler },
    });
    expect(statusOf()).toBe("safe"); // 800 >= 500
    const threshold = settings().getByLabelText("Low Balance Warning Threshold");
    await app.user.clear(threshold);
    await app.user.type(threshold, "1000");
    await app.user.click(await settings().findByRole("button", { name: "Save Preferences" }));
    await settings().findByText("Preferences saved successfully!");
    await app.settle();
    expect(statusOf()).toBe("warning"); // 800 < 1000
  }, 40_000);

  it(
    "UI-BAL-40 — a user with a balance but no transactions or rules gets a calendar with NO balances (Opening/Closing '—', empty grid)",
    async () => {
      // observed: useDailyBalances returns an empty Map when transactions.length === 0, so nothing is printed
      // for a balance the app knows exactly (800 on every day).
      await renderApp({
        ui: <Screens only={["settings", "calendar"]} />,
        today: TODAY,
        seed: { profile: { currentBalance: 800, initialBalance: 800 } },
      });
      expect(settingsCurrent(screenEl("settings"))).toBe(800); // precondition: a known balance
      const cal = screenEl("calendar");
      const cells = within(cal)
        .queryAllByText("15")
        .filter((el) => el.nextElementSibling && /\d/.test(el.nextElementSibling.textContent ?? ""))
        .map((el) => el.nextElementSibling!.textContent);
      expect(cells).toEqual(["$800.00"]);
    },
    30_000
  );

  it("a stored low_balance alert is not surfaced by any screen (alerts are dead UI)", async () => {
    // Characterisation. Nothing in the app calls createAlert, and no screen renders `alerts`;
    // the copy 'You'll be warned when your balance falls below this amount' is only honoured by the
    // calendar's colours.
    const { makeAlert } = await import("../harness");
    const app = await renderApp({
      ui: <Screens />,
      today: TODAY,
      seed: {
        profile: { currentBalance: 10, initialBalance: 10 },
        alerts: [makeAlert({ id: "al", title: "Balance below threshold!!", message: "You are under 500" })],
      },
    });
    expect(app.financial().alerts).toHaveLength(1);
    expect(screen.queryByText(/Balance below threshold!!/)).not.toBeInTheDocument();
    expect(screen.queryByText(/You are under 500/)).not.toBeInTheDocument();
  }, 40_000);
  it.todo("DECISION: where (if anywhere) should a low-balance WARNING appear besides the calendar colours? Spec 3.3 mentions colours; 3.5 mentions only overdue alerts.");
});

describe("week start and date format preferences (both offered in Settings)", () => {
  knownDefect(
    "UI-BAL-26",
    "Start of Week = Monday does not change the calendar (columns still start on Sunday)",
    async () => {
      // observed: header order Sun Mon Tue Wed Thu Fri Sat regardless of preferences.startOfWeek
      await renderApp({
        ui: <Screens only={["calendar"]} />,
        today: TODAY,
        seed: { profile: { preferences: { startOfWeek: 1 } } },
      });
      const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const headers = within(screenEl("calendar"))
        .getAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/)
        .map((el) => el.textContent);
      expect(headers.sort()).toEqual([...names].sort()); // precondition: all seven headers found
      const ordered = within(screenEl("calendar"))
        .getAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/)
        .map((el) => el.textContent);
      expect(ordered[0]).toBe("Mon");
    }
  );

  it(
    "UI-BAL-27 (fixed, MANUAL-L5): Date Format = DD/MM/YYYY is honoured: Settings prints 'Last updated' day first",
    async () => {
      // was: "Last updated: 2026-01-15" for a profile whose dateFormat is DD/MM/YYYY
      await renderApp({
        route: "/settings",
        today: TODAY,
        seed: { profile: { balanceLastUpdatedAt: "2026-01-15", preferences: { dateFormat: "DD/MM/YYYY" } } },
      });
      const label = screen.getByText(/^Last updated:/);
      expect(label.textContent).toMatch(/\d/); // precondition: a date is shown
      expect(label.textContent).toBe("Last updated: 15/01/2026");
    }
  );
});

describe("the same balance must read the same on every screen, in every currency", () => {
  // balance 1,234,567.5 printed on Settings, Dashboard and Forecast
  const passing = ["PHP", "USD", "GBP", "AUD", "JPY"];
  const rendered = async (currency: string) =>
    renderApp({
      ui: <Screens only={["settings", "dashboard", "forecast"]} />,
      today: TODAY,
      seed: { profile: { currentBalance: 1_234_567.5, initialBalance: 1_234_567.5, preferences: { currency } } },
    });

  it.each(passing)("%s: Settings and Dashboard print the balance identically", async (currency) => {
    await rendered(currency);
    expect(settingsCurrentRaw()).toBe(dashboardCurrentRaw());
  }, 30_000);

  it(
    "UI-BAL-28 — EUR: Settings prints €1,234,567.50, Dashboard prints €1.234.567,50",
    async () => {
      await rendered("EUR");
      expect(settingsCurrentRaw()).toContain("€");
      expect(dashboardCurrentRaw()).toContain("€");
      expect(settingsCurrentRaw()).toBe(dashboardCurrentRaw());
    },
    30_000
  );

  it(
    "UI-BAL-29 — CAD: Settings prints CA$1,234,567.50, Dashboard prints C$1,234,567.50",
    async () => {
      await rendered("CAD");
      expect(settingsCurrentRaw()).toContain("$");
      expect(dashboardCurrentRaw()).toContain("$");
      expect(settingsCurrentRaw()).toBe(dashboardCurrentRaw());
    },
    30_000
  );

  it(
    "UI-BAL-30 — INR: Settings groups digits 1,234,567.50, Dashboard groups 12,34,567.50",
    async () => {
      await rendered("INR");
      expect(settingsCurrentRaw()).toContain("₹");
      expect(dashboardCurrentRaw()).toContain("₹");
      expect(settingsCurrentRaw()).toBe(dashboardCurrentRaw());
    },
    30_000
  );

  it(
    "UI-BAL-31 — Forecast prints a balance with ONE decimal ($1,234,567.5) where Settings and Dashboard print cents",
    async () => {
      // observed: "$1,234,567.5" (minimumFractionDigits 0)
      await rendered("USD");
      expect(settingsCurrentRaw()).toBe("$1,234,567.50");
      expect(dashboardCurrentRaw()).toBe("$1,234,567.50");
      expect(forecastCurrentRaw()).toBe("$1,234,567.50");
    },
    30_000
  );

  it("switching the profile currency changes the symbol on every screen and converts nothing", async () => {
    const app = await rendered("USD");
    for (const [code, symbol] of [["GBP", "£"], ["JPY", "¥"], ["INR", "₹"]] as const) {
      await pickOption(app, screenEl("settings"), /^Currency$/, code);
      await app.user.click(await settings().findByRole("button", { name: "Save Preferences" }));
      await settings().findByText("Preferences saved successfully!");
      await waitFor(() => expect(settingsCurrentRaw()).toContain(symbol));
      expect(dashboardCurrentRaw()).toContain(symbol);
      expect(forecastCurrentRaw()).toContain(symbol);
      expect(storedBalance(app)).toBe(1_234_567.5);
    }
  }, 60_000);
});

describe("hard-coded currency symbols in Settings inputs", () => {
  it(
    "UI-BAL-32 — the Override Current Balance and Set Initial Balance inputs are prefixed with ₱ for a USD user",
    async () => {
      // observed: prefix "₱" on both (UI-OBS-02 found it on the threshold input only)
      const app = await renderApp({ route: "/settings", today: TODAY, seed: { profile: { preferences: { currency: "USD" } } } });
      expect(moneyNear("Current")).toBe(10_000); // a USD page ("$10,000.00")
      await app.user.click(screen.getByRole("button", { name: /Override Current Balance/ }));
      const override = screen.getByLabelText("Override Current Balance");
      expect(override.parentElement!.textContent).not.toContain("₱");
      expect(override.parentElement!.textContent).toContain("$");
    }
  );

  it(
    "UI-BAL-33 — the Set Initial Balance input is prefixed ₱ for a EUR user",
    async () => {
      const app = await renderApp({ route: "/settings", today: TODAY, seed: { profile: { preferences: { currency: "EUR" } } } });
      await app.user.click(screen.getByRole("button", { name: /Update Initial Balance$/ }));
      const input = screen.getByLabelText("Set Initial Balance");
      expect(input.parentElement!.textContent).toContain("€");
    }
  );
});

describe("cents, negative zero and large values on the balance screens", () => {
  it("a balance far above 32-bit range prints in full on Settings and Dashboard", async () => {
    // 123,456,789,012.34
    await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: TODAY,
      seed: { profile: { currentBalance: 123_456_789_012.34, initialBalance: 123_456_789_012.34 } },
    });
    expect(settingsCurrent(screenEl("settings"))).toBeCloseTo(123_456_789_012.34, 2);
    expect(dashboardCurrent()).toBeCloseTo(123_456_789_012.34, 2);
    expect(settingsCurrentRaw()).toBe("$123,456,789,012.34");
  }, 30_000);

  it("a large negative balance keeps its sign and shows the danger subtitle", async () => {
    await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: TODAY,
      seed: { profile: { currentBalance: -9_876_543.21, initialBalance: -9_876_543.21 } },
    });
    expect(dashboardCurrent()).toBe(-9_876_543.21);
    expect(settingsCurrent(screenEl("settings"))).toBe(-9_876_543.21);
    expect(within(screenEl("dashboard")).getByText("Negative balance!")).toBeInTheDocument();
  }, 30_000);

  it(
    "UI-BAL-34 — 0.3 - 0.1 - 0.2 (completed through the modal) leaves a float residue that renders as '-$0.00' with a 'Negative balance!' warning",
    async () => {
      // observed: Dashboard "-$0.00" + "Negative balance!", Settings "-$0.00": the balance is exactly zero in money
      const app = await renderApp({
        ui: <Screens only={["settings", "dashboard"]} />,
        today: TODAY,
        seed: {
          profile: { currentBalance: 0.3, initialBalance: 0.3 },
          expenseRules: [
            makeExpenseRule({ id: "a", name: "Alpha", amount: 0.1, startDate: "2026-01-10", frequency: "one-time" }),
            makeExpenseRule({ id: "b", name: "Beta", amount: 0.2, startDate: "2026-01-12", frequency: "one-time" }),
          ],
        },
      });
      await completeViaModal(app, findTxn(app, (t) => t.name === "Alpha"));
      await completeViaModal(app, findTxn(app, (t) => t.name === "Beta"));
      // preconditions: both bills are completed
      expect(app.store.__all<{ status: string }>("transactions").filter((t) => t.status === "completed")).toHaveLength(2);
      // money assertion: 0.30 - 0.10 - 0.20 = 0.00 exactly, as money
      expect(dashboardCurrentRaw()).toBe("$0.00");
      expect(within(screenEl("dashboard")).queryByText("Negative balance!")).not.toBeInTheDocument();
      expect(settingsCurrentRaw()).toBe("$0.00");
    },
    60_000
  );

  it(
    "UI-BAL-39 — the completion modal's variance line drops the cents: +$0.49 is printed '+$0'",
    async () => {
      // observed: "+$0 variance from expected" for an actual of 120.49 against 120
      const app = await renderApp({
        ui: <Screens only={["settings"]} />,
        today: TODAY,
        seed: {
          profile: { currentBalance: 1_000, initialBalance: 1_000 },
          expenseRules: [makeExpenseRule({ id: "a", name: "Bill", amount: 120, startDate: "2026-01-10", frequency: "one-time" })],
        },
      });
      const { act } = await import("../harness");
      await act(async () => {
        app.openModal("TransactionModal", { transaction: findTxn(app, (t) => t.name === "Bill") });
      });
      const dialog = await screen.findByRole("dialog");
      const amount = await within(dialog).findByLabelText(/Actual Amount/);
      await app.user.clear(amount);
      await app.user.type(amount, "120.49");
      const line = await within(dialog).findByText(/variance from expected/);
      expect(line.textContent).toMatch(/variance from expected$/);
      expect(line.textContent).toBe("+$0.49 variance from expected");
    },
    40_000
  );

  it("a stored completed amount with cents moves the balance by exactly those cents", async () => {
    // 1,000.10 - 33.33 = 966.77
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: TODAY,
      seed: {
        profile: { currentBalance: 1_000.1, initialBalance: 1_000.1 },
        expenseRules: [makeExpenseRule({ id: "a", name: "Bill", amount: 40, startDate: "2026-01-10", frequency: "one-time" })],
      },
    });
    await completeViaModal(app, findTxn(app, (t) => t.name === "Bill"), { amount: 33.33 });
    expect(dashboardCurrent()).toBeCloseTo(966.77, 2);
    expect(settingsCurrent(screenEl("settings"))).toBeCloseTo(966.77, 2);
    expect(dashboardCurrentRaw()).toBe("$966.77");
  }, 40_000);
});
