import { describe, expect, it } from "vitest";
import * as React from "react";
import {
  act,
  renderApp,
  screen,
  within,
  waitFor,
  knownDefect,
  makeCompletedTransaction,
  makeFakeUser,
  makeManualTransaction,
} from "../harness";
import { Screens, pickOption, screenEl, settingsComputedCount } from "./support";

/**
 * Settings page behaviours that are neither balance arithmetic nor a single collection:
 * loading / auth gating, unsaved-form handling, transient messages, wording, robustness
 * against profiles written by earlier versions of the app.
 */

const TODAY = "2026-01-15";

describe("loading and access", () => {
  it("with loading not awaited, Settings still ends up showing the stored balance (never the new-user default)", async () => {
    // (renderApp's act() flushes the fake auth/profile microtasks, so the transient spinner is not
    // observable here; that is a harness property, not an app defect.)
    const app = await renderApp({
      route: "/settings",
      today: TODAY,
      waitForReady: false,
      seed: { profile: { currentBalance: 4_321.5, initialBalance: 4_321.5 } },
    });
    await app.advance(1000);
    await waitFor(() => expect(screen.getByText("Balance Management")).toBeInTheDocument());
    expect(screen.queryByText("Loading settings...")).not.toBeInTheDocument();
    expect(within(screenEl("settings")).getByText("Current").parentElement!.textContent).toContain("4,321.50");
  });

  it("a signed-out visitor to /settings is redirected and never sees a balance", async () => {
    const app = await renderApp({
      route: "/settings",
      layout: true,
      user: null,
      seed: { profile: { currentBalance: 4_321.5, initialBalance: 4_321.5 } },
    });
    await waitFor(() => expect(app.router.push).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("Balance Management")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("4,321");
  });
});

describe("transient messages", () => {
  it("the balance success message disappears by itself after three seconds", async () => {
    const app = await renderApp({ route: "/settings", today: TODAY });
    await app.user.click(screen.getByRole("button", { name: /Override Current Balance/ }));
    await app.user.type(screen.getByLabelText("Override Current Balance"), "1");
    await app.user.click(screen.getByRole("button", { name: "Override Balance" }));
    expect(await screen.findByText("Balance updated successfully!")).toBeInTheDocument();
    await app.advance(2_500);
    expect(screen.getByText("Balance updated successfully!")).toBeInTheDocument();
    await app.advance(1_000);
    expect(screen.queryByText("Balance updated successfully!")).not.toBeInTheDocument();
  });

  it("a failed balance write is reported and the stored balance is unchanged", async () => {
    const app = await renderApp({ route: "/settings", today: TODAY, seed: { profile: { currentBalance: 700, initialBalance: 700 } } });
    const { updateDoc } = await import("firebase/firestore");
    (updateDoc as unknown as import("vitest").Mock).mockRejectedValueOnce(new Error("Write rejected"));
    await app.user.click(screen.getByRole("button", { name: /Override Current Balance/ }));
    await app.user.type(screen.getByLabelText("Override Current Balance"), "1");
    await app.user.click(screen.getByRole("button", { name: "Override Balance" }));
    expect(await screen.findByText("Write rejected")).toBeInTheDocument();
    expect(screen.queryByText("Balance updated successfully!")).not.toBeInTheDocument();
    expect(app.store.__get<{ currentBalance: number }>("users", app.uid)?.currentBalance).toBe(700);
  });
});

describe("wording", () => {
  knownDefect(
    "UI-BAL-45",
    "'Computed from 1 transactions' (singular count, plural noun)",
    async () => {
      await renderApp({
        route: "/settings",
        today: TODAY,
        seed: {
          profile: { currentBalance: 9_900, initialBalance: 10_000 },
          transactions: [makeCompletedTransaction({ id: "a", projectedAmount: 100, scheduledDate: "2026-01-05" })],
        },
      });
      expect(settingsComputedCount(screenEl("settings"))).toBe(1); // exactly one completed row
      expect(screen.getByText(/^Computed from 1 transaction/).textContent).toBe("Computed from 1 transaction");
    }
  );
});

describe("the Preferences form and live profile updates", () => {
  knownDefect(
    "UI-BAL-46",
    "any profile update (here: a balance override) silently throws away unsaved Preferences edits",
    async () => {
      // observed: Currency EUR (unsaved) snaps back to USD and 'Save Preferences' vanishes after an override
      const app = await renderApp({ ui: <Screens only={["settings"]} />, today: TODAY });
      await pickOption(app, screenEl("settings"), /^Currency$/, "EUR");
      expect(screen.getByLabelText("Currency").textContent).toContain("EUR"); // precondition: the edit is there
      await app.user.click(screen.getByRole("button", { name: /Override Current Balance/ }));
      await app.user.type(screen.getByLabelText("Override Current Balance"), "5");
      await app.user.click(screen.getByRole("button", { name: "Override Balance" }));
      await screen.findByText("Balance updated successfully!");
      await app.settle();
      expect(app.store.__get<{ currentBalance: number }>("users", app.uid)?.currentBalance).toBe(5); // the override landed
      expect(screen.getByLabelText("Currency").textContent).toContain("EUR");
    },
    40_000
  );

  it("a preference changed elsewhere is reflected in an untouched form", async () => {
    const app = await renderApp({ route: "/settings", today: TODAY });
    expect(screen.getByLabelText("Currency").textContent).toContain("USD");
    const { updateDoc, doc } = await import("firebase/firestore");
    await act(async () => {
      await updateDoc(doc(null as never, "users", app.uid), {
        preferences: { currency: "GBP", dateFormat: "YYYY-MM-DD", startOfWeek: 0, theme: "dark", defaultWarningThreshold: 500 },
      });
    });
    await app.settle();
    expect(screen.getByLabelText("Currency").textContent).toContain("GBP");
    expect(screen.queryByRole("button", { name: "Save Preferences" })).not.toBeInTheDocument();
  });
});

describe("profiles written by earlier versions of the app", () => {
  knownDefect(
    "UI-BAL-47",
    "a profile document without a `preferences` map crashes the whole app as soon as any transaction exists",
    async () => {
      // observed: TypeError: Cannot read properties of undefined (reading 'defaultWarningThreshold')
      // (useDailyBalances / Calendar dereference profile.preferences unguarded, while Settings and
      // useCurrency already fall back to defaults for the same field).
      const app = await renderApp({ route: "/settings", user: null, today: TODAY });
      app.store.__seed("users", "user-1", {
        uid: "user-1",
        email: "test@example.com",
        displayName: "Old Timer",
        currentBalance: 100,
        initialBalance: 100,
        balanceLastUpdatedAt: "2026-01-01",
      });
      app.store.__seed("transactions", "t", makeManualTransaction({ id: "t", status: "skipped", scheduledDate: "2026-01-02" }));
      let crashed: unknown;
      try {
        await act(async () => {
          app.auth.__setUser(makeFakeUser());
        });
        await app.advance(1000);
        await app.settle();
      } catch (e) {
        crashed = e;
      }
      expect(crashed, "the app crashed while loading the profile").toBeUndefined();
      expect(screen.getByText("Balance Management")).toBeInTheDocument();
    },
    40_000
  );

  it("a profile with preferences but no warning threshold falls back to a threshold instead of crashing", async () => {
    const app = await renderApp({ route: "/settings", user: null, today: TODAY });
    app.store.__seed("users", "user-1", {
      uid: "user-1",
      email: "test@example.com",
      displayName: "Old Timer",
      currentBalance: 100,
      initialBalance: 100,
      balanceLastUpdatedAt: "2026-01-01",
      preferences: { currency: "USD", dateFormat: "YYYY-MM-DD", startOfWeek: 0, theme: "dark" },
    });
    app.store.__seed("transactions", "t", makeManualTransaction({ id: "t", status: "skipped", scheduledDate: "2026-01-02" }));
    await act(async () => {
      app.auth.__setUser(makeFakeUser());
    });
    await app.advance(1000);
    await app.settle();
    expect(screen.getByText("Balance Management")).toBeInTheDocument();
    // the form shows a usable default rather than an empty box
    expect((screen.getByLabelText("Low Balance Warning Threshold") as HTMLInputElement).value).not.toBe("");
  }, 40_000);
});
