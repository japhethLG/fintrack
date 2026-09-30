import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  renderApp,
  resolveNow,
  screen,
  waitFor,
  blockedRequests,
  moneyIn,
  moneyNear,
  moneyValues,
  parseMoney,
  makeIncomeSource,
} from "./harness";

/**
 * Tests OF the harness. If a spec author changes anything under
 * tests/ui/harness/ these must stay green.
 */

describe("parseMoney / moneyValues (independent of app/lib/utils/currency)", () => {
  const CASES: [string, number][] = [
    ["$1,234.56", 1234.56],
    ["$0", 0],
    ["-$50", -50],
    ["\u2212$5.25", -5.25], // unicode minus
    ["$-7", -7],
    ["+$1,200.00", 1200],
    ["\u20b110,000.00", 10000],
    ["\u00a399", 99],
    ["\u00a51,500", 1500],
    ["\u20b91,23,456.50", 123456.5], // en-IN grouping
    ["A$12.5", 12.5],
    ["C$3", 3],
    ["US$4,000.00", 4000],
    ["($1,234)", -1234], // accounting negative
    ["(+$1,000)", 1000],
    ["$1.2K", 1200],
    ["$3M", 3_000_000],
    ["$ 42", 42],
    ["-$1,600.00 expenses", -1600],
  ];
  // Plain loop, not it.each: vitest title formatting mangles "$" in names.
  for (const [text, expected] of CASES) {
    it(`parses ${JSON.stringify(text)} as ${expected}`, () => {
      expect(parseMoney(text)).toBe(expected);
    });
  }

  it("reads the European (de-DE) layout only when told the decimal separator", () => {
    expect(parseMoney("€1.234,56", { currency: "EUR" })).toBe(1234.56);
    expect(parseMoney("€1.234,56", { decimal: "," })).toBe(1234.56);
  });

  it("returns null for text with no amount, and accepts a bare number only when it is the whole string", () => {
    expect(parseMoney("Net Flow")).toBeNull();
    expect(parseMoney("12 completed, 3 projected")).toBeNull();
    expect(parseMoney("1,200.5")).toBe(1200.5);
  });

  it("does not mistake a following word for a K/M/B suffix", () => {
    expect(moneyValues("$5 Bills due")).toEqual([5]);
    expect(moneyValues("$5K Bills")).toEqual([5000]);
  });

  it("returns every token in reading order", () => {
    expect(moneyValues("Opening $10,000 Closing -$2,500.50 (+$1,000)")).toEqual([
      10000, -2500.5, 1000,
    ]);
  });
});

describe("moneyNear", () => {
  const build = (html: string) => {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  };

  it("finds the amount in a sibling element of the label", () => {
    const root = build(`<div><p>Balance</p><h2>$10,000.00</h2></div>`);
    expect(moneyNear("Balance", { within: root })).toBe(10000);
  });

  it("does not pick up an amount that precedes the label", () => {
    const root = build(
      `<section><div><p>Other</p><b>$1</b></div><div><p>Target</p><b>$2</b></div></section>`
    );
    expect(moneyNear("Target", { within: root })).toBe(2);
  });

  it("honours index and occurrence", () => {
    const root = build(
      `<div><div><p>Budgeted</p><b>$3,100</b></div><div><p>Budgeted</p><b>$1,240</b></div><span>Range</span><i>$1</i><i>$2</i></div>`
    );
    expect(moneyNear("Budgeted", { within: root, occurrence: 1 })).toBe(1240);
    expect(moneyNear("Range", { within: root, index: 1 })).toBe(2);
  });

  it("throws (never returns 0) when the label or the amount is missing", () => {
    const root = build(`<div><p>Label</p><p>no numbers here</p></div>`);
    expect(() => moneyNear("Nope", { within: root })).toThrow(/no element with text/);
    expect(() => moneyNear("Label", { within: root, maxDepth: 0 })).toThrow(/no money amount/);
  });

  it("moneyIn returns all amounts inside an element", () => {
    const root = build(`<div><span>Rent</span><span>-$1,200.00</span><span>Jan 18</span></div>`);
    expect(moneyIn(root)).toEqual([-1200]);
  });
});

describe("clock", () => {
  it("resolveNow: a bare date is local noon, a local datetime is exact, a Date passes through", () => {
    const noon = resolveNow("2026-02-03");
    expect([noon.getFullYear(), noon.getMonth(), noon.getDate(), noon.getHours()]).toEqual([
      2026, 1, 3, 12,
    ]);
    const exact = resolveNow("2026-02-03T00:30");
    expect([exact.getDate(), exact.getHours(), exact.getMinutes()]).toEqual([3, 0, 30]);
    const passthrough = new Date(2020, 5, 6, 7, 8);
    expect(resolveNow(passthrough).getTime()).toBe(passthrough.getTime());
    expect(() => resolveNow("not a date")).toThrow(/cannot parse/);
  });

  it("the default zone matches the run's configuration (UTC unless UI_TEST_TZ)", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(process.env.UI_TEST_TZ || "UTC");
  });

  it("renderApp({ timeZone }) switches the zone for one test...", async () => {
    await renderApp({ route: "/dashboard", timeZone: "Asia/Manila", today: "2026-01-15T00:30" });
    expect(new Date().getTimezoneOffset()).toBe(-480);
    expect(new Date().getHours()).toBe(0);
    expect(new Date().getDate()).toBe(15);
  });

  it("...and setup.ts restores the configured zone for the next one", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(process.env.UI_TEST_TZ || "UTC");
  });
});

describe("store isolation", () => {
  it("seeds are visible to the app...", async () => {
    const app = await renderApp({
      route: "/income",
      seed: { incomeSources: [makeIncomeSource({ id: "leak-check", name: "Leak Check Inc" })] },
    });
    expect(app.store.__count("income_sources")).toBe(1);
    expect(screen.getAllByText("Leak Check Inc").length).toBeGreaterThan(0);
  });

  it("...and never leak into the next test (store, DOM, listeners)", async () => {
    expect(screen.queryByText("Leak Check Inc")).not.toBeInTheDocument();
    const app = await renderApp({ route: "/income" });
    expect(app.store.__count("income_sources")).toBe(0);
    expect(app.financial().incomeSources).toEqual([]);
  });
});

describe("auth fake", () => {
  it("a brand-new user (no profile doc) gets the app's default profile created by the REAL AuthProvider", async () => {
    const app = await renderApp({
      route: "/settings",
      seed: { profile: null },
      user: { uid: "fresh", email: "fresh@example.com", displayName: "Fresh" },
    });
    const created = app.store.__get<{ preferences: { currency: string }; currentBalance: number }>(
      "users",
      "fresh"
    );
    expect(created).toBeDefined();
    expect(created?.currentBalance).toBe(0);
    expect(created?.preferences.currency).toBe("PHP");
  });

  it("signing in through the real login page calls the SDK, then routes to the dashboard", async () => {
    const app = await renderApp({ route: "/login", user: null, layout: true });
    await app.user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await app.user.type(screen.getByLabelText("Password"), "hunter2!");
    await app.user.click(screen.getByRole("button", { name: "Sign In" }));
    await waitFor(() => expect(app.auth.__callsTo("signInWithEmailAndPassword")).toHaveLength(1));
    expect(app.auth.__callsTo("signInWithEmailAndPassword")[0].args).toEqual([
      "ana@example.com",
      "hunter2!",
    ]);
    await waitFor(() => expect(app.router.push).toHaveBeenCalledWith("/dashboard"));
    // The real AuthProvider reacted to the new user and created a profile.
    await waitFor(() => expect(app.authContext().user?.email).toBe("ana@example.com"));
    await waitFor(() => expect(app.store.__count("users")).toBe(1));
  });

  it("__failNext surfaces SDK errors through the page's own error handling", async () => {
    const app = await renderApp({ route: "/login", user: null, layout: true });
    app.auth.__failNext(
      "signInWithEmailAndPassword",
      new Error("Firebase: Error (auth/invalid-credential).")
    );
    await app.user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await app.user.type(screen.getByLabelText("Password"), "wrong");
    await app.user.click(screen.getByRole("button", { name: "Sign In" }));
    expect(await screen.findByText(/Invalid email or password/)).toBeInTheDocument();
    expect(app.router.push).not.toHaveBeenCalledWith("/dashboard");
  });

  it("signing out mid-test empties the financial context (listeners unsubscribed, state reset)", async () => {
    const app = await renderApp({
      route: "/dashboard",
      seed: { incomeSources: [makeIncomeSource()] },
    });
    expect(app.financial().incomeSources).toHaveLength(1);
    await app.settle();
    app.auth.__setUser(null);
    await waitFor(() => expect(app.financial().incomeSources).toEqual([]));
    expect(app.financial().userProfile).toBeNull();
  });
});

describe("network guard (belt and braces)", () => {
  it("blocks raw sockets to non-loopback hosts before any DNS/connect happens", () => {
    // `.invalid` cannot resolve; the guard must throw synchronously regardless.
    expect(() => net.connect({ port: 443, host: "example.invalid" })).toThrow(
      /NETWORK BLOCKED \(socket\)/
    );
    expect(() => new WebSocket("wss://example.invalid/")).toThrow(/NETWORK BLOCKED \(websocket\)/);
    expect(blockedRequests.map((r) => r.kind)).toEqual(["socket", "websocket"]);
    blockedRequests.length = 0; // deliberate probes, consumed
  });

  it("the AI and image services are stubbed (no key, no fetch)", async () => {
    const gemini = await import("@/lib/services/geminiService");
    const bb = await import("@/lib/services/imageBBService");
    expect(await gemini.fetchAvailableModels()).toEqual([]);
    expect(await bb.uploadToImageBB(new File(["x"], "x.png"))).toMatch(/invalid/);
    expect(blockedRequests).toHaveLength(0);
  });
});
