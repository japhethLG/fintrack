import { describe, expect, it, vi } from "vitest";
import {
  knownDefect,
  makeExpenseRule,
  makeManualTransaction,
} from "../harness";
import { H1, H1_TODAY, h1Seed } from "./households";
import {
  amounts,
  card,
  colorToken,
  dayCellBalance,
  dayCellBalanceText,
  money,
  moneyOrNull,
  renderPages,
  screen,
  within,
} from "./screens";

// Load-tolerant: a cold first render can exceed the default 20s on a busy machine.
vi.setConfig({ testTimeout: 90_000 });

/** Manual (rule-less) rows keep hand computation trivial. */
const manual = (
  id: string,
  type: "income" | "expense",
  amount: number,
  date: string,
  status: "completed" | "projected" = "projected",
  extra: Record<string, unknown> = {}
) =>
  makeManualTransaction({
    id,
    name: id,
    type,
    projectedAmount: amount,
    scheduledDate: date,
    status,
    ...(status === "completed" ? { actualAmount: amount, actualDate: date } : {}),
    ...extra,
  });

const clickNav = async (
  app: Awaited<ReturnType<typeof renderPages>>["app"],
  cal: HTMLElement,
  dir: "left" | "right",
  times = 1
) => {
  for (let i = 0; i < times; i += 1) {
    const btn = within(cal).getByText(`chevron_${dir}`).closest("button")!;
    await app.user.click(btn);
  }
};

describe("Calendar: month view on H1", () => {
  it("previous month (Feb 2026): skipped rows are excluded from totals and from the completed/total tile", async () => {
    const { app, page } = await renderPages(["calendar"], { today: H1_TODAY, seed: h1Seed() });
    const cal = page("calendar");
    await clickNav(app, cal, "left");
    expect(within(cal).getByText("February 2026")).toBeInTheDocument();
    // Feb: Payroll 15th paid short 1,950 + Payroll 28th 2,000 = 3,950; Freelance Feb 10 SKIPPED (750 ignored)
    // Rent Feb 1 = 1,200. Net 2,750. Tile: 3 completed of 3 counted (skipped is neither).
    expect(money(cal, "Income", { occurrence: 0 })).toBe(3_950);
    expect(money(cal, "Expenses", { occurrence: 0 })).toBe(-1_200);
    expect(money(cal, "Net Change", { occurrence: 0 })).toBe(2_750);
    expect(card(cal, "Transactions").textContent?.replace(/\s+/g, " ")).toContain("3 / 3");
    // sidebar month range agrees
    const side = card(cal, "Monthly range");
    expect(money(side, "Income")).toBe(3_950);
    expect(money(side, "Expenses")).toBe(-1_200);
    // the skipped row is still listed (as skipped) but its 750 is in no total
    expect(within(side).getByText("skipped")).toBeInTheDocument();
  });

  it("December 2025 (inside the window once the user scrolls back): opening 5,000 and closing 5,900 are exact", async () => {
    const { app, page } = await renderPages(["calendar"], { today: H1_TODAY, seed: h1Seed() });
    const cal = page("calendar");
    await clickNav(app, cal, "left", 3);
    expect(within(cal).getByText("December 2025")).toBeInTheDocument();
    // 5,000 initial; Dec 20 +1,500 bonus; Dec 27 -600 flights -> 5,900
    expect(money(cal, "Opening", { occurrence: 0 })).toBe(5_000);
    expect(money(cal, "Closing", { occurrence: 0 })).toBe(5_900);
    expect(money(cal, "Income", { occurrence: 0 })).toBe(1_500);
    expect(money(cal, "Expenses", { occurrence: 0 })).toBe(-600);
  });

  knownDefect(
    "UI-DISP-07",
    "A month's opening balance changes after the user scrolls the calendar (window expansion), so it depends on navigation history",
    async () => {
      // observed: March opens at $11,450 on first view; after scrolling back to Dec 2025 and forward
      // again it reads $12,350 (the window now contains the Dec history that was previously subtracted
      // and never replayed).  Same month, same data, two different numbers.
      const { app, page } = await renderPages(["calendar"], { today: H1_TODAY, seed: h1Seed() });
      const cal = page("calendar");
      const before = money(cal, "Opening", { occurrence: 0 });
      await clickNav(app, cal, "left", 3);
      await clickNav(app, cal, "right", 3);
      expect(within(cal).getByText("March 2026")).toBeInTheDocument(); // precondition: back on March
      const after = money(cal, "Opening", { occurrence: 0 });
      expect(after).toBe(before);
    }
  );

  it("today and month-boundary cells: Mar 1 opens the month with rent, Mar 31 has no activity", async () => {
    const { page } = await renderPages(["calendar"], { today: H1_TODAY, seed: h1Seed() });
    const cal = page("calendar");
    // Whole-month movement inside the grid: Mar 1 closing -> Mar 31 closing = net of Mar 2..31
    // = (5,120 - 2,930.8317) - (-1,200 on Mar 1) => +3,389.1683 -> 3,389 on the whole-dollar chips
    expect(dayCellBalance(cal, 31) - dayCellBalance(cal, 1)).toBe(3_389);
    expect(dayCellBalance(cal, 31)).toBe(dayCellBalance(cal, 30)); // nothing on Mar 31
  });
});

describe("Calendar: week view on H1 (week of Sun Mar 15 - Sat Mar 21)", () => {
  it("weekly income and expenses: Payroll 2,000 in; Electricity 90 + Loan 564.8817 + Groceries 150 out", async () => {
    const { app, page } = await renderPages(["calendar"], { today: H1_TODAY, seed: h1Seed() });
    const cal = page("calendar");
    await app.user.click(within(cal).getByRole("button", { name: "Week" }));
    expect(within(cal).getAllByText("Mar 15 - Mar 21, 2026").length).toBeGreaterThanOrEqual(1);
    expect(within(cal).getByText("Weekly Balance Overview")).toBeInTheDocument();
    const side = card(cal, "Weekly range");
    expect(money(side, "Income")).toBe(2_000);
    expect(money(side, "Expenses")).toBe(-804.88); // 804.8817
    // change badge = closing - opening on the whole-dollar chips: +2,000 - 804.8817 = +1,195.1183 -> +$1,195
    expect(amounts(card(cal, /Weekly Balance Overview/))[0]).toBe(1_195);
  });

  knownDefect(
    "UI-DISP-08",
    "Week view opening/closing balances are short by the pre-window history",
    async () => {
      // observed: Opening $11,069 / Closing $12,264 (900 short).
      const { app, page } = await renderPages(["calendar"], { today: H1_TODAY, seed: h1Seed() });
      const cal = page("calendar");
      await app.user.click(within(cal).getByRole("button", { name: "Week" }));
      expect(money(card(cal, "Weekly range"), "Expenses")).toBe(-804.88); // precondition
      // opening at start of Mar 15 = 12,350 + Mar1..14 net (-1200 +300 -138.40 +820 -162.55 = -380.95) = 11,969.05
      expect(money(cal, "Opening", { occurrence: 0 })).toBe(11_969);
      // closing Mar 21 = 13,969.05 - 90 - 564.8817 - 150 = 13,164.1683
      expect(money(cal, "Closing", { occurrence: 0 })).toBe(13_164);
    }
  );
});

describe("Calendar: selecting a day (Fri Mar 20: Car Loan 564.8817 due)", () => {
  const pick = async () => {
    const r = await renderPages(["calendar"], {
      today: H1_TODAY,
      timeZone: "UTC",
      seed: h1Seed(),
    });
    const cal = r.page("calendar");
    // the day-20 cell: click its number
    const cells = Array.from(cal.querySelectorAll<HTMLElement>('[class*="min-h-[100px]"]')).filter(
      (c) => !c.className.includes("opacity-50")
    );
    await r.app.user.click(cells[19]);
    return { ...r, cal };
  };

  it("day panel title, income/expense tiles and transaction count", async () => {
    const { cal } = await pick();
    const side = card(cal, "Friday, Mar 20");
    expect(within(side).getByText("Transactions (1)")).toBeInTheDocument();
    expect(money(side, "Expenses")).toBe(-564.88);
    expect(money(side, "Income")).toBe(0);
  });

  knownDefect(
    "UI-DISP-09",
    "Day panel Opening/Closing carry the same pre-window shortfall",
    async () => {
      // observed: Opening $12,979 / Closing $12,414.17. correct: 13,969.05 - 90 = 13,879.05 ; - 564.8817 = 13,314.17
      const { cal } = await pick();
      const side = card(cal, "Friday, Mar 20");
      expect(money(side, "Expenses")).toBe(-564.88); // precondition
      expect(money(side, "Opening")).toBe(13_879.05);
      expect(money(side, "Closing")).toBe(13_314.17);
    }
  );

  knownDefect(
    "UI-DISP-10",
    "Transaction rows in the day/range panel print amounts with 3 decimals ($564.882) unlike every other screen ($564.88)",
    async () => {
      // observed: "-$564.882" (Number.toLocaleString default allows 3 fraction digits)
      const { cal } = await pick();
      const side = card(cal, "Friday, Mar 20");
      const row = within(side).getByText("Car Loan").closest("div.flex.items-start")!;
      expect(row.textContent).toMatch(/564\.88(?!\d)/);
    }
  );
});

describe("Calendar: transaction-row money formatting in the range panel", () => {
  knownDefect(
    "UI-DISP-11",
    "A completed 138.40 grocery prints as '$138.4' (ragged decimals)",
    async () => {
      // observed: "-$138.4"
      const { page } = await renderPages(["calendar"], { today: H1_TODAY, seed: h1Seed() });
      const side = card(page("calendar"), "Monthly range");
      expect(within(side).getAllByText("Groceries").length).toBe(4); // precondition: 4 Saturdays
      const row = within(side).getAllByText("Groceries")[0].closest("div.flex.items-start")!;
      expect(row.textContent).toMatch(/138\.40/);
    }
  );

  knownDefect(
    "UI-DISP-12",
    "Transaction rows hard-code '$' for a PHP user while every other figure on the page uses the peso sign",
    async () => {
      // observed: "-$90" on the Electricity row, "-₱2,931" in the summary tile above it.
      const seed = h1Seed({
        profile: {
          currentBalance: H1.currentBalance,
          initialBalance: H1.initialBalance,
          preferences: { currency: "PHP" },
        },
      });
      const { page } = await renderPages(["calendar"], { today: H1_TODAY, seed });
      const cal = page("calendar");
      expect(card(cal, "Expenses").textContent).toContain("₱"); // precondition: PHP is in effect
      const side = card(cal, "Monthly range");
      const row = within(side).getByText("Electricity").closest("div.flex.items-start")!;
      expect(row.textContent).toContain("₱");
      expect(row.textContent).not.toContain("$");
    }
  );
});

describe("Calendar: negative and low balances", () => {
  const overdrawn = () => ({
    profile: { currentBalance: -400, initialBalance: 0 },
    transactions: [
      manual("Rent paid", "expense", 400, "2026-03-10", "completed"),
      manual("Phone", "expense", 100, "2026-03-18"),
      manual("Client", "income", 1_000, "2026-03-20"),
    ],
  });

  knownDefect(
    "UI-DISP-13",
    "A day cell whose balance is negative prints it without the minus sign (-$500 and +$500 look identical)",
    async () => {
      // observed: Mar 18 (balance -500) prints "$ 500", Mar 20 (balance +500) prints "$ 500".
      const { page } = await renderPages(["dashboard", "calendar"], {
        today: H1_TODAY,
        seed: overdrawn(),
      });
      const cal = page("calendar");
      expect(money(card(page("dashboard"), "Period Summary"), "Current Balance")).toBe(-400); // precondition
      // opening = -400 + 400 (rent paid Mar 10 is in the balance) = 0; Mar 10 -> -400; Mar 18 -> -500; Mar 20 -> +500
      expect(dayCellBalance(cal, 20)).toBe(500);
      expect(dayCellBalanceText(cal, 20)).not.toContain("-");
      expect(dayCellBalance(cal, 18)).toBe(-500);
    }
  );

  it("the negative day is at least coloured as danger and the positive one as safe", async () => {
    const { page } = await renderPages(["calendar"], { today: H1_TODAY, seed: overdrawn() });
    const cal = page("calendar");
    const chip = (day: number) => {
      const cell = Array.from(cal.querySelectorAll<HTMLElement>('[class*="min-h-[100px]"]')).filter(
        (c) => !c.className.includes("opacity-50")
      )[day - 1];
      return Array.from(cell.querySelectorAll("span")).find((s) => /\$/.test(s.textContent ?? ""))!;
    };
    expect(colorToken(chip(10))).toBe("danger"); // -400
    expect(colorToken(chip(18))).toBe("danger"); // -500
    expect(colorToken(chip(20))).toBe("success"); // +500 >= threshold 500
  });

  it("warning threshold bands: below threshold is warning, exactly 0 is not danger, negative is danger", async () => {
    // threshold 500 (default). current 300; Mar 20 -100 => 200 (warning); Mar 25 +1,000 => 1,200 (safe);
    // Mar 27 -1,500 => -300 (danger); Mar 29 +300 => 0 (warning: not negative, below 500)
    const { page } = await renderPages(["calendar"], {
      today: H1_TODAY,
      seed: {
        profile: { currentBalance: 300, initialBalance: 300 },
        transactions: [
          manual("a", "expense", 100, "2026-03-20"),
          manual("b", "income", 1_000, "2026-03-25"),
          manual("c", "expense", 1_500, "2026-03-27"),
          manual("d", "income", 300, "2026-03-29"),
        ],
      },
    });
    const cal = page("calendar");
    const chip = (day: number) => {
      const cell = Array.from(cal.querySelectorAll<HTMLElement>('[class*="min-h-[100px]"]')).filter(
        (c) => !c.className.includes("opacity-50")
      )[day - 1];
      return Array.from(cell.querySelectorAll("span")).find((s) => /\$/.test(s.textContent ?? ""))!;
    };
    expect(colorToken(chip(16))).toBe("warning"); // 300
    expect(colorToken(chip(20))).toBe("warning"); // 200
    expect(colorToken(chip(25))).toBe("success"); // 1,200
    expect(colorToken(chip(27))).toBe("danger"); // -300
    expect(colorToken(chip(29))).toBe("warning"); // exactly 0
    expect(dayCellBalance(cal, 29)).toBe(0);
  });
});

describe("Calendar: empty and one-time-only states", () => {
  knownDefect(
    "UI-DISP-14",
    "With a starting balance and no transactions the calendar shows '—' for opening and closing instead of the balance",
    async () => {
      // observed: Opening "—", Closing "—" while Forecast shows Current Balance $5,000.
      const { page } = await renderPages(["calendar", "forecast"], {
        today: H1_TODAY,
        seed: { profile: { currentBalance: 5_000, initialBalance: 5_000 } },
      });
      expect(money(page("forecast"), "Current Balance")).toBe(5_000); // precondition
      expect(moneyOrNull(page("calendar"), "Opening", { occurrence: 0 })).toBe(5_000);
      expect(moneyOrNull(page("calendar"), "Closing", { occurrence: 0 })).toBe(5_000);
    }
  );

  it("brand-new user (no profile doc, no data): everything prints zero in the default PHP currency", async () => {
    const { page } = await renderPages(["calendar", "dashboard"], {
      today: H1_TODAY,
      seed: { profile: null },
    });
    const cal = page("calendar");
    expect(money(cal, "Income", { occurrence: 0 })).toBe(0);
    expect(Math.abs(money(cal, "Expenses", { occurrence: 0 }))).toBe(0); // prints "-₱0"
    expect(card(cal, "Income").textContent).toContain("₱");
    expect(within(cal).getByText("Transactions (0)")).toBeInTheDocument();
    expect(money(card(page("dashboard"), "Period Summary"), "Current Balance")).toBe(0);
  });

  it("only one-time items: calendar month tiles and range list contain exactly those items", async () => {
    // one-time income 500 on Mar 20 (manual) and a one-time expense rule 120 on Mar 22
    const { page } = await renderPages(["calendar"], {
      today: H1_TODAY,
      seed: {
        profile: { currentBalance: 1_000, initialBalance: 1_000 },
        transactions: [manual("Refund", "income", 500, "2026-03-20")],
        expenseRules: [
          makeExpenseRule({
            id: "once",
            name: "Passport",
            expenseType: "one-time",
            frequency: "one-time",
            amount: 120,
            startDate: "2026-03-22",
          }),
        ],
      },
    });
    const cal = page("calendar");
    expect(money(cal, "Income", { occurrence: 0 })).toBe(500);
    expect(money(cal, "Expenses", { occurrence: 0 })).toBe(-120);
    expect(money(cal, "Net Change", { occurrence: 0 })).toBe(380);
    // no history: opening 1,000 (nothing completed), closing 1,000 + 500 - 120 = 1,380
    expect(money(cal, "Opening", { occurrence: 0 })).toBe(1_000);
    expect(money(cal, "Closing", { occurrence: 0 })).toBe(1_380);
    expect(screen.queryByText("NaN")).toBeNull();
  });
});
