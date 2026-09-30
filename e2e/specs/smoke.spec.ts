/**
 * Harness smoke test. If this is red, nothing else can be trusted.
 * Runs under every timezone project.
 */
import { test, expect } from "../fixtures";
import {
  TEST_EMAIL,
  TEST_UID,
  expenseRule,
  fixedExpense,
  incomeSource,
  userProfile,
} from "../helpers/builders";
import { FIXED_NOW, FIXED_TODAY } from "../helpers/clock";
import { addIncomeViaWizard, loginViaForm, navigateVia, waitForAppReady } from "../helpers/flows";
import { knownDefect } from "../helpers/knownDefect";
import { assertFakeFirebase, expectAppPath } from "../helpers/nav";
import {
  COLLECTIONS,
  readCollection,
  readDocument,
  readStore,
  reseed,
  seedAndLogin,
  seedAndVisit,
} from "../helpers/seed";

const EXPECTED_OFFSET_MINUTES: Record<string, number> = {
  UTC: 0,
  "Asia/Manila": -480, // getTimezoneOffset() is positive west of UTC
  "America/New_York": 240, // EDT on 2026-03-10 (DST began 2026-03-08)
};

test.describe("harness", () => {
  test("unauthenticated visit to a protected route redirects to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await assertFakeFirebase(page);
    await expectAppPath(page, "/login");
    await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
  });

  test("logging in through the real login form reaches the dashboard", async ({ page }) => {
    await page.goto("/login");
    await assertFakeFirebase(page);
    await loginViaForm(page, "newcomer@example.com", "any-password-works");

    await expectAppPath(page, "/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    // The app created the default profile itself, through the fake Firestore.
    await expect(page.getByText("Current Balance")).toBeVisible();
    const users = await readCollection<{ email: string; currentBalance: number }>(page, COLLECTIONS.users);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: "newcomer@example.com", currentBalance: 0 });
  });

  test("login form surfaces a rejected sign-in", async ({ page }) => {
    await seedAndVisit(page, { authConfig: { rejectEmailSignIn: "auth/invalid-credential" } }, "/login");
    await loginViaForm(page, TEST_EMAIL, "wrong");
    await expect(page.getByText(/Invalid email or password/)).toBeVisible();
    await expectAppPath(page, "/login");
  });

  test("Google popup sign-in signs in as the configured identity", async ({ page }) => {
    await seedAndVisit(page, {
      authConfig: { googleUser: { uid: "g-1", email: "g@example.com", displayName: "Gee Oh" } },
    });
    await page.getByRole("button", { name: "Sign in with Google" }).click();
    await expectAppPath(page, "/dashboard");
    await expect(page.getByText("Gee Oh").first()).toBeVisible();
  });

  test("seeded user: dashboard, income and expense pages show the seeded data", async ({ page }) => {
    await seedAndLogin(page, {
      user: userProfile({ currentBalance: 5000, initialBalance: 5000 }),
      incomeSources: [incomeSource({ name: "Acme Payroll", amount: 3000 })],
      expenseRules: [fixedExpense({ name: "Apartment Rent", amount: 1200 })],
    });
    await expectAppPath(page, "/dashboard");
    await expect(page.getByText("$5,000.00").first()).toBeVisible(); // Current Balance card
    await expect(page.getByText("E2E User").first()).toBeVisible(); // sidebar profile

    await navigateVia(page, "Income Manager");
    await expectAppPath(page, "/income");
    await expect(page.getByRole("heading", { name: "Acme Payroll", level: 4 })).toBeVisible();
    await expect(page.getByText("$3,000").first()).toBeVisible();

    await navigateVia(page, "Expense Manager");
    await expectAppPath(page, "/expenses");
    await expect(page.getByRole("heading", { name: "Apartment Rent" })).toBeVisible();
    await expect(page.getByText("$1,200.00").first()).toBeVisible();
  });

  test("a reload keeps the session and the data (seed is applied once, app writes survive)", async ({ page }) => {
    await seedAndLogin(
      page,
      { user: userProfile({ currentBalance: 5000, initialBalance: 5000 }) },
      { path: "/income" }
    );
    await waitForAppReady(page);
    await addIncomeViaWizard(page, { name: "Reload Gig", amount: 750 });
    await expect(page.getByRole("heading", { name: "Reload Gig", level: 4 })).toBeVisible();

    const before = await readCollection<{ name: string; userId: string }>(page, COLLECTIONS.incomeSources);
    expect(before.map((d) => d.name)).toEqual(["Reload Gig"]);
    expect(before[0].userId).toBe(TEST_UID);

    await page.reload();
    await assertFakeFirebase(page);
    await expectAppPath(page, "/income"); // still signed in: no bounce to /login
    await expect(page.getByRole("heading", { name: "Reload Gig", level: 4 })).toBeVisible();
    const after = await readCollection(page, COLLECTIONS.incomeSources);
    expect(after).toEqual(before); // init-script seed did NOT re-run and wipe the write
    expect((await readStore(page)).auth.currentUser?.uid).toBe(TEST_UID);
  });

  test("a live listener sees a bridge write without any reload", async ({ page }) => {
    await seedAndLogin(page, { user: userProfile({ currentBalance: 100 }) });
    await expect(page.getByText("$100.00").first()).toBeVisible();
    await reseed(page, { user: userProfile({ currentBalance: 250 }) }); // "another device changed the balance"
    await expect(page.getByText("$250.00").first()).toBeVisible();
  });

  test("a second tab shares the session and sees live writes (storage event sync)", async ({ page, context }) => {
    await seedAndLogin(page, { user: userProfile({ currentBalance: 100 }) });
    await expect(page.getByText("$100.00").first()).toBeVisible();
    const tab2 = await context.newPage();
    await tab2.goto("/dashboard");
    await assertFakeFirebase(tab2);
    await expect(tab2.getByText("$100.00").first()).toBeVisible(); // already signed in, same data
    await reseed(tab2, { user: userProfile({ currentBalance: 777 }) });
    await expect(page.getByText("$777.00").first()).toBeVisible(); // tab 1 followed
  });

  test("injected Firestore write faults reach the UI and nothing is stored", async ({ page }) => {
    await seedAndLogin(
      page,
      { user: userProfile(), fault: { code: "permission-denied", collections: [COLLECTIONS.incomeSources] } },
      { path: "/income" }
    );
    await waitForAppReady(page);
    await addIncomeViaWizard(page, { name: "Doomed", amount: 10 });
    await expect(page.getByText(/permission-denied/)).toBeVisible();
    expect(await readCollection(page, COLLECTIONS.incomeSources)).toEqual([]);
  });

  test("sign out returns to /login and protects routes again", async ({ page }) => {
    await seedAndLogin(page, { user: userProfile() });
    await page.getByRole("button", { name: /Logout/ }).click();
    await expectAppPath(page, "/login");
    expect((await readStore(page)).auth.currentUser).toBeNull();
    await page.goto("/dashboard");
    await expectAppPath(page, "/login");
  });

  test("the real Firebase SDK is not in use and nothing left the machine", async ({
    page,
    externalRequests,
    toleratedRequests,
  }) => {
    await seedAndLogin(page, { user: userProfile(), expenseRules: [expenseRule({ name: "Rent" })] });
    await waitForAppReady(page);
    expect(await page.evaluate(() => (window as unknown as { __FINTRACK_FAKE_FIREBASE__?: boolean }).__FINTRACK_FAKE_FIREBASE__)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __fintrackE2E?: { fake?: boolean } }).__fintrackE2E?.fake)).toBe(true);
    expect(externalRequests).toEqual([]);
    // Only the known-benign Google Fonts stylesheet (globals.css @import) is tolerated, and it is stubbed.
    expect(toleratedRequests.every((r) => new URL(r.url).hostname === "fonts.googleapis.com")).toBe(true);
  });

  test("clock is frozen at FIXED_NOW and the project timezone is applied", async ({ page }, testInfo) => {
    await seedAndLogin(page, { user: userProfile() });
    const tz = testInfo.project.use.timezoneId as string;
    const probe = await page.evaluate(() => ({
      iso: new Date().toISOString(),
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      offset: new Date().getTimezoneOffset(),
      local: new Date().toLocaleDateString("en-CA"), // YYYY-MM-DD in the browser's timezone
    }));
    expect(probe.iso).toBe(FIXED_NOW);
    expect(probe.zone).toBe(tz);
    expect(probe.offset).toBe(EXPECTED_OFFSET_MINUTES[tz]);
    expect(probe.local).toBe(FIXED_TODAY); // noon UTC is 03-10 in all three zones
    // Time is frozen, not merely started there:
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => new Date().toISOString())).toBe(FIXED_NOW);
  });
});

test.describe("network guard", () => {
  test.use({ allowedExternalHosts: ["guard-selftest.example"] });

  test("aborts and records external requests (allow-listed host: recorded-free, still aborted)", async ({
    page,
    externalRequests,
  }) => {
    await seedAndLogin(page, { user: userProfile() });
    const result = await page.evaluate(async () => {
      const outcomes: string[] = [];
      for (const url of ["https://guard-selftest.example/x", "https://fonts.gstatic.com/x"]) {
        try {
          await fetch(url, { mode: "no-cors" });
          outcomes.push("LEAKED");
        } catch {
          outcomes.push("blocked");
        }
      }
      return outcomes;
    });
    expect(result).toEqual(["blocked", "blocked"]);
    // The allow-listed host is not counted; the other one is. Drain it so the
    // teardown assertion (which would fail any test with recorded requests)
    // sees a clean slate — this is the ONLY place that is legitimate.
    expect(externalRequests.map((r) => new URL(r.url).hostname)).toEqual(["fonts.gstatic.com"]);
    externalRequests.length = 0;
  });
});

test.describe("known-defect helper (harness self-test)", () => {
  test("marks the test as expected-to-fail unless E2E_FLIP_KNOWN_DEFECTS=1", async ({ page }) => {
    knownDefect("SELFTEST-1", "1 + 1 renders as 3");
    await seedAndLogin(page, { user: userProfile({ currentBalance: 1 }) });
    // Deliberately wrong expectation standing in for a real product defect.
    await expect(page).toHaveTitle("Definitely not the title", { timeout: 1000 });
  });
});
