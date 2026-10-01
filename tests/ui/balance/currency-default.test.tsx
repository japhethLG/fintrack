import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderApp, screen, within } from "../harness";
import { Screens, screenEl } from "./support";

/**
 * The default currency is PHP (user decision). It applies to a brand-new profile and to a legacy profile
 * whose currency is missing, empty or not one we support; every amount renders through the one formatter,
 * so no screen falls back to "$".
 *
 * Expected strings are hand-derived: 1,234.5 in PHP is "₱1,234.50" (2 decimals, comma groups).
 */

const TODAY = "2026-01-15";

const dashboardBalance = () =>
  within(screenEl("dashboard")).getByText("Current Balance").parentElement!.parentElement!.textContent!;
const settingsBalance = () =>
  within(screenEl("settings")).getByText("Current").parentElement!.textContent!;

describe("default currency is PHP", () => {
  it("a brand-new user (no profile document yet) gets PHP and sees pesos", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: TODAY,
      seed: { profile: null },
    });
    expect(app.store.__get<{ preferences: { currency: string } }>("users", "user-1")?.preferences.currency).toBe(
      "PHP"
    );
    expect(dashboardBalance()).toContain("₱0.00");
    expect(settingsBalance()).toContain("₱0.00");
  }, 30_000);

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["unsupported", "XYZ"],
    ["lower-case", "usd"],
  ])("a legacy profile with a %s currency prints pesos on Settings, Dashboard and the inputs", async (_name, currency) => {
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: TODAY,
      seed: {
        profile: {
          currentBalance: 1_234.5,
          initialBalance: 1_234.5,
          preferences: { currency: currency as unknown as string },
        },
      },
    });
    // precondition: the profile really was stored without a usable currency
    expect(app.store.__get<{ preferences: { currency?: string } }>("users", "user-1")?.preferences.currency).toBe(
      currency
    );
    expect(dashboardBalance()).toContain("₱1,234.50");
    expect(settingsBalance()).toContain("₱1,234.50");
    expect(dashboardBalance()).not.toContain("$");
    expect(settingsBalance()).not.toContain("$");

    // the Settings picker shows PHP rather than an empty or invalid value
    expect(within(screenEl("settings")).getByLabelText(/^Currency$/).textContent).toContain("PHP");

    // input prefixes follow the currency (no hard-coded symbol)
    await app.user.click(screen.getByRole("button", { name: /Override Current Balance/ }));
    const override = screen.getByLabelText("Override Current Balance");
    expect(override.parentElement!.textContent).toContain("₱");
    expect(override.parentElement!.textContent).not.toContain("$");
  }, 30_000);
});
