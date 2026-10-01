import { describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { makeCompletedTransaction, makeManualTransaction, renderApp } from "../harness";
import * as d from "../rules/driver";
import { H1_TODAY, h1Seed } from "./households";
import { card, money, renderPages, screen, within } from "./screens";
import { moneyIn } from "../harness";

vi.setConfig({ testTimeout: 90_000 });

/**
 * Calendar fixes from the manual exploratory test (docs/audit/manual-test-2026-10-01.md):
 * M2 (week tiles), M6 (today's projected balance), M10 (day panel totals), L7 (right-click Add
 * Income / Add Expense), cosmetics (category labels, drag-and-drop announcements).
 * Every figure is written out by hand; today is Mon 2026-03-16 (H1_TODAY).
 */

const manual = (o: Parameters<typeof makeManualTransaction>[0]) =>
  makeManualTransaction({ projectedAmount: 100, ...o });

/** Non-faded cells of the month grid, indexed by day of month - 1. */
const monthCells = (cal: HTMLElement) =>
  Array.from(cal.querySelectorAll<HTMLElement>('[class*="min-h-[100px]"]')).filter(
    (c) => !c.className.includes("opacity-50")
  );

const clickDay = async (app: Awaited<ReturnType<typeof renderPages>>["app"], cal: HTMLElement, day: number) => {
  await app.user.click(monthCells(cal)[day - 1]);
};

describe("M2: the top tiles describe the period on show", () => {
  it("week view: Income / Expenses / Net / Transactions are the WEEK's, not the month's", async () => {
    const { app, page } = await renderPages(["calendar"], { today: H1_TODAY, seed: h1Seed() });
    const cal = page("calendar");
    // month view first: the whole of March (5,120 in, 2,930.83 out)
    expect(money(cal, "Income", { occurrence: 0 })).toBe(5_120);
    await app.user.click(within(cal).getByRole("button", { name: "Week" }));
    // Sun Mar 15 - Sat Mar 21: Payroll 2,000 in; Electricity 90 + Car Loan 564.8817 + Groceries 150 out
    expect(money(cal, "Income", { occurrence: 0 })).toBe(2_000);
    expect(money(cal, "Expenses", { occurrence: 0 })).toBe(-804.88);
    expect(money(cal, "Net Change", { occurrence: 0 })).toBe(1_195.12);
    expect(card(cal, "Transactions").textContent?.replace(/\s+/g, " ")).toContain("/ 4");
    // and the sidebar's weekly range says the same thing
    const side = card(cal, "Weekly range");
    expect(money(side, "Income")).toBe(2_000);
    expect(money(side, "Expenses")).toBe(-804.88);
  });
});

describe("M6: today's balance says it is projected when something is overdue", () => {
  const seed = (extra: Parameters<typeof manual>[0][] = []) => ({
    profile: { currentBalance: 5_000, initialBalance: 5_000 },
    transactions: [
      // rent was due on the 10th and is still unpaid
      manual({ id: "rent", name: "Rent", type: "expense", projectedAmount: 400, scheduledDate: "2026-03-10" }),
      ...extra.map(manual),
    ],
  });

  it("an overdue bill: a note gives the projected closing, the overdue amount and the current balance", async () => {
    const { page } = await renderPages(["calendar"], { today: H1_TODAY, seed: seed() });
    const note = within(page("calendar")).getByText(/is projected/).closest("div")!;
    // today closes at 5,000 - 400 overdue = 4,600; the realized balance is still 5,000
    expect(moneyIn(note)).toEqual([4_600, 400, 5_000]);
    expect(note.textContent).toMatch(/overdue/i);
  });

  it("nothing overdue: no note (today's closing is the current balance)", async () => {
    const { page } = await renderPages(["calendar"], {
      today: H1_TODAY,
      seed: { profile: { currentBalance: 5_000, initialBalance: 5_000 } },
    });
    expect(within(page("calendar")).queryByText(/is projected/)).toBeNull();
  });

  it("today's cell carries the explanation as its tooltip", async () => {
    const { page } = await renderPages(["calendar"], { today: H1_TODAY, seed: seed() });
    const chip = Array.from(monthCells(page("calendar"))[15].querySelectorAll<HTMLElement>("span")).find((s) =>
      s.hasAttribute("title")
    )!;
    expect(chip.getAttribute("title")).toMatch(/^Projected: after .*400.* overdue$/);
  });
});

describe("M10: a day's totals agree with its opening-to-closing change", () => {
  // current 1,000 already includes the 9,500 freelance paid early (dated Fri Mar 20, today is Mon Mar 16)
  const seed = () => ({
    profile: { currentBalance: 1_000, initialBalance: -8_500 },
    transactions: [
      makeCompletedTransaction({
        id: "free",
        name: "Freelance",
        type: "income",
        sourceType: "manual",
        projectedAmount: 9_500,
        actualAmount: 9_500,
        scheduledDate: "2026-03-20",
        actualDate: "2026-03-20",
        category: "freelance",
      }),
      manual({ id: "gig", name: "Gig", type: "income", projectedAmount: 3_200, scheduledDate: "2026-03-20" }),
    ],
  });

  it("the paid-early day: Income counts only what moved (3,200), and the row says it was paid early", async () => {
    const { app, page } = await renderPages(["calendar"], { today: H1_TODAY, seed: seed(), timeZone: "UTC" });
    const cal = page("calendar");
    await clickDay(app, cal, 20);
    const side = card(cal, "Friday, Mar 20");
    expect(money(side, "Opening")).toBe(1_000);
    expect(money(side, "Closing")).toBe(4_200);
    expect(money(side, "Income")).toBe(3_200); // was 12,700 (9,500 listed here but moved on Mar 16)
    expect(Math.abs(money(side, "Expenses"))).toBe(0); // nothing moved out
    expect(money(side, "Closing") - money(side, "Opening")).toBe(money(side, "Income"));
    expect(side.textContent).toContain("Paid early");
    expect(side.textContent).toContain("Transactions (2)"); // both rows are still listed on their day
  });

  it("today: Income counts the 9,500 that moved, and the panel lists it as paid ahead", async () => {
    const { app, page } = await renderPages(["calendar"], { today: H1_TODAY, seed: seed(), timeZone: "UTC" });
    const cal = page("calendar");
    await clickDay(app, cal, 16);
    const side = card(cal, "Monday, Mar 16");
    expect(money(side, "Opening")).toBe(-8_500);
    expect(money(side, "Closing")).toBe(1_000);
    expect(money(side, "Income")).toBe(9_500);
    expect(money(side, "Closing") - money(side, "Opening")).toBe(money(side, "Income"));
    const ahead = within(side).getByText("Paid ahead of their date").closest("div")!;
    expect(ahead.textContent).toContain("Freelance");
    expect(moneyIn(ahead)).toEqual([9_500]);
  });
});

describe("L7: right-click Add Income / Add Expense carries the clicked day", () => {
  it("month view: the menu sends the day to the manager", async () => {
    const { app, page } = await renderPages(["calendar"], { today: H1_TODAY, seed: h1Seed(), timeZone: "UTC" });
    const cal = page("calendar");
    fireEvent.contextMenu(monthCells(cal)[19]); // Mar 20
    await app.user.click(await screen.findByText("Add Income"));
    expect(app.router.push).toHaveBeenLastCalledWith("/income?new=1&date=2026-03-20");
    fireEvent.contextMenu(monthCells(cal)[21]); // Mar 22
    await app.user.click(await screen.findByText("Add Expense"));
    expect(app.router.push).toHaveBeenLastCalledWith("/expenses?new=1&date=2026-03-22");
  });

  it("week view: same", async () => {
    const { app, page } = await renderPages(["calendar"], { today: H1_TODAY, seed: h1Seed(), timeZone: "UTC" });
    const cal = page("calendar");
    await app.user.click(within(cal).getByRole("button", { name: "Week" }));
    fireEvent.contextMenu(cal.querySelectorAll<HTMLElement>("div.grid-cols-7 > div.cursor-pointer")[3]); // Wed Mar 18
    await app.user.click(await screen.findByText("Add Income"));
    expect(app.router.push).toHaveBeenLastCalledWith("/income?new=1&date=2026-03-18");
  });

  it("the income manager opens the wizard with that day as the Start Date", async () => {
    const app = await renderApp({ route: "/income?new=1&date=2026-04-05", today: "2026-03-16", timeZone: "UTC" });
    expect(await screen.findByText("Select Income Type")).toBeInTheDocument();
    expect(app.router.replace).toHaveBeenCalledWith("/income"); // the query is consumed
    await app.user.click(screen.getByRole("heading", { name: "Salary" }));
    await d.next(app);
    await d.fill(app, /^Source Name/, "Side gig");
    await d.fill(app, /^Amount/, "1000");
    await d.next(app);
    await screen.findByText("Schedule Configuration");
    const doc = await d.finishIncome(app, {});
    expect(doc.startDate).toBe("2026-04-05");
  });

  it("the expense manager opens the wizard with that day as the First Payment Date", async () => {
    const app = await renderApp({ route: "/expenses?new=1&date=2026-04-05", today: "2026-03-16", timeZone: "UTC" });
    expect(await screen.findByText("Select Expense Type")).toBeInTheDocument();
    expect(app.router.replace).toHaveBeenCalledWith("/expenses");
    await app.user.click(screen.getByRole("heading", { name: "Fixed Recurring" }));
    await d.next(app);
    await d.fillExpenseDetails(app, { kind: "Fixed Recurring", name: "Gym", amount: "50" });
    await d.next(app);
    const doc = await d.finishExpense(app, { kind: "Fixed Recurring" });
    expect(doc.startDate).toBe("2026-04-05");
  });

  it("without the query the manager shows its list, not the wizard", async () => {
    await renderApp({ route: "/income", today: "2026-03-16", timeZone: "UTC" });
    expect(screen.queryByText("Select Income Type")).toBeNull();
  });
});

describe("cosmetics", () => {
  it("(c) a stored category code reads as a label in the day list and the range list", async () => {
    const { page } = await renderPages(["calendar"], {
      today: H1_TODAY,
      seed: {
        profile: { currentBalance: 1_000, initialBalance: 1_000 },
        transactions: [
          manual({ id: "loan", name: "Loan pay", type: "expense", scheduledDate: "2026-03-18", category: "debt_payment" }),
        ],
      },
    });
    const cal = page("calendar");
    expect(within(cal).getAllByText("Debt Payment").length).toBeGreaterThan(0);
    expect(cal.textContent).not.toContain("debt_payment");
  });

  it("(b) screen readers hear the transaction's name and day while dragging, never its internal id", async () => {
    const { page } = await renderPages(["calendar"], {
      today: H1_TODAY,
      seed: {
        profile: { currentBalance: 1_000, initialBalance: 1_000 },
        transactions: [manual({ id: "proj_internal-id_123", name: "Phone bill", type: "expense", scheduledDate: "2026-03-18" })],
      },
    });
    const cal = page("calendar");
    const grab = within(cal).getAllByText("Phone bill")[0].closest<HTMLElement>('[role="button"]')!;
    // the hint dnd-kit attaches to every draggable
    const hintId = grab.getAttribute("aria-describedby")!;
    expect(document.getElementById(hintId)!.textContent).not.toMatch(/space|arrow key/i);
    // a pointer drag: press, move past the 8px activation distance
    await act(async () => {
      fireEvent.mouseDown(grab, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.mouseMove(document, { clientX: 40, clientY: 40 });
    });
    const live = document.querySelector<HTMLElement>('[role="status"][aria-live]')!;
    expect(live.textContent).toContain("Picked up Phone bill, Wednesday, March 18");
    expect(live.textContent).not.toContain("proj_internal-id_123");
    await act(async () => {
      fireEvent.mouseUp(document);
    });
  });
});
