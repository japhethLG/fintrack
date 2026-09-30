# UI integration tests (jsdom)

Renders the **real** `AuthProvider`, `FinancialProvider`, `ModalProvider` and the
real page components in jsdom, against the in-memory Firestore that the
logic-layer suite already uses. Nothing under `app/` is modified and no
`data-testid`s are needed: use Testing Library role / label / text queries.

```
npm run test:ui                 # UTC
npm run test:ui:tz              # same suite, whole run in Asia/Manila (UTC+8)
UI_TEST_TZ=America/Los_Angeles npm run test:ui
npm run test:ui:flip            # known-defect tests become plain `it` (see below)
UI_STRICT_CONSOLE=1 npm run test:ui   # any unexpected console.error/warn fails the test
npx vitest run --config vitest.config.ui.ts tests/ui/smoke.test.tsx   # one file
```

`npm test` (logic layer, 1,566 tests) and `npm run test:tz` (74) are untouched:
their configs only match `*.test.ts`; this suite is `tests/ui/**/*.test.tsx`.

## Safety: nothing can reach a backend

`.env.local` holds real Firebase credentials, so this is enforced in layers and
verified by `harness.selfcheck.test.tsx`:

| Layer                                                               | What                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `vi.mock("@/lib/firebase/config")`                                  | The real config (which calls `initializeApp`) never executes.  |
| `vi.mock("firebase/firestore")`                                     | `tests/helpers/firestoreEmulator.ts` (in-memory).              |
| `vi.mock("firebase/auth")`                                          | `harness/authFake.ts`.                                         |
| `geminiService`, `imageBBService`                                   | Stubbed (`harness/serviceMocks.ts`).                           |
| `process.env.NEXT_PUBLIC_*`                                         | Deleted in `setup.ts`.                                         |
| `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` | Throw `NETWORK BLOCKED` and are recorded in `blockedRequests`. |
| Node `net.Socket#connect`                                           | Throws for any non-loopback host.                              |

`afterEach` fails a test that leaves an entry in `blockedRequests`, even if the
app swallowed the rejection. A spec that deliberately probes the guard must
clear it (`blockedRequests.length = 0`) and should use a `.invalid` host.

All mocks are registered in `tests/ui/setup.ts` (vitest applies `vi.mock` from a
setup file to every test file) so specs need **no mock boilerplate**.

## Layout

```
vitest.config.ui.ts          jsdom, include tests/ui/**/*.test.tsx, "@" -> app, TZ
tests/ui/setup.ts            mocks, shims, network guard, cleanup, per-test resets
tests/ui/harness/
  index.ts                   the public import surface for specs
  renderApp.tsx              renderApp(), seedStore(), preloadApp(), APP_ROUTES
  authFake.ts                fake firebase/auth
  configMock.ts              replacement for app/lib/firebase/config
  router.ts                  controllable next/navigation
  nextMocks.tsx              next/image, next/link
  browserShims.ts            ResizeObserver, IntersectionObserver, matchMedia, ...
  networkGuard.ts            fetch/XHR/WS/socket guard
  consoleCapture.ts          console.error/warn recorder + strict mode
  money.ts                   parseMoney, moneyNear, moneyIn, moneyInRow
  knownDefect.ts             it.fails wrapper with FLIP_KNOWN_DEFECTS
  serviceMocks.ts            Gemini / ImageBB stubs
tests/ui/smoke.test.tsx            proves the harness end to end
tests/ui/harness.selfcheck.test.tsx  tests of the harness itself (parser, TZ, auth, guard)
tests/ui/observed.test.tsx         defects found while building the harness (knownDefect)
```

Import everything from `./harness` (or `../harness` in a subfolder). It also
re-exports `tests/helpers/builders.ts` (`makeIncomeSource`, `makeExpenseRule`,
`makeLoanRule`, `makeCompletedTransaction`, `makeUserProfile`, ...), `screen`,
`within`, `waitFor`, `act`.

## `renderApp`

```ts
const app = await renderApp({
  route: "/dashboard",        // any of APP_ROUTES; default "/dashboard"
  today: "2026-01-15",        // frozen clock; default "2026-01-15" (see below)
  seed: { ... },              // persisted BEFORE mount
  user: { uid: "user-1" },    // Partial<FakeUser>; null = signed out
  layout: false,              // true = wrap in the route group's real layout
  timeZone: "Asia/Manila",    // per-test TZ override
  ui: <MyForm />,             // render this inside the real providers instead of a page
  waitForReady: true,         // wait for auth + financial contexts to load
});
```

Routes: `/`, `/login`, `/signup`, `/dashboard`, `/income`, `/expenses`,
`/forecast`, `/calendar`, `/transactions`, `/settings`. Page modules are loaded
with dynamic `import()`, so a spec only pays for the pages it renders.
`layout: true` renders `(protected)/layout` (ProtectedRoute + Sidebar +
MobileNav) or `(auth)/layout`; leave it off unless you are testing navigation
chrome or the signed-out redirect (Sidebar/MobileNav duplicate link text).

### Seed shape

```ts
interface AppSeed {
  profile?: Partial<UserProfile> | null; // omitted: makeUserProfile() (USD, balance 10,000,
  //   initial 10,000, balanceLastUpdatedAt 2026-01-01)
  // object: merged over that default (preferences merge deeply)
  // null: no users/{uid} doc -> the real AuthProvider creates
  //   the brand-new-user default (PHP, balance 0)
  incomeSources?: IncomeSource[]; // -> income_sources
  expenseRules?: ExpenseRule[]; // -> expense_rules
  transactions?: Transaction[]; // -> transactions  (STORED rows only; projections are derived)
  alerts?: Alert[]; // -> alerts
  balanceHistory?: BalanceSnapshot[]; // -> balance_history
}
```

Entities carry their own `id`, which becomes the document id. Builders default
`userId` to `"user-1"`, which is also the default fake user's uid. If you
override `user.uid`, override `userId` on every seeded entity (the app queries
`where userId == uid`).

Builder timestamps are epoch 0, so "Member Since" shows 1/1/1970 in Settings.
That is a fixture artefact, not an app bug.

### Return value (`AppHandle`)

All Testing Library `render` results (`getByText`, `container`, `unmount`, ...),
plus:

| Member                     |                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `user`                     | `userEvent` instance already wired to the fake clock                                                                           |
| `store`                    | the emulator module: `__get(col, id)`, `__all(col)`, `__count(col)`, `__ops`, `__opsFor(col)`, `__seed*`                       |
| `auth`                     | the fake auth module: `__setUser(user\|null)`, `__callsTo("signOut")`, `__failNext(fn, err)`                                   |
| `router`                   | `push`/`replace`/`back` spies                                                                                                  |
| `financial()`              | latest `FinancialContextValue` (transactions, dailyBalances, billCoverage, actions...). **Call it each time**; never cache it. |
| `authContext()`            | latest `AuthContext` value                                                                                                     |
| `openModal(name, data)`    | open any registered modal as a page would                                                                                      |
| `advance(ms)` / `settle()` | move the fake clock / flush pending work inside `act`                                                                          |
| `setToday(...)`            | move the frozen "now" mid-test                                                                                                 |
| `now`, `uid`               | resolved instant and uid                                                                                                       |

`financial()` also makes hooks/contexts testable without a bespoke host: render
`ui: <div/>` and drive `app.financial().addManualTransaction(...)` inside `act`.

### Example spec (copy me)

```tsx
import { describe, expect, it } from "vitest";
import { renderApp, screen, within, waitFor, moneyNear, makeIncomeSource } from "../harness";

describe("Income page", () => {
  it("shows the monthly total and persists a new manual transaction", async () => {
    const app = await renderApp({
      route: "/transactions",
      today: "2026-01-15",
      seed: { incomeSources: [makeIncomeSource({ name: "Acme Payroll", amount: 3_000 })] },
    });
    // preconditions: assert what you rely on BEFORE the money assertion
    expect(app.financial().incomeSources).toHaveLength(1);

    await app.user.click(screen.getByRole("button", { name: /add transaction/i }));
    const dialog = await screen.findByRole("dialog");
    // modal bodies are React.lazy: the dialog shell exists before the form does
    await app.user.type(await within(dialog).findByLabelText(/^Name/), "Coffee");
    await app.user.type(within(dialog).getByLabelText(/^Amount/), "4.50");
    await app.user.click(within(dialog).getByRole("button", { name: "Create Transaction" }));

    await waitFor(() => expect(app.store.__all("transactions")).toHaveLength(1));
    expect(app.store.__all("transactions")[0]).toMatchObject({
      name: "Coffee",
      projectedAmount: 4.5,
    });
  });
});
```

## Timers: the pattern and why

`useFinancialSubscriptions` flips `isLoading`/`isInitialized` on a literal
`setTimeout(..., 1000)`, `onSnapshot` listeners fire synchronously from the
emulator, and many calculators read `new Date()`. `renderApp` therefore:

1. `vi.useFakeTimers({ now, toFake: [timers, Date, performance, rAF], shouldAdvanceTime: true })`.
   Microtask scheduling (`queueMicrotask`, `nextTick`) is left real so promise
   chains resolve normally. `shouldAdvanceTime` lets the fake clock drift with
   real time so nothing can deadlock on a timer nobody advanced.
2. Renders inside `act(async ...)`, then `advanceTimersByTimeAsync(1000)` inside
   `act` (fires the literal 1 s loading timer instantly instead of waiting 1 s
   per test), then waits until `auth.loading === false` and
   `financial.isInitialized && !financial.isLoading`.
3. `setup.ts` defines `globalThis.jest = { advanceTimersByTime }`. DTL only takes
   its fake-timer branch when a `jest` global exists, without it `waitFor`
   polls on the real clock and stalls behind fake `setTimeout`. With it,
   `waitFor`/`findBy*` advance the fake clock deterministically.
   Consequence: `waitFor` timeouts are **fake** ms (`asyncUtilTimeout` is 3000).
4. `userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync })`.
5. Every lazy modal module is `import()`ed up front (`preloadApp`) so
   `React.lazy` resolves in microtasks; otherwise real module-load I/O would race
   the fake clock.

`today: "YYYY-MM-DD"` means **local noon** of that day in the active zone, so a
+/-12 h zone offset cannot flip the calendar day by accident. Pass
`"YYYY-MM-DDTHH:mm"` (local) or a `Date` to probe day boundaries, e.g.
`today: "2026-01-15T00:30"`. Build a `Date` _after_ setting `timeZone`, or use the
string form (a `Date` built earlier was created in the previous zone).

Time zone: `vitest.config.ui.ts` pins `TZ` to `UTC` (override with `UI_TEST_TZ`;
`npm run test:ui:tz` = Asia/Manila). Individual tests can also pass
`renderApp({ timeZone })`, which assigns `process.env.TZ` (Node re-reads it
immediately); `setup.ts` restores the configured zone before/after every test.
So east-of-UTC regressions can be pinned in the default UTC run.

## Money helpers (`harness/money.ts`)

Written independently of `app/lib/utils/currency.ts`: expected values in specs
are plain numbers and the on-screen text is parsed here, so a formatting bug
cannot cancel itself out.

```ts
parseMoney("-$1,600.00"); // -1600   (also +, unicode minus, (1,234), $1.2K, US$, ₹1,23,456)
parseMoney("€1.234,56", { currency: "EUR" }); // 1234.56 (de-DE layout needs the hint)
moneyValues("Opening $10,000 Closing $11,800"); // [10000, 11800]
moneyNear("Total Expenses"); // -1200: amount that follows the label in reading order
moneyNear("Budgeted", { within: card, occurrence: 1 }); // 2nd "Budgeted" label in a scope
moneyNear("Range", { index: 1 }); // 2nd amount after the label
moneyIn(el); // every amount inside an element
moneyInRow("Flat Rent"); // amounts in the row/card containing that text
```

They throw (never return 0) when the label or amount is missing. Sign comes from
the rendered text: the Dashboard renders expenses as `-$1,200.00`, so
`moneyNear("Total Expenses")` is `-1200`. Amounts rendered without a currency
symbol (`showSymbol: false`) need `parseMoney(el.textContent)` on the element.

## Console policy

`console.error`/`warn` are recorded per test (`consoleCalls()`), still printed,
except jsdom-only noise (`ENV_NOISE`: recharts' pre-measurement size warning,
styled-jsx `jsx` attribute on the landing page), which is recorded but silenced.
`allowConsole(/pattern/)` pre-approves a message for one test.
`UI_STRICT_CONSOLE=1` turns any other console output into a test failure;
`KNOWN_APP_WARNINGS` (currently the Radix "Missing Description" warning, see
UI-OBS-06) is tolerated so strict mode is usable. During harness development
every route rendered with **zero** other console output: no act() warnings, no
React key warnings.

## Known-defect convention

Mirrors the logic suite (`tests/DEFECTS.md`): a bug that is still present is
encoded as a test asserting the **correct** behaviour.

```ts
knownDefect("UI-OBS-01", "Budgeted income for a 31-day month is prorated by days/30", async () => {
  // observed: Budgeted income $3,100 (expected $3,000), expenses $1,240 (expected $1,200)
  await renderApp({ route: "/forecast", ... });
  expect(moneyNear("Actual", { ... })).toBe(3_000);      // precondition: the page rendered and the plan was met
  expect(moneyNear("Budgeted", { ... })).toBe(3_000);    // the money assertion
});
```

- Registers `it.fails("KNOWN DEFECT: UI-OBS-01 — …")`. Green while the bug
  exists, **red the moment it is fixed** ("you fixed something": delete the
  wrapper, keep the test as a regression guard).
- **The test must reach its money assertion.** `it.fails` cannot tell an
  assertion failure from a crash (a `TypeError` also "passes"). Assert the
  preconditions and array lengths first (`expect(rows).toHaveLength(2)`, the
  seeded store count, that the page rendered), and put the observed wrong value
  in a comment. Never let an exception thrown by a missing element stand in for
  "defect still present".
- One defect per test: an early failing assertion hides later ones (split, as
  UI-OBS-04/05 are).
- IDs are `UI-…`; reference the root cause id from `tests/DEFECTS.md` too when
  one exists.

### Flip mode (non-destructive)

```
FLIP_KNOWN_DEFECTS=1 npm run test:ui        # or: npm run test:ui:flip
```

`knownDefect` registers a plain `it` instead of `it.fails`; no file is rewritten,
nothing to restore. In that run **every failure is a defect that is still
present, every pass is one that has been fixed**. Verify each failure is an
`AssertionError` (not a `TypeError`/`Error: Unable to find…`):

```
FLIP_KNOWN_DEFECTS=1 npx vitest run --config vitest.config.ui.ts --reporter=json --outputFile=/tmp/flip-ui.json
node -e 'const r=require("/tmp/flip-ui.json");for(const f of r.testResults)for(const t of f.assertionResults)if(t.status==="failed"&&!/AssertionError|expected/.test((t.failureMessages||[]).join()))console.log("CRASH-BASED:",t.fullName)'
```

Empty output = every defect test reaches a real assertion.

## What renders cleanly, and the shims it needs

All ten routes mount, load, and reach their real content with the shims below
(no per-page workarounds). Ablation: removing a shim and rerendering showed
which are load-bearing.

| Shim (`browserShims.ts`)                                               | Needed by                                                          | Verified required?                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `ResizeObserver` reporting 800x400                                     | recharts `ResponsiveContainer` (Dashboard, Forecast, Transactions) | yes: without it Dashboard, Forecast and Transactions throw                                    |
| `IntersectionObserver` (everything intersecting)                       | `useScrollAnimation` / landing page                                | yes: `/` throws without it                                                                    |
| `matchMedia`                                                           | antd responsive observer / DatePicker                              | jsdom has none; no route failed without it in the ablation, kept because antd calls it lazily |
| `scrollTo`, `scrollIntoView`, pointer-capture stubs                    | radix, dnd-kit, calendar                                           | defensive                                                                                     |
| `HTMLCanvasElement.getContext -> null`, `getComputedStyle(el, pseudo)` | silences jsdom "not implemented" noise from antd/recharts          | noise only                                                                                    |
| `next/image`, `next/link`, `next/navigation` mocks                     | every page (Link routes via the fake router)                       | yes                                                                                           |

Not shimmed because not needed: layout getters (`offsetWidth` etc.): react-window
renders its rows without them. CSS imports are ignored (`css: false`); Tailwind
class names are inert strings, so **do not** assert on visibility via CSS classes
(`toBeVisible` cannot see Tailwind `hidden`).

Notes for spec authors:

- Recharts SVG output is present (`svg.recharts-surface`) but chart text
  positions are meaningless; assert the numbers the page prints, not pixels.
- The Transactions list is `react-window` virtualised: only the rows in the
  viewport exist. Query with `getAllByText(...)[0]`, and remember the default
  projection window is 2 months back / 4 months ahead, so a monthly rule yields
  several identical rows.
- The lazy modal issue above (`findBy*` inside the dialog).
- Radix modals render in a portal on `document.body`: `screen` queries see them;
  `within(container)` does not.
- `<select>`s are native (Preferences): use `user.selectOptions`.
- `app.store.__ops` is an ordered write log: assert write _counts_ to catch
  double-writes.

## Observed defects (reproduced through the real UI while building the harness)

All in `observed.test.tsx` as `knownDefect`s; each fails on a genuine assertion
under `FLIP_KNOWN_DEFECTS=1`.

| ID        | Where                         | Observed                                                                                                                                                                                                                       |
| --------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UI-OBS-01 | Forecast "Budgeted vs Actual" | Budgeted = monthly amount x days/30: a $3,000 salary and $1,200 rent budget as $3,100 / $1,240 in January (31 days), showing a phantom -3.2% variance on a plan met exactly. (`prorateToDateRange`)                            |
| UI-OBS-02 | Settings > Preferences        | "Low Balance Warning Threshold" input prefix is a hard-coded `₱` for a USD user (also on the BalanceSection "Override Current Balance" input, reproduced).                                                                     |
| UI-OBS-03 | Settings > Preferences        | Saving a threshold of `0` stores `500` (`parseFloat(x) \|\| 500`); a stored `0` also renders as 500 (reproduced: the input shows 500).                                                                                         |
| UI-OBS-04 | Settings > Selective Reset    | "Transactions" count includes derived projections: 1 stored row is listed as 5 items.                                                                                                                                          |
| UI-OBS-05 | Settings > Selective Reset    | "Balance History" always shows 0 items (`balance_history: 0` is hard-coded) with a snapshot stored.                                                                                                                            |
| UI-OBS-06 | Every modal                   | Radix warning "Missing `Description` or `aria-describedby={undefined}` for {DialogContent}".                                                                                                                                   |
| UI-OBS-07 | UTC+ zones                    | The projection window is built with `toISOString()` of local midnight: in Manila `viewDateRange` is `2025-10-31 .. 2026-04-29` instead of `2025-11-01 .. 2026-04-30`, so a bill due 2026-04-30 is missing from `transactions`. |
| UI-OBS-08 | UTC+ zones                    | Add Transaction defaults the Date field to yesterday between 00:00 and 08:00 local in Manila (`new Date().toISOString().split("T")[0]`).                                                                                       |

Checked and found correct (Dashboard, today 2026-01-20): with a skipped salary, a
completed rent (actual 1,100 vs projected 1,000), a completed manual gift (500)
and a weekly grocery rule, KPI Total Income = 500, Total Expenses = 1,600 and
Net Flow = -1,100; completing a projected bill through the modal with an actual
of 120 wrote the transaction, moved the profile balance 5,000 -> 4,880 and
closed the dialog.

## Known limits

- One signed-in user per render. Multi-user isolation needs `auth.__setUser`
  mid-test.
- The emulator does not support sub-collections, transactions or cursor
  pagination (see its header); none are used by the app.
- `react-window`, dnd-kit drag gestures and antd's date-range popup are not
  exercised by the smoke suite. antd `DatePicker` popups are portal-heavy; prefer
  driving the page through its non-popup controls or the presets.
- Layout, CSS, focus rings and real animation are out of scope: that is what the
  Playwright harness in `e2e/` is for.
