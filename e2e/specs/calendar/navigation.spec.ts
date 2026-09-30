/**
 * Month / week navigation, year boundaries, month-end and month-start paydays, balance chaining.
 * Runs in UTC, Asia/Manila and America/New_York.
 *
 * Fixture: currentBalance 1000, today Tue 2026-03-10.
 *   First  +100 monthly on the 1st,  start 2026-01-01
 *   Last   +10  monthly on the 31st (clamped to the month's last day), start 2026-01-31
 * Hand values (each month adds 110, nothing completed, the past months are overdue-but-projected and
 * therefore counted, per README):
 *   Jan opens 1000 closes 1110 | Feb 1110 -> 1220 | Mar 1220 -> 1330 | Apr 1330 -> 1440
 *   May 1440 -> 1550 | Jun 1550 -> 1660 | Jul 1660 -> 1770 | Aug 1770 -> 1880
 * (Jan opens at 1000 because the view window starts on 2026-01-01.)
 */
import { test, expect, seedAndLogin, userProfile, incomeSource, knownDefect } from "../../index";
import {
  addDaysISO,
  daysShowing,
  monthCell,
  monthHeading,
  navigateToMonth,
  nextButton,
  periodFigure,
  prevButton,
  sidebar,
  summaryTile,
  viewedHeading,
  weekCell,
  weekChipNames,
} from "./_support";

test.use({ viewport: { width: 1440, height: 1500 } });

const boot = async (page: import("@playwright/test").Page) => {
  await seedAndLogin(
    page,
    {
      user: userProfile({ currentBalance: 1000, initialBalance: 1000 }),
      incomeSources: [
        incomeSource({ id: "first", name: "First", amount: 100, frequency: "monthly", scheduleConfig: { dayOfMonth: 1 }, startDate: "2026-01-01" }),
        incomeSource({ id: "last", name: "Last", amount: 10, frequency: "monthly", scheduleConfig: { dayOfMonth: 31 }, startDate: "2026-01-31" }),
      ],
    },
    { path: "/calendar" }
  );
  await expect(viewedHeading(page)).toHaveText("March 2026");
};

const FIGURES: Record<string, [string, string]> = {
  "2026-01": ["$1,000", "$1,110"],
  "2026-02": ["$1,110", "$1,220"],
  "2026-03": ["$1,220", "$1,330"],
  "2026-04": ["$1,330", "$1,440"],
  "2026-05": ["$1,440", "$1,550"],
  "2026-06": ["$1,550", "$1,660"],
  "2026-07": ["$1,660", "$1,770"],
  "2026-08": ["$1,770", "$1,880"],
};

test("March: the 1st (a Sunday) and the 31st are both drawn, in every timezone", async ({ page }) => {
  await boot(page);
  expect(await daysShowing(page, "2026-03", "First")).toEqual(["2026-03-01"]);
  expect(await daysShowing(page, "2026-03", "Last")).toEqual(["2026-03-31"]);
  await expect(periodFigure(page, "Opening")).toHaveText("$1,220");
  await expect(periodFigure(page, "Closing")).toHaveText("$1,330");
});

test("walking back from March to January and forward to May: paydays on the 1st are never dropped and balances chain", async ({ page }) => {
  await boot(page);
  let prev = "2026-03";
  for (const m of ["2026-02", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]) {
    await navigateToMonth(page, prev, m);
    prev = m;
    expect(await daysShowing(page, m, "First"), `First in ${m}`).toEqual([`${m}-01`]);
    await expect(periodFigure(page, "Opening"), `${m} opening`).toHaveText(FIGURES[m][0]);
    await expect(periodFigure(page, "Closing"), `${m} closing`).toHaveText(FIGURES[m][1]);
    await expect(summaryTile(page, "Income"), `${m} income`).toHaveText("+$110");
  }
});

test("month-start paydays keep appearing on months beyond the initial window (Jun..Aug), in every timezone", async ({ page }) => {
  await boot(page);
  let prev = "2026-03";
  for (const m of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]) {
    await navigateToMonth(page, prev, m);
    prev = m;
    expect(await daysShowing(page, m, "First"), `First in ${m}`).toEqual([`${m}-01`]);
    await expect(periodFigure(page, "Opening"), `${m} opening`).toHaveText(FIGURES[m][0]);
  }
});

test("the last day of every month is drawn and closing balances chain (Jun..Aug)", async ({ page }, testInfo) => {
  if (testInfo.project.name === "America/New_York") {
    knownDefect(
      "E2E-CAL-13",
      "America/New_York: month-end items and the Closing figure vanish for any month whose end is the edge of the view window (June, and every month reached beyond it): Jun 30 'Last' missing, Closing shows a dash"
    );
  }
  await boot(page);
  let prev = "2026-03";
  const lastDays: Record<string, string> = { "2026-06": "2026-06-30", "2026-07": "2026-07-31", "2026-08": "2026-08-31" };
  await navigateToMonth(page, prev, "2026-06");
  prev = "2026-06";
  for (const m of ["2026-06", "2026-07", "2026-08"]) {
    if (m !== prev) {
      await navigateToMonth(page, prev, m);
      prev = m;
    }
    expect(await daysShowing(page, m, "Last"), `Last in ${m}`).toEqual([lastDays[m]]);
    await expect(periodFigure(page, "Closing"), `${m} closing`).toHaveText(FIGURES[m][1]);
  }
});

test("year boundary: December 2026 -> January 2027 -> back, headings, weekday alignment and chained balances", async ({ page }) => {
  await boot(page);
  await navigateToMonth(page, "2026-03", "2026-12");
  await expect(periodFigure(page, "Opening")).toHaveText("$2,210"); // Mar opens 1220; +110 per month for Mar..Nov = 9 * 110 = 990 => 2210
  await nextButton(page).click();
  await expect(viewedHeading(page)).toHaveText("January 2027");
  // Jan 1 2027 is a Friday: 5 leading cells (Dec 27..31) then the 1st is the 6th cell.
  expect(await daysShowing(page, "2027-01", "First")).toEqual(["2027-01-01"]);
  await expect(monthCell(page, "2027-01", "2027-01-01")).toContainText("1");
  // Dec closing == Jan opening: Dec opens 2210, closes 2320.
  await expect(periodFigure(page, "Opening")).toHaveText("$2,320");
  await prevButton(page).click();
  await expect(viewedHeading(page)).toHaveText("December 2026");
  await expect(periodFigure(page, "Closing")).toHaveText("$2,320");
});

test("week view: previous/next cross a month boundary, Today returns to the current week and selects today", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(viewedHeading(page)).toHaveText("Mar 8 - Mar 14, 2026");
  await nextButton(page).click();
  await nextButton(page).click();
  await nextButton(page).click(); // Mar 29 .. Apr 4
  await expect(viewedHeading(page)).toHaveText("Mar 29 - Apr 4, 2026");
  expect(await weekChipNames(weekCell(page, "2026-03-31"))).toEqual(["Last"]);
  expect(await weekChipNames(weekCell(page, "2026-04-01"))).toEqual(["First"]);
  // Mar 29 opening = 1000 + Jan(110) + Feb(110) + Mar 1 (100) = 1320; + Mar 31 (10) + Apr 1 (100) = 1430.
  await expect(periodFigure(page, "Opening")).toHaveText("$1,320");
  await expect(periodFigure(page, "Closing")).toHaveText("$1,430");
  await prevButton(page).click();
  await prevButton(page).click();
  await prevButton(page).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(viewedHeading(page)).toHaveText("Mar 8 - Mar 14, 2026");
  await expect(sidebar(page)).toContainText("Tuesday, Mar 10");
});

test("month heading and the 42-cell grid are consistent for every month of 2026", async ({ page }) => {
  await boot(page);
  await navigateToMonth(page, "2026-03", "2026-01");
  for (let m = 1; m <= 12; m++) {
    const key = `2026-${String(m).padStart(2, "0")}`;
    await expect(viewedHeading(page)).toHaveText(monthHeading(key));
    // The cell for the 1st exists at its weekday offset and shows the number "1" as its first token.
    const cellText = await monthCell(page, key, `${key}-01`).innerText();
    expect(cellText.trim().split(/\s+/)[0]).toBe("1");
    const lastDay = addDaysISO(`${m === 12 ? 2027 : 2026}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
    const lastText = await monthCell(page, key, lastDay).innerText();
    expect(lastText.trim().split(/\s+/)[0]).toBe(String(Number(lastDay.slice(8))));
    if (m < 12) await nextButton(page).click();
  }
});
