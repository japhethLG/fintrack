/** AI Forecast with the Gemini stub (window.__fintrackE2E.geminiResponse/geminiError/geminiCalls). */
import { test, expect, seedAndLogin, userProfile, fixedExpense, incomeSource, knownDefect } from "../../index";
import { isResponsive } from "./support";
import type { Page } from "@playwright/test";

const seed = {
  user: userProfile({ currentBalance: 1000, initialBalance: 1000 }),
  incomeSources: [incomeSource({ id: "i1", name: "Acme Payroll", amount: 3000, startDate: "2026-01-01", scheduleConfig: { dayOfMonth: 1 } })],
  expenseRules: [fixedExpense({ id: "r1", name: "Rent", amount: 1200, startDate: "2026-01-01", scheduleConfig: { dayOfMonth: 1 } })],
};

type Call = { model: string; context: { currentBalance: number; currencySymbol?: string; periodSummary: { dateRange: { start: string; end: string } }; transactions: Array<{ status: string; scheduledDate: string }> } };
const bridge = (page: Page, patch: { geminiResponse?: string; geminiError?: string }) =>
  page.evaluate((p) => Object.assign((window as unknown as { __fintrackE2E: object }).__fintrackE2E, p), patch);
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __fintrackE2E: { geminiCalls: unknown[] } }).__fintrackE2E.geminiCalls) as Promise<Call[]>;
const generate = async (page: Page) => {
  await page.getByRole("button", { name: /Generate AI Insights/ }).click();
};

test.beforeEach(async ({ page }) => {
  await seedAndLogin(page, seed, { path: "/forecast" });
  await expect(page.getByRole("button", { name: /Generate AI Insights/ })).toBeVisible();
});

test("default response is rendered as markdown and the prompt context carries the right numbers", async ({ page }) => {
  await generate(page);
  await expect(page.getByRole("heading", { name: "AI Analysis Report" })).toBeVisible();
  await expect(page.getByText("E2E FAKE AI ANALYSIS")).toBeVisible();
  const [call] = await calls(page);
  expect(call.context.currentBalance).toBe(1000);
  expect(call.context.currencySymbol).toBe("$");
  expect(call.context.periodSummary.dateRange).toEqual({ start: "2026-03-01", end: "2026-03-31" });
});

test("a service error string is shown to the user, and Clear returns to the start state", async ({ page }) => {
  await bridge(page, { geminiError: "quota exceeded" });
  await generate(page);
  await expect(page.getByText("Error: quota exceeded")).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByRole("button", { name: /Generate AI Insights/ })).toBeVisible();
});

test("hostile markdown/HTML in the model output is inert", async ({ page }) => {
  await bridge(page, {
    geminiResponse:
      "# Title\n\n<script>window.__pwned=1</script>\n\n<img src=x onerror=\"window.__pwned=1\">\n\n[click](javascript:window.__pwned=1)\n\n**bold** `code`",
  });
  await generate(page);
  await expect(page.getByRole("heading", { name: "Title", level: 1 })).toBeVisible();
  const result = await page.evaluate(() => {
    const root = document.querySelector(".ai-analysis-content") as HTMLElement;
    const link = root.querySelector("a") as HTMLAnchorElement | null;
    return {
      pwned: (window as unknown as { __pwned?: number }).__pwned ?? null,
      scripts: root.querySelectorAll("script").length,
      imgs: root.querySelectorAll("img").length,
      jsHref: link ? link.getAttribute("href") : null,
    };
  });
  expect(result.pwned).toBeNull();
  expect(result.scripts).toBe(0);
  expect(result.imgs).toBe(0);
  expect((result.jsHref ?? "").toLowerCase().startsWith("javascript:")).toBe(false);
});

test("a 60k-character response keeps the page responsive and inside the viewport width", async ({ page }) => {
  await bridge(page, { geminiResponse: `# Long\n\n${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(1200)}\n\n${"x".repeat(400)}` });
  await generate(page);
  await expect(page.getByRole("heading", { name: "Long", level: 1 })).toBeVisible();
  expect(await isResponsive(page, 5_000)).toBe(true);
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(o.sw).toBeLessThanOrEqual(o.iw);
});

test("the 'Upcoming (next 30 days)' transactions sent to the AI must be upcoming", async ({ page }) => {
  knownDefect(
    "E2E-ROB-12",
    "context.transactions starts at 2026-01-01; the real prompt takes the first 15 'projected' rows and labels them 'Upcoming (next 30 days)' => overdue Jan/Feb rows are sent as upcoming"
  );
  await generate(page);
  await expect(page.getByRole("heading", { name: "AI Analysis Report" })).toBeVisible();
  const [call] = await calls(page);
  // Same selection the real prompt builder makes (geminiService.formatTransactions): first 15 projected rows.
  const listedAsUpcoming = call.context.transactions.filter((t) => t.status === "projected").slice(0, 15);
  expect(listedAsUpcoming.length).toBeGreaterThan(0);
  for (const t of listedAsUpcoming) {
    expect(t.scheduledDate >= "2026-03-10" && t.scheduledDate <= "2026-04-09", `${t.scheduledDate} is not within the next 30 days`).toBe(true);
  }
});
