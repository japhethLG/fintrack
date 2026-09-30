/**
 * Seeding + inspecting the fake backend from Playwright.
 *
 *   await seedAndLogin(page, {
 *     user: userProfile({ currentBalance: 5000 }),
 *     incomeSources: [incomeSource({ name: "Acme Payroll", amount: 3000 })],
 *     expenseRules: [fixedExpense({ name: "Rent", amount: 1200 })],
 *   });                                   // signed in, on /dashboard
 *
 * The seed is written into localStorage by an init script BEFORE any app code
 * runs, and only once per seedAndLogin() call (keyed by a seedId) — so a page
 * reload keeps the app's own writes instead of re-applying the seed.
 */
import type { BrowserContext, Page } from "@playwright/test";
import {
  STORE_KEY,
  emptyState,
  type AuthAccount,
  type AuthConfig,
  type DocJSON,
  type E2EBridge,
  type E2EUser,
  type FirestoreFault,
  type PersistedState,
  type SeedState,
} from "../shared/protocol";
import { assertFakeFirebase } from "./nav";
import {
  TEST_EMAIL,
  TEST_NAME,
  TEST_UID,
  userProfile,
  type AlertSeed,
  type BalanceSnapshotSeed,
  type ExpenseRuleSeed,
  type IncomeSourceSeed,
  type TransactionSeed,
  type UserProfileSeed,
} from "./builders";

export type { E2EUser, AuthConfig, FirestoreFault, SeedState };

/** Firestore collection names used by the app. */
export const COLLECTIONS = {
  users: "users",
  incomeSources: "income_sources",
  expenseRules: "expense_rules",
  transactions: "transactions",
  balanceHistory: "balance_history",
  alerts: "alerts",
} as const;

export interface SeedInput {
  /**
   * The signed-in user's profile document (users/{uid}). Defaults to
   * userProfile() (balance 0). Pass `null` for "authenticated but no profile
   * yet" — the app then creates its default profile itself.
   */
  user?: UserProfileSeed | null;
  incomeSources?: IncomeSourceSeed[];
  expenseRules?: ExpenseRuleSeed[];
  transactions?: TransactionSeed[];
  balanceHistory?: BalanceSnapshotSeed[];
  alerts?: AlertSeed[];
  /** Escape hatch: extra/raw collections, doc id -> JSON. Merged over the above. */
  collections?: Record<string, Record<string, DocJSON>>;
  /** Auth-fake behaviour (reject codes, google identity). */
  authConfig?: AuthConfig;
  /** If set, email sign-in for the seeded user requires this password. */
  password?: string;
  /** Extra known accounts (email -> {uid,password?}). */
  accounts?: Record<string, AuthAccount>;
  /** Firestore write fault to inject from the start. */
  fault?: FirestoreFault | null;
}

const keyed = <T extends { id: string }>(docs: T[] | undefined): Record<string, DocJSON> =>
  Object.fromEntries((docs ?? []).map((d) => [d.id, d as unknown as DocJSON]));

const identityOf = (profile: UserProfileSeed | null | undefined): E2EUser => ({
  uid: profile?.uid ?? TEST_UID,
  email: profile?.email ?? TEST_EMAIL,
  displayName: profile?.displayName ?? TEST_NAME,
});

/** Turn friendly input into the fake's SeedState. */
export const buildSeedState = (input: SeedInput = {}, opts: { signedIn: boolean }): SeedState => {
  const profile = input.user === undefined ? userProfile() : input.user;
  const me = identityOf(profile);
  const collections: Record<string, Record<string, DocJSON>> = {
    [COLLECTIONS.users]: profile ? { [profile.uid]: profile as unknown as DocJSON } : {},
    [COLLECTIONS.incomeSources]: keyed(input.incomeSources),
    [COLLECTIONS.expenseRules]: keyed(input.expenseRules),
    [COLLECTIONS.transactions]: keyed(input.transactions),
    [COLLECTIONS.balanceHistory]: keyed(input.balanceHistory),
    [COLLECTIONS.alerts]: keyed(input.alerts),
  };
  for (const [name, docs] of Object.entries(input.collections ?? {})) {
    collections[name] = { ...(collections[name] ?? {}), ...docs };
  }
  return {
    auth: {
      currentUser: opts.signedIn ? me : null,
      accounts: {
        [me.email.toLowerCase()]: { uid: me.uid, ...(input.password ? { password: input.password } : {}) },
        ...(input.accounts ?? {}),
      },
      config: input.authConfig ?? {},
    },
    collections,
    fault: input.fault ?? null,
  };
};

const toPersisted = (state: SeedState, seedId: string): PersistedState => ({
  ...emptyState(),
  seedId,
  auth: {
    currentUser: state.auth?.currentUser ?? null,
    accounts: state.auth?.accounts ?? {},
    config: state.auth?.config ?? {},
  },
  collections: state.collections ?? {},
  fault: state.fault ?? null,
});

const randomSeedId = (): string => `seed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Install a seed that is applied before app code runs on the next navigation
 * (and on later navigations only if it hasn't been applied yet). Does NOT sign
 * in unless `opts.signedIn`. Works on a Page or a whole BrowserContext.
 */
export const seedStore = async (
  target: Page | BrowserContext,
  input: SeedInput = {},
  opts: { signedIn?: boolean } = {}
): Promise<void> => {
  const seedId = randomSeedId();
  const persisted = toPersisted(buildSeedState(input, { signedIn: opts.signedIn ?? false }), seedId);
  await target.addInitScript(
    ({ key, state }) => {
      try {
        const existing = window.localStorage.getItem(key);
        const existingId = existing ? (JSON.parse(existing) as { seedId?: string }).seedId : undefined;
        if (existingId === state.seedId) return; // already applied: keep the app's own writes
        window.localStorage.setItem(key, JSON.stringify(state));
      } catch {
        /* opaque origin (about:blank) — nothing to seed */
      }
    },
    { key: STORE_KEY, state: persisted }
  );
};

/**
 * Seed, sign the user in, navigate to `path` (default /dashboard), and assert
 * the fake Firebase layer is active. The one-liner most specs start with.
 */
export const seedAndLogin = async (
  page: Page,
  input: SeedInput = {},
  opts: { path?: string } = {}
): Promise<void> => {
  await seedStore(page, input, { signedIn: true });
  await page.goto(opts.path ?? "/dashboard");
  await assertFakeFirebase(page);
};

/** Seed a signed-OUT store (e.g. so a UI login can find the account), then navigate. */
export const seedAndVisit = async (page: Page, input: SeedInput = {}, path = "/login"): Promise<void> => {
  await seedStore(page, input, { signedIn: false });
  await page.goto(path);
  await assertFakeFirebase(page);
};

// ---------------------------------------------------------------------------
// Live control of a running page (bridge wrappers)
// ---------------------------------------------------------------------------

/** Replace the whole store of the running page; open listeners re-fire. */
export const reseed = async (page: Page, input: SeedInput = {}, opts: { signedIn?: boolean } = {}): Promise<void> => {
  const state = buildSeedState(input, { signedIn: opts.signedIn ?? true });
  await page.evaluate((s) => (window as unknown as { __fintrackE2E: E2EBridge }).__fintrackE2E.seed(s), state);
};

export const signInAs = async (page: Page, user: E2EUser): Promise<void> => {
  await page.evaluate((u) => (window as unknown as { __fintrackE2E: E2EBridge }).__fintrackE2E.signIn(u), user);
};

export const signOutViaBridge = async (page: Page): Promise<void> => {
  await page.evaluate(() => (window as unknown as { __fintrackE2E: E2EBridge }).__fintrackE2E.signOut());
};

export const configureAuth = async (page: Page, config: AuthConfig): Promise<void> => {
  await page.evaluate((c) => (window as unknown as { __fintrackE2E: E2EBridge }).__fintrackE2E.configureAuth(c), config);
};

export const setFault = async (page: Page, fault: FirestoreFault | null): Promise<void> => {
  await page.evaluate((f) => (window as unknown as { __fintrackE2E: E2EBridge }).__fintrackE2E.setFault(f), fault);
};

// ---------------------------------------------------------------------------
// Reading the store back
// ---------------------------------------------------------------------------

export type StoreDump = ReturnType<E2EBridge["dump"]>;

/**
 * Full store as JSON: { auth, collections, ops }. Timestamps appear as
 * `{__type:"timestamp", seconds, nanoseconds, iso}`. Reads the persisted copy
 * so it also works before the app has booted.
 */
export const readStore = async (page: Page): Promise<StoreDump> =>
  page.evaluate((key) => {
    const bridge = (window as unknown as { __fintrackE2E?: E2EBridge }).__fintrackE2E;
    if (bridge) return bridge.dump();
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : { auth: { currentUser: null, accounts: {}, config: {} }, collections: {}, ops: [] };
    return { auth: parsed.auth, collections: parsed.collections, ops: parsed.ops };
  }, STORE_KEY);

/** All docs of a collection as `{ id, ...data }`, sorted by id. */
export const readCollection = async <T = Record<string, unknown>>(
  page: Page,
  collection: string
): Promise<Array<T & { id: string }>> => {
  const store = await readStore(page);
  const docs = store.collections[collection] ?? {};
  return Object.entries(docs)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, data]) => ({ ...(data as T), id }));
};

/** One doc (or undefined). */
export const readDocument = async <T = Record<string, unknown>>(
  page: Page,
  collection: string,
  id: string
): Promise<(T & { id: string }) | undefined> => {
  const store = await readStore(page);
  const data = store.collections[collection]?.[id];
  return data === undefined ? undefined : ({ ...(data as T), id } as T & { id: string });
};
