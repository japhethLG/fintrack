import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import dayjs from "dayjs";
import { makeManualTransaction, renderApp, screen, waitFor, within } from "../harness";
import { Settings } from "@/components/pages/settings";
import { TransactionsManager } from "@/components/pages/transactions";
import { DatePicker } from "@/components/common";
import { useDatePreferences } from "@/lib/hooks/useDatePreferences";
import { pickOption } from "../balance/support";

vi.setConfig({ testTimeout: 90_000 });

/**
 * MANUAL-L5: Settings > Date Format and Start of Week used to do nothing. Stored dates stay
 * YYYY-MM-DD; only what is printed changes.
 */

const TODAY = "2026-10-01";

const tx = () =>
  makeManualTransaction({
    id: "t1",
    name: "Concert",
    type: "expense",
    projectedAmount: 80,
    scheduledDate: "2026-10-03",
    status: "projected",
  });

/** What the calendar page is told to use: the labels row and the column of 1 Oct 2026 (a Thursday). */
const Probe: React.FC = () => {
  const p = useDatePreferences();
  return (
    <div>
      <p data-testid="labels">{p.weekdayLabels.join(",")}</p>
      <p data-testid="column">{p.weekColumn(new Date(2026, 9, 1))}</p>
      <p data-testid="weekstart">{p.formatDate(p.weekStart(new Date(2026, 9, 1)))}</p>
      <p data-testid="dayjs-week">{dayjs("2026-10-01").startOf("week").format("YYYY-MM-DD")}</p>
      <p data-testid="numeric">{p.formatDate("2026-10-03")}</p>
      <DatePicker label="Probe date" value="2026-10-03" />
    </div>
  );
};

describe("Date Format", () => {
  it("the Transactions list prints dates in the chosen order (DD/MM/YYYY: 03/10/2026)", async () => {
    await renderApp({
      route: "/transactions",
      today: TODAY,
      seed: { transactions: [tx()], profile: { preferences: { dateFormat: "DD/MM/YYYY" } } },
    });
    expect(await screen.findByText("Concert")).toBeInTheDocument();
    expect(screen.getByText("03/10/2026")).toBeInTheDocument();
    expect(screen.queryByText("10/03/2026")).toBeNull();
  });

  it("the default is MM/DD/YYYY", async () => {
    await renderApp({ route: "/transactions", today: TODAY, seed: { transactions: [tx()], profile: { preferences: { dateFormat: "MM/DD/YYYY" } } } });
    expect(await screen.findByText("10/03/2026")).toBeInTheDocument();
  });

  it("changing it in Settings is applied live to the other screens, and the stored date stays YYYY-MM-DD", async () => {
    const app = await renderApp({
      ui: (
        <>
          <section data-screen="settings">
            <Settings />
          </section>
          <section data-screen="tx">
            <TransactionsManager />
          </section>
        </>
      ),
      today: TODAY,
      seed: { transactions: [tx()], profile: { preferences: { dateFormat: "MM/DD/YYYY" } } },
    });
    const settings = document.querySelector<HTMLElement>('[data-screen="settings"]')!;
    const list = within(document.querySelector<HTMLElement>('[data-screen="tx"]')!);
    expect(await list.findByText("10/03/2026")).toBeInTheDocument();

    await pickOption(app, settings, /^Date Format$/, "DD/MM/YYYY");
    await app.user.click(within(settings).getByRole("button", { name: "Save Preferences" }));
    await within(settings).findByText("Preferences saved successfully!");

    await waitFor(() => expect(list.getByText("03/10/2026")).toBeInTheDocument());
    expect(app.store.__get<{ scheduledDate: string }>("transactions", "t1")?.scheduledDate).toBe("2026-10-03");
  });

  it("date pickers show and accept the chosen format", async () => {
    await renderApp({
      ui: <Probe />,
      today: TODAY,
      seed: { profile: { preferences: { dateFormat: "DD/MM/YYYY" } } },
    });
    expect((screen.getByLabelText("Probe date") as HTMLInputElement).value).toBe("03/10/2026");
    expect(screen.getByTestId("numeric").textContent).toBe("03/10/2026");
  });
});

describe("Start of Week (the contract the calendar page uses)", () => {
  it("Sunday (default): headers Sun..Sat, 1 Oct 2026 (Thursday) is column 4, the week starts 27 Sep", async () => {
    await renderApp({
      ui: <Probe />,
      today: TODAY,
      seed: { profile: { preferences: { dateFormat: "MM/DD/YYYY", startOfWeek: 0 } } },
    });
    expect(screen.getByTestId("labels").textContent).toBe("Sun,Mon,Tue,Wed,Thu,Fri,Sat");
    expect(screen.getByTestId("column").textContent).toBe("4");
    expect(screen.getByTestId("weekstart").textContent).toBe("09/27/2026");
  });

  it("Monday: headers Mon..Sun, 1 Oct is column 3, the week starts 28 Sep; dayjs and the pickers follow", async () => {
    await renderApp({
      ui: <Probe />,
      today: TODAY,
      seed: { profile: { preferences: { dateFormat: "MM/DD/YYYY", startOfWeek: 1 } } },
    });
    expect(screen.getByTestId("labels").textContent).toBe("Mon,Tue,Wed,Thu,Fri,Sat,Sun");
    expect(screen.getByTestId("column").textContent).toBe("3");
    expect(screen.getByTestId("weekstart").textContent).toBe("09/28/2026");
    await waitFor(() => expect(screen.getByTestId("dayjs-week").textContent).toBe("2026-09-28"));
  });
});
