/**
 * `renderApp` — mount the REAL app (providers + page) in jsdom against the
 * in-memory Firestore.
 *
 *   const app = await renderApp({
 *     route: "/dashboard",
 *     today: "2026-01-15",
 *     seed: { incomeSources: [makeIncomeSource({ name: "Salary" })] },
 *   });
 *   expect(app.getByText("Salary")).toBeInTheDocument();
 *   await app.user.click(app.getByRole("button", { name: /save/i }));
 *   expect(app.store.__all("income_sources")).toHaveLength(2);
 *
 * What is real: AuthProvider, FinancialProvider (subscriptions, projection
 * merger, daily balances, bill coverage), ModalProvider (+ lazy modals), the
 * page component, all of `app/lib/firebase/firestore/*`.
 * What is fake: `firebase/firestore` (in-memory), `firebase/auth`, the
 * Firebase config module, next/navigation|image|link, Gemini and ImageBB.
 */
import * as React from "react";
import { act, render, waitFor, type RenderResult } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { vi } from "vitest";

import { Providers } from "@/providers";
import { useAuth } from "@/contexts/AuthContext";
import { useFinancial } from "@/contexts/FinancialContext";
import { useModal } from "@/components/modals";
import { componentMap } from "@/components/modals/utils";
import type { FinancialContextValue } from "@/contexts/FinancialContext/types";
import type {
  Alert,
  BalanceSnapshot,
  ExpenseRule,
  IncomeSource,
  Transaction,
  UserProfile,
} from "@/lib/types";

import * as store from "../../helpers/firestoreEmulator";
import { makeUserProfile } from "../../helpers/builders";
import * as authFake from "./authFake";
import { type FakeUser, makeFakeUser } from "./authFake";
import { router, __setRoute } from "./router";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** What gets written into the in-memory Firestore before the app mounts. */
export interface AppSeed {
  /**
   * The signed-in user's profile document (`users/{uid}`).
   *   - omitted   -> `makeUserProfile()` for the signed-in user (USD, 10,000)
   *   - object    -> merged over that default (`{ currentBalance: 250 }`)
   *   - null      -> NO profile doc; the real AuthProvider then creates the
   *                  app's brand-new-user default (PHP, balance 0)
   */
  profile?:
    | (Omit<Partial<UserProfile>, "preferences"> & {
        preferences?: Partial<UserProfile["preferences"]>;
      })
    | null;
  incomeSources?: IncomeSource[];
  expenseRules?: ExpenseRule[];
  /** STORED transactions (completed / skipped / manual). Projections are derived. */
  transactions?: Transaction[];
  alerts?: Alert[];
  balanceHistory?: BalanceSnapshot[];
}

export interface RenderAppOptions {
  /** App route to mount, e.g. "/dashboard?x=1". Default "/dashboard". */
  route?: string;
  /**
   * Render this element inside the real providers INSTEAD of the route's page
   * (component-level tests: a form, a widget, a hook host).
   */
  ui?: React.ReactElement;
  /**
   * The frozen "now". "YYYY-MM-DD" means LOCAL 12:00 that day (default
   * "2026-01-15"); pass a Date, or an ISO/`YYYY-MM-DDTHH:mm` string, for an
   * exact instant (e.g. local midnight to probe day-boundary bugs).
   */
  today?: string | Date;
  /** Data to persist before mount. */
  seed?: AppSeed;
  /**
   * Signed-in user. Default `makeFakeUser()` (uid "user-1"). `null` mounts
   * signed out.
   */
  user?: Partial<FakeUser> | null;
  /**
   * Run this test in an IANA time zone (e.g. "Asia/Manila", "America/Los_Angeles")
   * regardless of the config's default. Applied by assigning `process.env.TZ`
   * (Node re-reads it immediately) and restored after the test by setup.ts.
   * `today: "YYYY-MM-DD"` is interpreted in THIS zone. Default: the run's zone
   * (UTC, or `UI_TEST_TZ`).
   */
  timeZone?: string;
  /**
   * Also wrap the page in its real route-group layout (`(protected)/layout`
   * = ProtectedRoute + Sidebar + MobileNav; `(auth)/layout` for /login,
   * /signup). Default false: navigation chrome duplicates text and links.
   */
  layout?: boolean;
  /** Skip waiting for the contexts to finish loading (rare: loading-state tests). */
  waitForReady?: boolean;
}

export interface AppHandle extends RenderResult {
  /** user-event instance already wired to the fake clock. */
  user: UserEvent;
  /** The in-memory Firestore module — `store.__get(col, id)`, `store.__all(col)`, `store.__ops`… */
  store: typeof store;
  /** The fake `firebase/auth` module — `auth.__setUser(...)`, `auth.__callsTo("signOut")`… */
  auth: typeof authFake;
  /** The fake router — `router.push` etc. are `vi.fn()` spies. */
  router: typeof router;
  /** Latest FinancialContext value (fresh on every call — never cache it). */
  financial: () => FinancialContextValue;
  /** Latest AuthContext value. */
  authContext: () => ReturnType<typeof useAuth>;
  /** Open one of the app's modals exactly as a page would. */
  openModal: ReturnType<typeof useModal>["openModal"];
  /** Advance the fake clock by `ms` inside act(). */
  advance: (ms: number) => Promise<void>;
  /** Flush pending promises/effects/timers (call after a store write to let listeners re-render). */
  settle: () => Promise<void>;
  /** Move the fake "now" (e.g. to cross a day boundary mid-test). */
  setToday: (today: string | Date) => Promise<void>;
  /** The resolved frozen instant. */
  now: Date;
  /** Resolved uid of the signed-in user ("" when signed out). */
  uid: string;
}

// ---------------------------------------------------------------------------
// Route table (dynamic imports keep unrelated pages out of a spec's module graph)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loader = () => Promise<{ default: React.ComponentType<any> }>;

const ROUTES: Record<string, { page: Loader; layout?: Loader }> = {
  "/": { page: () => import("@/page") },
  "/login": { page: () => import("@/(auth)/login/page"), layout: () => import("@/(auth)/layout") },
  "/signup": {
    page: () => import("@/(auth)/signup/page"),
    layout: () => import("@/(auth)/layout"),
  },
  "/dashboard": {
    page: () => import("@/(protected)/dashboard/page"),
    layout: () => import("@/(protected)/layout"),
  },
  "/income": {
    page: () => import("@/(protected)/income/page"),
    layout: () => import("@/(protected)/layout"),
  },
  "/expenses": {
    page: () => import("@/(protected)/expenses/page"),
    layout: () => import("@/(protected)/layout"),
  },
  "/forecast": {
    page: () => import("@/(protected)/forecast/page"),
    layout: () => import("@/(protected)/layout"),
  },
  "/calendar": {
    page: () => import("@/(protected)/calendar/page"),
    layout: () => import("@/(protected)/layout"),
  },
  "/transactions": {
    page: () => import("@/(protected)/transactions/page"),
    layout: () => import("@/(protected)/layout"),
  },
  "/settings": {
    page: () => import("@/(protected)/settings/page"),
    layout: () => import("@/(protected)/layout"),
  },
};

/** Every route `renderApp` can mount. */
export const APP_ROUTES = Object.keys(ROUTES);

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export const DEFAULT_TODAY = "2026-01-15";

/** `useFinancialSubscriptions` flips its loading flags on a literal setTimeout(…, 1000). */
const SUBSCRIPTION_SETTLE_MS = 1000;

export const resolveNow = (today: string | Date = DEFAULT_TODAY): Date => {
  if (today instanceof Date) return new Date(today.getTime());
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (dateOnly)
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12, 0, 0, 0);
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(today);
  if (local) {
    return new Date(
      +local[1],
      +local[2] - 1,
      +local[3],
      +local[4],
      +local[5],
      local[6] ? +local[6] : 0,
      0
    );
  }
  const parsed = new Date(today);
  if (Number.isNaN(parsed.getTime())) throw new Error(`renderApp: cannot parse today="${today}"`);
  return parsed;
};

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/** Write a seed into the in-memory Firestore. Exposed for specs that need to re-seed mid-test. */
export function seedStore(seed: AppSeed, user: FakeUser | null): void {
  const base = user
    ? makeUserProfile({
        uid: user.uid,
        email: user.email ?? "",
        displayName: user.displayName ?? "User",
      })
    : null;
  if (seed.profile !== null && base) {
    const merged: UserProfile = {
      ...base,
      ...seed.profile,
      preferences: { ...base.preferences, ...(seed.profile?.preferences ?? {}) },
    } as UserProfile;
    store.__seed("users", merged.uid, merged);
  }
  store.__seedEntities("income_sources", seed.incomeSources ?? []);
  store.__seedEntities("expense_rules", seed.expenseRules ?? []);
  store.__seedEntities("transactions", seed.transactions ?? []);
  store.__seedEntities("alerts", seed.alerts ?? []);
  store.__seedEntities("balance_history", seed.balanceHistory ?? []);
}

// ---------------------------------------------------------------------------
// Probe: exposes the live context values to the spec
// ---------------------------------------------------------------------------

interface Sink {
  financial?: FinancialContextValue;
  auth?: ReturnType<typeof useAuth>;
  openModal?: ReturnType<typeof useModal>["openModal"];
}

function Probe({ sink }: { sink: Sink }) {
  sink.auth = useAuth();
  sink.financial = useFinancial();
  sink.openModal = useModal().openModal;
  return null;
}

// ---------------------------------------------------------------------------
// renderApp
// ---------------------------------------------------------------------------

/** Pre-load every lazy modal so React.lazy resolves in microtasks, not real I/O. */
export async function preloadApp(route = "/dashboard"): Promise<void> {
  await Promise.all(Object.values(componentMap).map((load) => load()));
  const entry = ROUTES[route];
  if (entry) await entry.page();
}

export async function renderApp(options: RenderAppOptions = {}): Promise<AppHandle> {
  const { route = "/dashboard", ui, layout = false, waitForReady = true } = options;
  const pathname = route.split("?")[0].replace(/(.)\/$/, "$1");
  const entry = ROUTES[pathname];
  if (!ui && !entry) {
    throw new Error(
      `renderApp: no page registered for "${pathname}". Known routes: ${APP_ROUTES.join(", ")}`
    );
  }

  // --- clock ----------------------------------------------------------------
  if (options.timeZone) process.env.TZ = options.timeZone;
  const now = resolveNow(options.today);
  vi.useRealTimers(); // in case a spec already installed fake timers
  vi.useFakeTimers({
    now,
    // Fake everything except microtask scheduling. `shouldAdvanceTime` lets the
    // clock also drift with real time so nothing can deadlock on a timer we
    // forgot to advance; deterministic waits still come from `advance()`.
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "setImmediate",
      "clearImmediate",
      "Date",
      "performance",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
    shouldAdvanceTime: true,
    advanceTimeDelta: 20,
  });

  // --- auth + data ------------------------------------------------------------
  const fakeUser = options.user === null ? null : makeFakeUser(options.user ?? {});
  store.__reset();
  seedStore(options.seed ?? {}, fakeUser);
  authFake.__reset();
  authFake.__setUser(fakeUser);
  __setRoute(route);

  // --- modules ----------------------------------------------------------------
  await preloadApp(pathname);
  const Page: React.ComponentType | undefined = ui ? undefined : (await entry.page()).default;
  const Layout: React.ComponentType<{ children: React.ReactNode }> | undefined =
    layout && entry?.layout
      ? ((await entry.layout()).default as React.ComponentType<{ children: React.ReactNode }>)
      : undefined;

  // --- render -------------------------------------------------------------------
  const sink: Sink = {};
  const content = ui ?? (Page ? <Page /> : null);
  const tree = (
    <Providers>
      <Probe sink={sink} />
      {Layout ? <Layout>{content}</Layout> : content}
    </Providers>
  );

  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  const settle = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  let result!: RenderResult;
  await act(async () => {
    result = render(tree);
  });

  if (waitForReady) {
    // Let the subscription hook's literal 1s timer fire, then wait for the
    // contexts to report loaded (or signed-out).
    await advance(SUBSCRIPTION_SETTLE_MS);
    await waitFor(() => {
      if (!sink.auth || !sink.financial) throw new Error("providers not mounted");
      if (sink.auth.loading) throw new Error("auth still loading");
      if (fakeUser && (!sink.financial.isInitialized || sink.financial.isLoading)) {
        throw new Error("financial context still loading");
      }
    });
    await settle();
  }

  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTimeAsync(ms) });

  return {
    ...result,
    user,
    store,
    auth: authFake,
    router,
    financial: () => sink.financial as FinancialContextValue,
    authContext: () => sink.auth as ReturnType<typeof useAuth>,
    openModal: (...args) => sink.openModal?.(...args),
    advance,
    settle,
    setToday: async (today) => {
      vi.setSystemTime(resolveNow(today));
      await settle();
    },
    now,
    uid: fakeUser?.uid ?? "",
  };
}
