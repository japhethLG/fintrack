/**
 * Hostile / malformed stored documents. The repo ships no Firestore security
 * rules, so any document shape can reach the client. Every page must stay
 * alive (no uncaught error, no frozen tab) and must not print NaN/undefined.
 */
import {
  test,
  expect,
  seedAndLogin,
  userProfile,
  fixedExpense,
  incomeSource,
  creditCard,
  ts,
} from "../../index";
import { APP_PAGES, badTokens, isResponsive } from "./support";
import type { Page } from "@playwright/test";

type Seed = Parameters<typeof seedAndLogin>[1];

const BASE = userProfile({ currentBalance: 1000, initialBalance: 1000 });

/** Visit one page and wait for it to have left its loading state. */
const visit = async (page: Page, path: string, h1: string, timeout = 7_000) => {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: h1, level: 1 })).toBeVisible({ timeout });
  await expect(page.getByText(/^Loading/)).toHaveCount(0);
};

/** Bounded wait: a frozen tab fails the assertion instead of hanging the worker. */
/** Node-side bound: never await the page directly when it may be frozen. */
const race = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

/** A blocked renderer cannot run beforeunload or answer evaluate(): kill it from the browser side so fixture teardown / failure screenshots do not hang. */
const closeQuietly = async (page: Page) => {
  await race(page.context().newCDPSession(page).then((cdp) => cdp.send("Page.crash")), 4_000, undefined);
  await race(page.close({ runBeforeUnload: false }), 4_000, undefined);
};

const SURVIVES: Array<{ name: string; seed: Seed }> = [
  { name: "rules without scheduleConfig", seed: { expenseRules: [fixedExpense({ id: "e1", name: "NoCfg", scheduleConfig: undefined as never })], incomeSources: [incomeSource({ id: "i1", name: "NoCfgInc", scheduleConfig: undefined as never })] } },
  { name: "unknown frequency", seed: { incomeSources: [incomeSource({ id: "i1", name: "Odd", frequency: "fortnightly" as never })], expenseRules: [fixedExpense({ id: "e1", name: "OddExp", frequency: "hourly" as never })] } },
  { name: "bi-weekly intervalWeeks 0", seed: { incomeSources: [incomeSource({ id: "i1", name: "ZeroBi", frequency: "bi-weekly", scheduleConfig: { intervalWeeks: 0, dayOfWeek: 5 } })] } },
  { name: "endDate before startDate", seed: { expenseRules: [fixedExpense({ id: "e1", name: "Backwards", startDate: "2026-06-01", endDate: "2026-01-01" })] } },
  { name: "unparseable startDate", seed: { expenseRules: [fixedExpense({ id: "e1", name: "Garbage", startDate: "not-a-date" })] } },
  { name: "startDate stored as a Timestamp instead of a string", seed: { expenseRules: [fixedExpense({ id: "e1", name: "TsStart", startDate: ts("2026-03-01") as never })] } },
  {
    name: "credit card with blank optional fields",
    seed: { expenseRules: [creditCard({ id: "e1", name: "BlankCC" }, { statementDate: undefined, dueDate: undefined, apr: undefined, creditLimit: 0, currentBalance: 0 } as never)] },
  },
  { name: "user profile with string balance and null initialBalance", seed: { user: userProfile({ currentBalance: "12" as never, initialBalance: null as never }) } },
];

test.describe("every page survives", () => {
  for (const c of SURVIVES) {
    test(`${c.name}`, async ({ page, diagnostics }) => {
      test.setTimeout(90_000);
      await seedAndLogin(page, { user: BASE, ...c.seed }, { path: "/dashboard" });
      for (const p of APP_PAGES) {
        await visit(page, p.path, p.h1);
        expect(await isResponsive(page), `${p.path} responsive`).toBe(true);
        expect(await badTokens(page), `${p.path} shows NaN/undefined`).toEqual([]);
      }
      expect(diagnostics.pageErrors).toEqual([]);
    });
  }
});

test.describe("performance with old data", () => {
  test("daily and weekly rules starting in 2015 render every page promptly", async ({ page, diagnostics }) => {
    test.setTimeout(90_000);
    await seedAndLogin(
      page,
      {
        user: BASE,
        expenseRules: [
          fixedExpense({ id: "e1", name: "Coffee", amount: 3, frequency: "daily", startDate: "2015-01-01", scheduleConfig: {} }),
          fixedExpense({ id: "e2", name: "Old Weekly", amount: 9, frequency: "weekly", startDate: "2015-01-01", scheduleConfig: { dayOfWeek: 2 } }),
        ],
        incomeSources: [incomeSource({ id: "i1", name: "Old Biweekly", frequency: "bi-weekly", startDate: "2015-01-02", scheduleConfig: { dayOfWeek: 5 } })],
      },
      { path: "/dashboard" }
    );
    for (const p of APP_PAGES) {
      const t0 = Date.now();
      await visit(page, p.path, p.h1);
      expect(Date.now() - t0, `${p.path} took too long`).toBeLessThan(10_000);
      expect(await isResponsive(page, 3_000)).toBe(true);
      expect(await badTokens(page)).toEqual([]);
    }
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test("200 rules (mixed frequencies) keep the app responsive", async ({ page, diagnostics }) => {
    test.setTimeout(240_000);
    const freqs = ["daily", "weekly", "bi-weekly", "monthly", "quarterly", "yearly"] as const;
    const rules = Array.from({ length: 200 }, (_, i) =>
      fixedExpense({ id: `bulk-${i}`, name: `Bulk ${i}`, amount: 5 + (i % 7), frequency: freqs[i % freqs.length], startDate: "2025-06-01", scheduleConfig: { dayOfWeek: i % 7, dayOfMonth: (i % 28) + 1 } })
    );
    await seedAndLogin(page, { user: BASE, expenseRules: rules }, { path: "/dashboard" });
    for (const p of APP_PAGES) {
      // Observed ~4-11 s per page on a loaded CI box (Dashboard/Calendar slowest): generous bound, see DECISION below.
      await visit(page, p.path, p.h1, 60_000);
      expect(await isResponsive(page, 5_000), `${p.path} responsive`).toBe(true);
    }
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test("DECISION: a page-load performance budget for large data sets", async () => {
    test.fixme(true, "DECISION: no performance budget exists. With 200 rules Dashboard needs ~4-11 s and Calendar ~3-8 s to appear (getRunway/health score filter all transactions once per day). Decide a target (e.g. < 3 s) before asserting one.");
  });
});

test.describe("known defects in hostile data", () => {
  test("a negative bi-weekly intervalWeeks must not freeze the tab", async ({ page }) => {
    test.setTimeout(60_000);
    // precondition: the same shape with a sane interval renders and answers
    await seedAndLogin(page, { user: BASE, incomeSources: [incomeSource({ id: "i0", name: "Ok Bi", frequency: "bi-weekly", scheduleConfig: { intervalWeeks: 2, dayOfWeek: 5 } })] });
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await page.evaluate(() => {
      const key = "__fintrack_e2e_store_v1__";
      const s = JSON.parse(localStorage.getItem(key) as string);
      s.collections.income_sources["i0"].scheduleConfig.intervalWeeks = -2;
      localStorage.setItem(key, JSON.stringify(s));
    });
    let rendered = false;
    try {
      await race(page.reload({ waitUntil: "commit", timeout: 8_000 }), 10_000, undefined);
      rendered = await race(
        page.getByRole("heading", { name: "Dashboard", level: 1 }).waitFor({ timeout: 12_000 }).then(() => true),
        14_000,
        false
      );
    } finally {
      await closeQuietly(page);
    }
    expect(rendered, "dashboard rendered within 12 s of reload").toBe(true);
  });

  test("a rule with a null amount must not crash the calendar", async ({ page, diagnostics }) => {
    await seedAndLogin(page, { user: BASE, expenseRules: [fixedExpense({ id: "e1", name: "NullAmt", amount: null as never, startDate: "2026-03-12", scheduleConfig: { dayOfMonth: 12 } })] });
    await visit(page, "/dashboard", "Dashboard"); // precondition: the dashboard survives
    await page.goto("/calendar");
    await page.getByRole("heading", { name: "Financial Calendar", level: 1 }).waitFor({ timeout: 7_000 }).catch(() => undefined);
    expect(diagnostics.pageErrors).toEqual([]);
    await expect(page.getByRole("heading", { name: "Financial Calendar", level: 1 })).toBeVisible();
  });

  test("a rule whose amount is a non-numeric string must not print NaN", async ({ page }) => {
    await seedAndLogin(page, { user: BASE, expenseRules: [fixedExpense({ id: "e1", name: "StrAmt", amount: "abc" as never, startDate: "2026-03-12", scheduleConfig: { dayOfMonth: 12 } })] });
    await visit(page, "/dashboard", "Dashboard");
    expect(await badTokens(page)).toEqual([]);
  });
});
