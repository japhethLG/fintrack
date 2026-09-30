# FinTrack E2E harness (Playwright)

Browser tests that drive the **real app bundle** against **in-browser fakes** of
Firebase (Auth + Firestore), Gemini and ImgBB. No test can reach a real backend:
the fakes are compiled in at build time, every non-local request is aborted, and
the server refuses to start if the build contains real-client code.

```
npm run test:e2e                      # all specs x {UTC, Asia/Manila, America/New_York}
npm run test:e2e -- --project=UTC     # one timezone
npm run test:e2e -- smoke -g reload   # filter
npm run test:e2e:flip                 # known-defect tests run as normal tests (see below)
npm run e2e:build                     # just (re)build + verify .next-e2e
npx playwright show-report            # HTML report (traces on failure)
```

The first run builds (~20 s); later runs rebuild only when `app/`, `public/`,
`e2e/fakes`, `e2e/shared` or the build config changed (see `scripts/serve.mjs`).

## Layout

```
e2e/
  fakes/            browser-side Firebase fakes (aliased over firebase/app|auth|firestore)
    core.ts         store + persistence + listeners + Timestamp + window.__fintrackE2E
    firebase-app.ts firebase-auth.ts firebase-firestore.ts
    stubs/          geminiService.ts, imageBBService.ts, genai.ts (deterministic stubs)
  shared/protocol.ts   wire format shared by Node helpers and browser fakes
  helpers/          builders.ts seed.ts clock.ts nav.ts flows.ts knownDefect.ts
  fixtures.ts       THE `test`/`expect` (network guard, clock, fake assertion, diagnostics)
  index.ts          barrel: import { test, expect, seedAndLogin, ... } from "../index"
  reporters/knownDefects.ts   flip-mode classifier
  scripts/serve.mjs build-if-stale + verify + static server on 127.0.0.1:3100
  specs/            your specs (smoke.spec.ts proves the harness)
playwright.config.ts
```

**Every spec must `import { test, expect } from "../fixtures"` (or `../index`)** —
never from `@playwright/test`, or you lose the network guard and the fake-Firebase assertion.

## Dev server vs production build (why a static build)

The shipped app is `output: "export"` with `basePath: "/fintrack"` under
`NODE_ENV=production`. The harness builds that artifact with `FINTRACK_E2E=1`
into `.next-e2e/` (never touching `.next`/`out`) and serves it with a 60-line
static server. Reasons: (1) it is the thing users get (no StrictMode double
effects, no dev-only code paths); (2) no compile-on-demand stalls — with 3 timezone
projects x N workers `next dev` compiles each route on first hit and times out
randomly; (3) no dev overlay / HMR websocket; (4) a static server cannot talk to
anything. Cost: an ~20 s rebuild after app changes (automatic when stale).
`next dev` also would need `basePath: ""`, i.e. a different config than prod.

URLs: `baseURL` is `http://127.0.0.1:3100`; the server 302-redirects
un-prefixed paths, so `page.goto("/dashboard")` works. The *resulting* URL is
`/fintrack/dashboard`, so use `expectAppPath(page, "/dashboard")` /
`currentAppPath(page)` / `appPath("/x")` from `helpers/nav.ts` for URL assertions.

## How the fakes are wired (no real backend, by construction)

`next.config.js`, only when `FINTRACK_E2E=1` (with the flag unset the exported
config is `deepStrictEqual` to the pre-harness one, in both NODE_ENVs):

- `turbopack.resolveAlias` (default bundler) maps `firebase/app`, `firebase/auth`,
  `firebase/firestore`, `@/lib/services/geminiService`, `@/lib/services/imageBBService`
  and `@google/genai` to files in `e2e/fakes`. A webpack fallback exists
  (`FINTRACK_E2E_BUNDLER=webpack next build --webpack`).
- `NEXT_PUBLIC_FIREBASE_*`, `..._GEMINI_API_KEY`, `..._IMAGE_BB_API_KEY` are forced to
  dummy values (process env beats `.env.local`), so real keys are never inlined.
- `distDir: ".next-e2e"` and `typescript.ignoreBuildErrors` (the build must not depend on
  the type-cleanliness of `remotion/`, `tests/`, `e2e/`; run `npx tsc --noEmit` for types).

Defence in depth: after every build `scripts/serve.mjs` scans the output and
**refuses to start** if it finds `AIza…` keys, `firestore.googleapis.com`,
`identitytoolkit`, `securetoken`, `firebaseio.com`, `*.firebaseapp.com`,
`generativelanguage.googleapis.com`, `api.imgbb.com`, Google popup-auth scripts — or
if the fake marker is missing. The fixture additionally asserts
`window.__FINTRACK_FAKE_FIREBASE__ === true` and the network guard aborts anything
non-local. The `webServer.url` is our own `/__e2e_health`, so a foreign server
on the port (e.g. a real `next start`) is never reused.

### What the fakes do

State lives in `localStorage["__fintrack_e2e_store_v1__"]` (JSON, Timestamps tagged
`{__type:"timestamp",seconds,nanoseconds}`), written on every write. So it survives
reloads and client navigations, is shared between tabs of one context (kept in sync
via the `storage` event) and is isolated per test (fresh browser context).

Firestore (`firebase-firestore.ts`) — closer to the real SDK than the vitest emulator:
`collection/doc/query/where/orderBy/limit/getDoc/getDocs/addDoc/setDoc(+merge)/
updateDoc(object or field,value pairs; dotted paths)/deleteDoc/writeBatch/onSnapshot`,
`Timestamp`, `serverTimestamp/deleteField/increment/arrayUnion/arrayRemove`.
Fidelity choices worth knowing (they can surface real bugs):
- `undefined` field values are **rejected** (`invalid-argument`), like the real SDK.
- `updateDoc` on a missing doc rejects with `not-found`; `writeBatch` is atomic (a bad op
  fails the whole commit, nothing applied).
- Queries exclude docs missing an `orderBy`/inequality field; default order is doc id;
  inequality operators only match same-typed values.
- `onSnapshot`: first snapshot async; later ones only when the result changed; delivered
  from a microtask (works under a faked clock).
- Auto ids are deterministic, persisted (`e2eauto0000000000001`, …).
- **Not emulated:** security rules, composite-index requirements (real Firestore rejects
  some `where+orderBy` combos without an index; the fake runs them), offline/latency,
  read faults.

Auth (`firebase-auth.ts`): `onAuthStateChanged`, email sign-in/sign-up (accept anything
unless the account has a `password` or `authConfig.reject*` is set), Google popup (signs in
as `authConfig.googleUser`), `signOut`, `currentUser`, `updateEmail/updatePassword/
reauthenticateWithCredential/deleteUser` (succeed; or reject via `authConfig`),
`GoogleAuthProvider`, `EmailAuthProvider`. Signing in with an email that matches a seeded
account/profile signs in as that uid; otherwise a deterministic uid is derived and the app
creates the default profile itself. Errors look like the SDK's:
`Firebase: Error (auth/invalid-credential).` with `.code`.

Stubs: `analyzeBudget()` resolves `FAKE_ANALYSIS_TEXT` ("E2E FAKE AI ANALYSIS…") — override
with `window.__fintrackE2E.geminiResponse/geminiError`, inspect `geminiCalls`.
`uploadToImageBB()` validates like the real one and resolves a `data:` URL.

### The bridge: `window.__fintrackE2E`

`{ fake: true, seed(state), dump(), reset(), signIn(user), signOut(), configureAuth(cfg),
setFault(fault|null), geminiCalls, geminiResponse, geminiError }`. Most specs should use the
Node helpers below instead of calling it directly.

## Seeding

```ts
import { test, expect, seedAndLogin, userProfile, incomeSource, fixedExpense,
         cashLoan, creditCard, installment, variableExpense, oneTimeExpense,
         transaction, completedTransaction, readCollection, readStore, COLLECTIONS } from "../index";

test("...", async ({ page }) => {
  await seedAndLogin(page, {
    user: userProfile({ currentBalance: 5000, initialBalance: 5000 }),   // users/{uid}; null = "no profile yet"
    incomeSources: [incomeSource({ name: "Acme Payroll", amount: 3000 })],
    expenseRules:  [fixedExpense({ name: "Rent", amount: 1200 }), cashLoan(), creditCard()],
    transactions:  [transaction({ name: "Manual Bill", scheduledDate: "2026-03-12", projectedAmount: 60 }),
                    completedTransaction({ name: "Coffee", scheduledDate: "2026-03-05", projectedAmount: 12 })],
    // balanceHistory: [...], alerts: [...], collections: { raw_coll: { id: {...} } },
    // authConfig: { rejectEmailSignIn: "auth/invalid-credential", googleUser: {...} },
    // password: "s3cret", accounts: {...}, fault: { code: "permission-denied", collections: ["income_sources"], times: 1 },
  }, { path: "/calendar" });          // default path "/dashboard"; asserts the fakes are active
  const txns = await readCollection(page, COLLECTIONS.transactions);   // [{ id, ...data }] sorted by id
  const store = await readStore(page);                                 // { auth, collections, ops }
});
```

Builders are typed off `app/lib/types.ts` (`import type` only, so shape drift breaks `tsc`;
no app logic is imported — derive expected values by hand). Timestamp fields are
`ts("2026-03-01T00:00:00Z")` wire objects. Defaults: uid `e2e-user-1` (`TEST_UID`),
email `e2e.user@example.com`, displayName "E2E User", currency USD, dateFormat MM/DD/YYYY,
monthly / day 1 / start 2026-01-01 / no weekend adjustment.

Other helpers (`helpers/seed.ts`): `seedStore(pageOrContext, input, {signedIn})`,
`seedAndVisit(page, input, path="/login")` (signed OUT), `reseed(page, input)` (live
replace, listeners re-fire), `signInAs`, `signOutViaBridge`, `configureAuth`, `setFault`,
`readDocument`. `store.ops` is an append-only write log (`{op, collection, id, data}`),
handy for "no unexpected writes" assertions.

The seed is written by an init script **before app code runs** and applied **once per
`seedAndLogin` call** (keyed by a `seedId`) — a reload keeps the app's own writes.

## Network guard (fixtures.ts)

Every request whose host is not `localhost`/`127.0.0.1`/`[::1]` is aborted and recorded in
the `externalRequests` fixture; WebSockets too. **The test fails in teardown** listing
them. `allowedExternalHosts` (via `test.use`) lets a spec accept-but-still-abort specific
hosts (discouraged). One tolerated exception: `globals.css` `@import`s Google Fonts, so
`fonts.googleapis.com` is answered with an empty stylesheet (never leaves the machine) and
listed in `toleratedRequests` / a `tolerated-external-requests.txt` attachment.
Teardown also asserts `window.__FINTRACK_FAKE_FIREBASE__ === true` on every open app page.

## Clock and timezones

`fixtures.ts` freezes `Date` at `now` (default **2026-03-10T12:00:00Z**, a Tuesday) with
`context.clock.setFixedTime` (timers keep running). Noon UTC is 2026-03-10 in all three
zones (Manila 20:00, New York 08:00 **EDT −4** — US DST began 2026-03-08), so a spec
written for "today = 2026-03-10" holds everywhere. Change per file/describe with
`test.use({ now: "2026-03-10T23:30:00Z" })`, or mid-test `await page.clock.setFixedTime(...)`
before navigating (probe day rollover: 23:30Z is already 03-11 in Manila).
Projects (`playwright.config.ts`): `UTC`, `Asia/Manila` (+8, no DST), `America/New_York`
(−5/−4). Locale is `en-US`, viewport 1440x900 (desktop sidebar; < 1024px switches to
`MobileNav`). Run everything under all projects; a spec that only holds in one zone is a
finding, not a reason to skip a project.

## Known defects: `knownDefect(id, observed)`

```ts
test("Transactions list shows the scheduled date, not the day before", async ({ page }) => {
  knownDefect("TZ-NY-1", "row shows 12/31/2025 for scheduledDate 2026-01-01 in America/New_York");
  ...assert the CORRECT behaviour...
});
```
Call it first in the test. Normal run: `test.fail()` + a `known-defect` annotation (green while
the defect exists; **red** — "expected to fail but passed" — once fixed, prompting you to remove
the marker). `E2E_FLIP_KNOWN_DEFECTS=1` (`npm run test:e2e:flip`): the marker only annotates,
tests run normally and must fail; `reporters/knownDefects.ts` prints a table and writes
`test-results/known-defects-flip.json` classifying each as `mismatch` (assertion with a real
Received value — good), `missing-element` (expect timed out on a missing element — acceptable),
`timeout` (action/test timeout) or `crash` (TypeError, …) — the last two, and `PASSED`,
mean the *test* is wrong, and make the run exit non-zero.

## Selector cheat sheet (no data-testid exists)

- Sidebar (desktop): `navigateVia(page, "Income Manager")` — buttons named `"<icon> <Label>"`.
- Login: `loginViaForm(page, email, pw)`. `getByLabel("Password")` and
  `getByRole("button",{name:"Sign In"})` are **ambiguous** ("Show password", "Sign in with Google") — use `exact: true`.
- Add income: Income page → button "Add Income" → 4-step wizard: pick a type card (heading level 4,
  e.g. "Salary") → Continue → "Source Name *", "Amount *" → Continue → schedule (Frequency, Start
  Date, Day of Month…) → Continue → "Create Income Source". `addIncomeViaWizard()` does defaults.
- Complete a transaction: click its name on the calendar (or transactions list) → dialog
  "Transaction" → fill "Actual Amount" → "Mark Complete". Projected occurrences are materialised
  into a completed `transactions` doc (`sourceType`, `sourceId`, `occurrenceId` like `<sourceId>_2026-03`)
  and `users/{uid}.currentBalance` is adjusted. `completeTransactionByName()`. "Skip" is a sibling button.
- Dashboard "Review" opens the overdue-transactions modal; Forecast: button "Generate AI Insights".
- Logout: button "logout Logout". `waitForAppReady(page)` waits out the "Loading..." shell.

## Gotchas

- Overdue projected occurrences count toward balances/"Opening" figures, so a seed with
  `startDate` months ago produces "N Overdue Transactions" and big opening balances. Use a
  `startDate` near today (or `completedTransaction`s) when you want a quiet dashboard.
- The Recharts "width(-1) and height(-1)" console *warning* appears on first render — ignore.
- Amounts render with/without cents depending on the widget (`$5,000.00` vs `$5,000`).
- `page.getByText("$3,000")` matches several widgets: scope it (`main`, a card heading) or `.first()`.
- Staleness is decided by source mtimes (`serve.mjs`); `npm run e2e:build` is stale-aware, force a
  rebuild with `node e2e/scripts/serve.mjs --build --build-only`. A server you started by hand keeps
  serving whatever was built when it started (`reuseExistingServer`) — restart it after rebuilding.
- If port 3100 is taken: `E2E_PORT=3200 npm run test:e2e`.
- The fakes are re-bundled by Turbopack; edits under `e2e/fakes` trigger a rebuild automatically.
- `next build` (and `tsc`) touch two tracked files as a side effect: `next-env.d.ts` (adds a
  `.next-e2e/types/…` reference) and `tsconfig.tsbuildinfo`. Don't commit those changes
  (`git checkout -- next-env.d.ts tsconfig.tsbuildinfo`).
