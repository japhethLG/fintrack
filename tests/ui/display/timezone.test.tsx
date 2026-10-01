import { describe, expect, it, vi } from "vitest";
import { knownDefect } from "../harness";
import { H1_TODAY, h1Seed } from "./households";
import { card, dayCell, money, renderPages, within } from "./screens";

// Load-tolerant: a cold first render can exceed the default 20s on a busy machine.
vi.setConfig({ testTimeout: 90_000 });

/**
 * TIME ZONES. Every test pins its zone with renderApp({ timeZone }) so the result
 * does not depend on UI_TEST_TZ. Same household H1, "today" at 00:30 and 23:30 local.
 */
const ZONES = ["UTC", "Asia/Manila", "America/New_York"] as const;
const CLOCKS = ["2026-03-16T00:30", "2026-03-16T23:30"] as const;

describe("H1 totals do not change with zone or time of day (all values are YYYY-MM-DD strings)", () => {
  for (const tz of ZONES) {
    for (const today of CLOCKS) {
      it(`${tz} @ ${today}`, async () => {
        const { app, page } = await renderPages(["dashboard", "calendar", "forecast"], {
          today,
          timeZone: tz,
          seed: h1Seed(),
        });
        expect(new Date().getDate()).toBe(16); // precondition: the local clock is really Mar 16
        const kpi = card(page("dashboard"), "Period Summary");
        expect(money(kpi, "Current Balance")).toBe(13_969.05);
        expect(money(kpi, "Total Income")).toBe(5_120);
        expect(money(kpi, "Total Expenses")).toBe(-2_930.83);
        expect(money(kpi, "Net Flow")).toBe(2_189.17);
        expect(money(page("calendar"), "Income", { occurrence: 0 })).toBe(5_120);
        expect(money(card(page("forecast"), /Budgeted vs Actual/), "Actual", { occurrence: 1 })).toBe(2_930.83);
        expect(app.financial().transactions.filter((t) => t.status === "completed")).toHaveLength(15);
      });
    }
  }
});

describe("month boundary: Mar 31 23:30 vs Apr 1 00:30 local", () => {
  for (const tz of ZONES) {
    it(`${tz}: Mar 31 23:30 still reports March`, async () => {
      const { page } = await renderPages(["dashboard"], { today: "2026-03-31T23:30", timeZone: tz, seed: h1Seed() });
      expect(within(page("dashboard")).getByText(/Financial overview for Mar 1 - Mar 31, 2026/)).toBeInTheDocument();
      expect(money(card(page("dashboard"), "Period Summary"), "Total Income")).toBe(5_120);
    });
    it(`${tz}: Apr 1 00:30 reports April: income 4,750, expenses 2,679.88, 8 overdue March rows`, async () => {
      // April hand: income 2,000 (Apr15) + 2,000 (Apr30) + 750 (Apr10); expenses Rent 1,200 + 4 x 150 (Apr 4,11,18,25)
      // + Electricity 90 + Loan 564.8817 + Visa 25 + Laptop 200 = 2,679.8817.
      // overdue = unpaid March rows: Payroll Mar30, Groc Mar21+28, Electricity, Loan, Visa, Laptop, Dentist = 8
      const { page } = await renderPages(["dashboard"], { today: "2026-04-01T00:30", timeZone: tz, seed: h1Seed() });
      const d = page("dashboard");
      expect(within(d).getByText(/Financial overview for Apr 1 - Apr 30, 2026/)).toBeInTheDocument();
      const kpi = card(d, "Period Summary");
      expect(money(kpi, "Total Income")).toBe(4_750);
      expect(money(kpi, "Total Expenses")).toBe(-2_679.88);
      expect(within(d).getByText("8 Overdue Transactions")).toBeInTheDocument();
    });
  }
});

describe("west of UTC (America/New_York): dates parsed with new Date('YYYY-MM-DD') slide a day", () => {
  const mount = () =>
    renderPages(["dashboard", "forecast"], { today: H1_TODAY, timeZone: "America/New_York", seed: h1Seed() });

  it(
    "UI-DISP-40 — Period Comparison window slides a day west of UTC: the previous period drops Feb 28 and changes every 'was' and % (direction of income flips)",
    async () => {
      // observed: 'vs Jan 28 - Feb 27', was $3,950 (income arrow UP 29.6%) instead of Jan 29 - Feb 28, $5,950 (DOWN 13.9%).
      const { page } = await mount();
      const pc = card(page("dashboard"), "Period Comparison");
      expect(money(pc, "Total Income")).toBe(5_120); // precondition: current period is right
      expect(pc.textContent).toContain("vs Jan 29 - Feb 28");
      expect(money(pc, "Total Income", { index: 1 })).toBe(5_950);
    }
  );

  it(
    "UI-DISP-41 — Dashboard Upcoming Activity prints every due date one day early west of UTC",
    async () => {
      // observed: Electricity 'Mar 17' (due Mar 18), Car Loan 'Mar 19' (due Mar 20), Payroll 'Mar 29'.
      const { page } = await mount();
      const upc = card(page("dashboard"), /Upcoming Activity/);
      expect(within(upc).getByText("Electricity")).toBeInTheDocument(); // precondition
      expect(within(upc).getByText("Electricity").nextElementSibling!.textContent).toBe("Mar 18");
    }
  );

  it(
    "UI-DISP-42 — Forecast 'Crunch on' date is one day early west of UTC",
    async () => {
      // bill pushes balance negative on Mar 25; observed 'Crunch on 3/24/2026'.
      const r = await renderPages(["forecast"], {
        today: H1_TODAY,
        timeZone: "America/New_York",
        seed: {
          profile: { currentBalance: 500, initialBalance: 500 },
          expenseRules: [
            { ...h1Seed().expenseRules![0], id: "big", name: "Big", frequency: "one-time", amount: 900, startDate: "2026-03-25" },
          ],
        },
      });
      const rc = card(r.page("forecast"), "Cash Runway");
      expect(rc.textContent).toContain("Crunch on"); // precondition
      // REWRITTEN (MANUAL-L5): numeric dates follow the Date Format preference; the fixture profile
      // is YYYY-MM-DD (it used to print the browser's locale format, 3/25/2026)
      expect(rc.textContent).toContain("Crunch on 2026-03-25");
    }
  );
});

describe("projection window end (last day of the 4-month look-ahead, Jun 30)", () => {
  it(
    "UI-DISP-43 — America/New_York: the Jun 30 payroll is missing from the calendar (window end parsed as UTC midnight)",
    async () => {
      // observed: Jun 15 shows Payroll, Jun 30 shows nothing. (UTC shows both.)
      const { app, page } = await renderPages(["calendar"], { today: H1_TODAY, timeZone: "America/New_York", seed: h1Seed() });
      const cal = page("calendar");
      for (let i = 0; i < 3; i += 1) await app.user.click(within(cal).getByText("chevron_right").closest("button")!);
      expect(within(cal).getByText("June 2026")).toBeInTheDocument();
      expect(dayCell(cal, 15).textContent).toContain("Payroll"); // precondition
      expect(dayCell(cal, 30).textContent).toContain("Payroll");
    }
  );

  it("Asia/Manila: the default window ends Jun 29 but navigating to June expands it, so Jun 30 IS shown (the bug is masked on the calendar)", async () => {
    const { app, page } = await renderPages(["calendar"], { today: H1_TODAY, timeZone: "Asia/Manila", seed: h1Seed() });
    const cal = page("calendar");
    for (let i = 0; i < 3; i += 1) await app.user.click(within(cal).getByText("chevron_right").closest("button")!);
    expect(dayCell(cal, 30).textContent).toContain("Payroll");
  });

  it("UTC: both Jun 15 and Jun 30 payroll are present", async () => {
    const { app, page } = await renderPages(["calendar"], { today: H1_TODAY, timeZone: "UTC", seed: h1Seed() });
    const cal = page("calendar");
    for (let i = 0; i < 3; i += 1) await app.user.click(within(cal).getByText("chevron_right").closest("button")!);
    expect(dayCell(cal, 15).textContent).toContain("Payroll");
    expect(dayCell(cal, 30).textContent).toContain("Payroll");
  });
});
