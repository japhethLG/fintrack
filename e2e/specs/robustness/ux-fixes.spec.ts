/**
 * Layout and navigation fixes that jsdom cannot see (docs/audit/manual-test-2026-10-01.md, cosmetic list):
 *   - on a phone the Transactions page's "Add Transaction" button covered the subtitle;
 *   - the landing page's "See How It Works" scrolled to Features instead of How It Works;
 *   - sign-up asks for the password twice and checks the length before anything is sent.
 */
import { test, expect, seedAndLogin, userProfile } from "../../index";

test.describe("phone 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("Transactions: the Add Transaction button does not cover the subtitle", async ({ page }) => {
    await seedAndLogin(page, { user: userProfile({ currentBalance: 1000, initialBalance: 1000 }) }, { path: "/transactions" });
    const subtitle = page.getByText("View and manage all your financial transactions.");
    const button = page.getByRole("button", { name: "Add Transaction" });
    await expect(subtitle).toBeVisible();
    await expect(button).toBeVisible();
    const s = (await subtitle.boundingBox())!;
    const b = (await button.boundingBox())!;
    const overlap = !(b.x + b.width <= s.x || s.x + s.width <= b.x || b.y + b.height <= s.y || s.y + s.height <= b.y);
    expect(overlap, `button ${JSON.stringify(b)} overlaps subtitle ${JSON.stringify(s)}`).toBe(false);
    // and the button is fully on screen
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(390);
  });
});

test("landing: 'See How It Works' scrolls to the How It Works section", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: /See How It Works/ });
  await expect(link).toHaveAttribute("href", "#how-it-works");
  await link.click();
  await expect(page).toHaveURL(/#how-it-works$/);
  await expect(page.locator("#how-it-works")).toBeInViewport();
});

test("sign-up: a short password and a mismatch are stopped by the form, with a clear message", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email", { exact: true }).fill("short@example.com");
  await page.getByLabel("Password", { exact: true }).fill("12345");
  await page.getByLabel("Confirm Password", { exact: true }).fill("12345");
  await page.getByRole("button", { name: "Sign Up", exact: true }).click();
  await expect(page.getByText("Password must be at least 6 characters.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible();

  await page.getByLabel("Password", { exact: true }).fill("123456");
  await page.getByLabel("Confirm Password", { exact: true }).fill("123457");
  await page.getByRole("button", { name: "Sign Up", exact: true }).click();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();

  await page.getByLabel("Confirm Password", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Sign Up", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
});
