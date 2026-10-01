import { describe, expect, it, vi } from "vitest";
import { renderApp, screen, within } from "../harness";

vi.setConfig({ testTimeout: 90_000 });

/**
 * MANUAL-L5 on the calendar: "Start of week = Monday" left the grid starting on Sunday.
 * October 2026 starts on a Thursday: Sunday-first it has 4 leading September days (Sep 27-30),
 * Monday-first 3 (Sep 28-30).
 */

const TODAY = "2026-10-01";

const headerRow = (): string[] => {
  const grids = document.querySelectorAll<HTMLElement>("div.grid-cols-7");
  // the first 7-column grid is the weekday header row
  return Array.from(grids[0].children).map((cell) => within(cell as HTMLElement).getAllByText(/\S/)[0].textContent ?? "");
};

const firstCellDay = (): string => {
  const cell = document.querySelector<HTMLElement>("div.grid-cols-7 > div.cursor-pointer")!;
  return cell.textContent?.match(/\d+/)?.[0] ?? "";
};

describe("calendar honours Start of Week", () => {
  it("Monday: the header starts on Mon and the grid starts on Mon 28 Sep", async () => {
    await renderApp({ route: "/calendar", today: TODAY, seed: { profile: { preferences: { startOfWeek: 1 } } } });
    await screen.findByText("October 2026");
    expect(headerRow()).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(firstCellDay()).toBe("28");
  });

  it("Sunday (the default): the header starts on Sun and the grid starts on Sun 27 Sep", async () => {
    await renderApp({ route: "/calendar", today: TODAY, seed: { profile: { preferences: { startOfWeek: 0 } } } });
    await screen.findByText("October 2026");
    expect(headerRow()).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(firstCellDay()).toBe("27");
  });
});
