# Hand-off: FinTrack projection engine correctness work

**Written for an agent or developer picking this up cold. Read this file top to
bottom before touching anything.**

Branch: `claude/financial-projections-engine-g5fgkv` (7 commits, all pushed,
working tree clean).

---

## 1. Where the work stands, in one paragraph

The app's financial projection engine had **no tests at all**. A test suite was
built (1,640 tests, 99.93% statement coverage of the logic layer) and in the
process **24 root-cause defects** were found and proven with executable tests.
**No production code has been changed yet** — `git diff origin/main..HEAD -- app/`
is empty. The next phase is fixing those defects and performing two targeted
refactors. Three product decisions are outstanding and are listed in §7; two of
them block part of the work.

|                                  | Status                          |
| -------------------------------- | ------------------------------- |
| Test harness                     | Done, committed                 |
| Test suite (1,640 tests)         | Done, committed, green          |
| Defect discovery + documentation | Done — see `tests/DEFECTS.md`   |
| **Production fixes**             | **Not started**                 |
| **Two refactors**                | **Not started**                 |
| UI/auth/security-rules review    | Explicitly deferred by the user |

---

## 2. The task as the user framed it

Verbatim scope from the user:

> "we'll do UI, auth flow and etc later, we're only concerned on the core feature
> of the app right now, making sure all the logic works and all data displayed in
> the UI is correct"

Interpretation that was agreed and should be carried forward:

- **In scope:** `app/lib/logic/**`, `app/lib/firebase/firestore/**`,
  `app/contexts/FinancialContext/**`, and **the places React components compute
  their own financial numbers** (because those numbers are displayed and are
  wrong — see §6, Phase 5).
- **Out of scope for now:** component structure, styling, layout, the auth flow,
  Firestore security rules (but read §9 — there is a serious finding there that
  must not be lost).

---

## 3. Commands

```sh
npm install                 # node_modules is not committed
npm test                    # 1,566 tests, TZ pinned to UTC
npm run test:tz             # 74 tests at UTC+8 — NOT included in `npm test`
npm run test:all            # both
npm run test:coverage       # v8 coverage over the logic layers
npx tsc --noEmit            # must be clean for tests/ (remotion/ errors are pre-existing)
npx prettier --write "tests/**/*.ts"
```

Expected right now: **1,566 + 74 = 1,640 passing, 0 failing.** 24 test files.
125 of those tests are `it.fails` known-defect tests (see §5).

`npm run lint` is **broken on `main` already** — `npx eslint app/lib/types.ts`
fails with `TypeError: Converting circular structure to JSON` from the
`FlatCompat`/`eslint-config-next` setup. Not caused by this work; don't chase it.

---

## 4. Architecture primer (so you don't have to rediscover it)

FinTrack is a Next.js 16 + TypeScript + Firebase personal-finance app. The core
idea: the user declares **rules** (income sources, expense rules) and the app
projects daily balances forward from them.

**The central design decision: projections are never persisted.** Firestore
stores only rules plus _realized_ transactions (`completed` / `skipped`).
Everything else is recomputed in the browser on every render.

```
IncomeSource[] + ExpenseRule[]
        │
        ▼  generateProjections(sources, rules, viewStart, viewEnd)
        │  app/lib/logic/projectionEngine/projectionGenerator.ts:17
        ├─ generateIncomeProjections  → calculateOccurrences
        └─ generateExpenseProjections → dispatch on expenseType:
               cash_loan   → generateLoanProjections   (amortization)
               credit_card → generateCreditProjections (payoff schedule)
               installment → generateInstallmentProjections
               else        → calculateOccurrences
        ▼
   Omit<Transaction,…>[]  (status: "projected")
        ▼
storedTransactions ──► mergeTransactionsWithProjections
        │              app/contexts/FinancialContext/utils/projectionMerger.ts:8
        ▼
   Transaction[] ──► dailyBalances / billCoverage / runway / healthScore / forecast
```

Orchestration is one `useMemo` in `app/contexts/FinancialContext/index.tsx:85-102`.

### Four concepts you must understand before changing anything

1. **`calculateOccurrences`** (`projectionEngine/occurrenceCalculator.ts:24`) —
   the recurrence expander. One `switch` over 8 frequencies. Returns `Date[]`.
   Capped at `MAX_OCCURRENCES = 500`.

2. **`generateOccurrenceId`** (`projectionEngine/occurrenceIdGenerator.ts:50`) —
   **the cleverest part of the design.** Each occurrence gets an id keyed to its
   _logical period_, not its date: `rent_2026-03` (monthly), `pay_2026-W12` (ISO
   week), `pay_BW7` (bi-weekly), `card_2026-Q2` (quarterly). Because identity
   survives a date change, a user can drag a bill to another day and the engine
   still knows it is the same March rent. **Do not break this property.**

3. **Occurrence overrides** — `Record<occurrenceId, {scheduledDate?, amount?,
skipped?, notes?}>` stored **on the rule** (`app/lib/types.ts:386`).
   Rescheduling a projection writes an override instead of materializing a
   transaction. This is why `TransactionStatus` no longer has `pending`.

4. **The merge** (`projectionMerger.ts`) — stored transactions win over
   projections at the same `occurrenceId`. Projections get deterministic ids
   `proj_${sourceId}::${scheduledDate}::${occurrenceId}` so React keys are stable
   and `transactionActions.ts:32` can reverse-parse them.

### The one design flaw behind most of the money bugs

**Derived state is cached in mutable fields instead of being computed.** Two
places:

- `users/{uid}.currentBalance` is nudged by `adjustUserBalance` on every
  complete/skip/revert. Every money-corruption defect is a missed or
  double-applied delta.
- `loanConfig.currentBalance` / `paymentsMade` / `installmentConfig.installmentsPaid`
  are hand-maintained counters that must stay in sync with completions.

The correct derivation for the balance **already exists and is correct**:
`computeBalanceFromTransactions(initialBalance, transactions)` in
`app/lib/logic/balanceCalculator/computedBalance.ts:16`. Its only caller is the
`reconciliation` module, which nothing calls.

---

## 5. The test harness — read this before writing or changing a test

### Layout

```
tests/
  setup.ts                         restores real timers + clears mocks after each test
  DEFECTS.md                       THE DEFECT LEDGER — 24 root causes → tests
  helpers/
    builders.ts                    fixtures for every entity
    dates.ts                       d(), ymd(), ymdAll(), weekday(), duplicates()
    time.ts                        freezeToday(), freezeAt(), unfreeze()
    firestoreEmulator.ts           in-memory firebase/firestore SDK
    firebaseConfigMock.ts          replaces app/lib/firebase/config
  smoke.test.ts                    proves the harness itself works
  unit/…                           per-module tests
  integration/…                    merge, projected-vs-actual, mutation, lifecycle
  timezone/offsets.test.ts         runs ONLY under vitest.config.tz.ts
```

### Three harness decisions and why they matter

**(a) Firestore is mocked at the SDK layer, not at the app's own module.** The
interesting mutation semantics — balance reversal on re-completion, variance
recalculation, loan counters on revert — live _inside_
`app/lib/firebase/firestore/`. Stubbing that module would mock away the logic
under test. So `tests/helpers/firestoreEmulator.ts` emulates `firebase/firestore`
itself and the **real app code runs against a real (if simple) store**.

Two hoisted mocks are required in any test that touches Firestore (adjust the
relative depth):

```ts
vi.mock("firebase/firestore", () => import("../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../helpers/firebaseConfigMock"));

import * as store from "../helpers/firestoreEmulator";
beforeEach(() => store.__reset());
```

Test-only helpers: `__reset`, `__seed`, `__seedAll`, `__seedEntities`, `__get`,
`__all`, `__count`, `__ops`, `__opsFor`, `__notify`. Collections: `users`,
`income_sources`, `expense_rules`, `transactions`, `alerts`, `balance_history`.

Gotcha: `getUserProfile` returns `snapshot.data()` with no id merge, so a seeded
user document must contain its own `uid` field (`makeUserProfile` does).

**(b) Test date helpers deliberately do NOT use the app's dayjs wrappers.**
`tests/helpers/dates.ts` is built on raw `Date` accessors so the engine's date
handling cannot validate itself. **Keep it that way.** Never assert an engine
date using `formatDate`/`parseDate` from `app/lib/utils/dateUtils`.

**(c) Time is frozen explicitly.** `billCoverage`, `runway`, `healthScore`,
`forecast` and `Timestamp.now()` all read `new Date()`. Use `freezeToday(...)` /
`freezeAt(...)` in every test that touches them. `setup.ts` restores real timers
after each test.

### The `it.fails` convention — THE MOST IMPORTANT THING IN THIS FILE

Known production bugs are encoded as tests that assert the **correct** behaviour,
wrapped in `it.fails` with a `KNOWN DEFECT: ` title prefix and a comment citing
`file:line`. `it.fails` **passes while the assertion fails**, so:

- the suite is green today, and
- **it turns RED the moment you fix the bug.**

**So when you fix a defect, tests will start failing. That is success, not
regression.** Find the root cause in `tests/DEFECTS.md`, then delete the
`it.fails` tests listed against it (or convert them to plain `it` with the
now-correct expectation). One two-line fix can turn six tests red at once —
that is why the ledger exists.

**Critical caveat:** `it.fails` cannot distinguish an `AssertionError` from a
`TypeError`. A test that crashes also "passes", and would report "defect still
present" forever. All 125 have been mechanically verified to fail through a
genuine assertion. **Re-verify after any change to the defect tests:**

```sh
grep -rl 'it\.fails(' tests/ | while read f; do perl -pi -e 's/\bit\.fails\(/it(/g' "$f"; done
npx vitest run --reporter=json --outputFile=/tmp/flip.json
npx vitest run --config vitest.config.tz.ts --reporter=json --outputFile=/tmp/fliptz.json
git checkout -- tests/     # MANDATORY — leaving the flip in place breaks the suite
```

Then confirm every failure message contains `AssertionError` and none contains
`TypeError`/`ReferenceError`. Confirm the restore worked:
`grep -rho 'it\.fails(' tests/ | wc -l` must be **126** — 125 real tests plus one
reference inside a comment block.

When writing a new defect test: assert array length in its own `expect` before
indexing, so a future fix that returns fewer rows produces an assertion failure
rather than a `TypeError`.

---

## 6. The work plan

Full defect detail is in **`tests/DEFECTS.md`** — 24 root causes, each with source
location, correct behaviour, and which test files assert it. Do not duplicate it
here; read it. The phases below are the recommended execution order.

### Phase 1 — Occurrence calculator (defects 1–5)

One function, `app/lib/logic/projectionEngine/occurrenceCalculator.ts`. Clears
roughly 15 defect tests. Highest value per line changed.

Current structure interleaves generation, weekend adjustment and window
filtering, which causes:

- **Defect 1:** `adjustForWeekend` runs _after_ the bounds check, so `"after"`
  can emit past `viewEndDate` and `"before"` can emit before `startDate`.
- **Defect 2:** `daily` adjusts each day independently, collapsing Sat/Sun/Mon
  onto one Monday → duplicate dates **and** duplicate `occurrenceId`s → the day's
  amount counted three times.
- **Defect 3:** `monthly` (`:134`) and `quarterly` (`:154`) test the loop
  condition against `monthCursor`, which carries the _start date's_ day-of-month,
  while the emitted date is built from `scheduleConfig.dayOfMonth`. Trailing and
  mid-stream months get dropped.
- **Defect 4:** `monthOfYear || start.getMonth()` treats a valid January (0) as
  absent.
- **Defect 5:** the `switch` has no `default`, so an unrecognised frequency
  silently returns `[]` and the rule vanishes from every projection.

Recommended restructure — four distinct stages instead of one interleaved loop:

1. **Generate** candidate _logical_ dates per frequency, cursor driven by the
   period being generated (not by the start date's day-of-month), over
   `[startDate, min(endDate, viewEndDate)]`.
2. **Adjust** each candidate for weekends.
3. **Dedupe** (fixes defect 2's duplicates).
4. **Filter** to `[max(startDate, viewStartDate), min(endDate, viewEndDate)]`.

Open sub-decision: when weekend adjustment would push a date outside the allowed
range, should the occurrence be **dropped** or **clamped to the unadjusted
date**? Recommendation: **clamp** — money should not disappear because of a
weekend. **Read the actual `it.fails` tests for defects 1 and 2 before
implementing**, and make the fix match what they assert; they were not
re-inspected for this specific question before hand-off.

Keep the `Date[]` signature in this phase so the diff stays contained.

### Phase 2 — Occurrence identity (defect 6), separate commit

`generateOccurrenceId` currently receives the **weekend-adjusted** date, so an
occurrence pushed across a month/quarter/year boundary silently changes logical
period and orphans its override and its completion record.

Proper fix requires distinguishing the two dates:

```ts
export interface Occurrence {
  /** Period the occurrence belongs to — pre-adjustment. Identity derives from this. */
  logicalDate: Date;
  /** Date the money actually moves — post-adjustment. */
  date: Date;
}
```

Then the generators use `logicalDate` for `generateOccurrenceId` and `date` for
`scheduledDate`.

**Cost warning:** this changes `calculateOccurrences`' return type. Production
callers are only two (`incomeProjections.ts`, `expenseProjections.ts`) but
**roughly 110 test call sites** across
`occurrenceCalculator.shortCycles.test.ts`, `.longCycles.test.ts`, `.caps.test.ts`,
`occurrenceIdGenerator.test.ts`, `transactionFactory+simpleProjections.test.ts`,
`smoke.test.ts` and `timezone/offsets.test.ts` do `ymdAll(occurrences)`.

Alternative with less churn: keep `calculateOccurrences` returning `Date[]` and
add `calculateOccurrencesDetailed(): Occurrence[]` for the generators. Less
elegant, far smaller diff. Either is defensible — decide and be consistent.

### Phase 3 — The `setMonth` month-skip

`currentDate.setMonth(currentDate.getMonth() + 1)` on a month-end date overflows:
Jan 31 → "Feb 31" → **Mar 3**. A whole payment month vanishes.

Two sites, same bug:

- `app/lib/logic/amortization/loanAmortization.ts:63`
- `app/lib/logic/creditCardCalculator/payoffCalculator.ts:57` and `:125`

Fix by using the existing `addMonths` from `app/lib/utils/dateUtils.ts` (dayjs,
clamps correctly), or a shared local helper. Verified wrong outputs:
loan dates `['2026-01-31','2026-03-03',…]`; card due-date-31 dates
`['2026-01-31','2026-03-31']` with February missing entirely.

### Phase 4 — Balance and debt mutation

Two groups. The **pure logic errors** are independent of the refactor and can be
fixed immediately:

| Defect                                               | Location                        | Observed → correct                                              |
| ---------------------------------------------------- | ------------------------------- | --------------------------------------------------------------- |
| Type flip on a completed row                         | `transactionActions.ts:309-323` | 10,600 → 9,400                                                  |
| Delete completed rule-based row skips reversal       | `transactionActions.ts:346`     | 9,600 → 10,000                                                  |
| `addManualTransactionAction` never adjusts balance   | `transactionActions.ts:274`     | 10,000 → 9,600                                                  |
| Editing only `projectedAmount` on a completed row    | `transactionActions.ts:305`     | 9,750 → 9,900                                                   |
| `projectedAmount` taken from `rule.amount`           | `transactionActions.ts:95`      | 999 → 564.88                                                    |
| Variance never stored on the projection path         | `transactionActions.ts:89-110`  | `undefined` → 50                                                |
| Reschedule discards other overrides                  | `transactionActions.ts:228`     | —                                                               |
| Revert loses custom date for most frequencies        | `transactionActions.ts:414-448` | —                                                               |
| Card balance never reduced                           | `transactions.ts:181-192`       | `updateCreditBalance` is dead code; add a `creditConfig` branch |
| Pre-window completed rows corrupt opening balance    | `dailyBalance.ts:27-53`         | 10,500 → 10,000                                                 |
| `getRunway` re-applies completed rows                | `runway.ts:37-46`               | `{days:1}` → `{days:30, null}`                                  |
| Balance trend iterates Map insertion order           | `scoreCalculators.ts:174`       | `declining` → `improving`                                       |
| `getTransactions` limit applied before status filter | `transactions.ts:97-108`        | `[]` → `['c1','c2']`                                            |
| Migration double-counts on every login               | `migrations.ts`                 | 1,500 → 0                                                       |

Then the **refactors** (see §7 decision 1 — the balance one needs the prod-data
answer before touching stored values):

- **Balance → derived.** `computeBalanceFromTransactions` already exists and is
  100% covered. The mutation surface to replace is:
  `transactionActions.ts:114,312,316,322,349`,
  `transactions.ts:163,179,204,245`, `userActions.ts:21`,
  `BalanceSection.tsx:75`. Make the read path derive; either drop the stored
  field or keep it as a cache with a single writer.
- **Debt progress → derived** from completed payments rather than
  `paymentsMade`/`installmentsPaid`/`loanConfig.currentBalance`. Retires
  defects 7–10, including the complete→revert→complete erosion (11,600 → 11,200
  per cycle).

### Phase 5 — Display correctness in components

In scope because these produce wrong numbers on screen.

- `app/components/pages/dashboard/Dashboard.tsx:52` hand-rolls period
  aggregation over `transactions`, duplicating `getPeriodStats`
  (`app/lib/logic/healthScore/periodStats.ts`, tested at 100%). Call the tested
  function instead.
- `app/components/pages/dashboard/components/RecurringSummaryWidget.tsx:11`
  keeps a private copy of `getMonthlyMultiplier` (behaviourally identical to
  `app/lib/utils/frequencyUtils.ts` today, so it is duplication risk rather than
  a live divergence — but delete it and import the canonical one).
- **The substantive one:** four screens estimate monthly totals as
  `amount × multiplier` (weekly = 4.333) while the calendar and daily balances
  count _actual projected occurrences_. So two widgets on the same dashboard can
  disagree about the same month. Screens using the approximation:
  `Forecast.tsx`, `IncomeManager.tsx`, `ExpenseManager.tsx`,
  `RecurringSummaryWidget.tsx`. Decide on one method — occurrence-counting is
  the accurate one — and use it everywhere.

**Note:** the 99.93% coverage figure covers the logic layer only. The UI is
17,961 LOC across 116 components; where components re-implement logic, the tests
do not reach them.

### Phase 6 — Timezone consistency (defect 24)

Three conventions coexist. Replace the wrong two with `parseDate`/`formatDate`
from `app/lib/utils/dateUtils.ts`:

- `useViewDateRange.ts:20-21` — `toISOString().split("T")[0]` on locally-built
  dates; the default window lands a day early and can slide into the wrong month.
- `projectionMerger.ts:31` — `new Date("YYYY-MM-DD")` (UTC midnight) for window
  bounds while occurrences are local midnight.
- `forecastCalculator.ts:26,43` — `toISOString()` day keys vs local
  `scheduledDate` strings.
- `users.ts:93` — `balanceLastUpdatedAt` stamped from the UTC day.

`tests/timezone/offsets.test.ts` (run with `npm run test:tz`) covers all of these
at UTC+8. The pure occurrence engine is asserted to be offset-independent.

---

## 7. OPEN DECISIONS — ask the user before proceeding on these

These were asked and **not yet answered**. Two of them block work.

**1. Is there live production data?** _(blocks the balance refactor's data
handling, not the code)_
Determines whether the derived-balance change can correct stored values directly
or needs a one-time reconciliation that logs discrepancies instead of silently
changing someone's displayed balance. Also relevant because
`migrateToInitialBalance` runs on **every login** and its derived
`initialBalance` double-counts completed history — so existing `initialBalance`
values may already be wrong.

**2. Loan `calculationType`.** The expense form collects
`amortized` / `flat_rate` / `reducing_balance` and stores it; the engine only
ever computes amortized. Options: restrict the form to amortized and drop the
field (smallest, recommended); implement all three; or implement `flat_rate`
only. Until this is answered, the three `it.fails` tests for defect 8 stay as-is.

**3. Credit-card minimum-payment trap.** `payoffCalculator.ts` clamps principal
at 0 so the balance never grows, and bails out after month 12. Real cards
compound. Options: compound (accurate, scarier numbers, also fixes the summary
quoting a finite saving against an `Infinity` baseline); keep the clamp but make
`isMinimumPaymentTrap` authoritative and stop quoting misleading savings; or keep
as-is and close those tests as working-as-designed.

**Lower-stakes judgment calls** — a sensible default can be chosen and flagged
rather than blocking: whether an unrecognised frequency should throw (defect 5);
whether insights should rank by severity rather than push order (defect 21);
whether chart buckets should be zero-filled (defect 22); whether an empty note
should be able to clear an existing note; whether `variance` should attribute to
the scheduled or the actual month.

---

## 8. Traps that will bite you

1. **Fixing a bug turns tests red.** Expected. See §5.
2. **Always `git checkout -- tests/` after the `it.fails` flip.** Forgetting
   leaves the whole suite broken.
3. **`npm test` does not run the timezone suite.** Use `npm run test:all`. CI
   currently runs neither — `.github/workflows/deploy.yml` only builds.
4. **Never assert engine dates with the app's dayjs helpers.** See §5(b).
5. **`npx tsc --noEmit` must be clean for `tests/`.** Earlier agents reported it
   clean while nine errors stood. `remotion/` errors are pre-existing and
   unrelated. Check with `npx tsc --noEmit 2>&1 | grep '^tests/'`.
6. **`npm run lint` is broken on `main`.** Not yours to fix.
7. **Two expected values in the suite were wrong on first authoring** and were
   corrected: a claim that interest savings always exceed the alternative's own
   cost (false for ordinary amortization), and a confusion of
   `effectiveMonthlyPayment` with `doublePayment`. Both had confident,
   plausible-looking comments. When a defect test's premise is a _judgment_
   rather than arithmetic, re-derive it yourself before trusting it.
8. **Don't "fix" a test to make a change pass.** If a fix conflicts with a test,
   one of them is wrong — work out which and say so.
9. **Two agents previously died mid-file** on a spend limit, leaving a missing
   import and two bad assertions. If something looks half-written, it may be.

---

## 9. Deferred, but do not lose this

**There are no Firestore security rules in the repository.** No
`firestore.rules`, no `firebase.json`, no `.firebaserc`. All authorization is
client-side `where("userId", "==", uid)` — those are _queries_, not access
control, and are trivially bypassed from a console.

The rules may be configured in the Firebase console, so the app is not
necessarily exposed — but they are not version-controlled, not reviewable, and
not deployable from source. For an app storing salaries, debts and balances,
whose client-side API includes `deleteAllUserData(userId)` and
`adjustUserBalance(uid, delta)`, this outranks every projection bug.

The user deferred it deliberately. Raise it again before any production deploy.

**Also dead code, found while testing** (relevant because the first item _is_ a
defect fix):

- `updateCreditBalance` (`expenseRules.ts:140`) — correct, exported, called by
  nothing. Wiring it up is most of the fix for defect 9.
- The whole `reconciliation` module — not even re-exported from
  `balanceCalculator/index.ts`. The app has drift detection it never runs.
- `balanceHistory` — nothing writes snapshots, so the history feature is inert.

---

## 10. Environment notes

- Runs in a remote container; `node_modules` is not committed, so `npm install`
  first. Node 22, npm 10.
- **No `gh` CLI.** Use the GitHub MCP tools (`mcp__github__*`) for any PR or
  issue work. Do not create a PR unless the user asks.
- Commit to `claude/financial-projections-engine-g5fgkv`; push with
  `git push -u origin claude/financial-projections-engine-g5fgkv`.
- Set `git config user.email noreply@anthropic.com` and
  `git config user.name Claude` or a stop hook will flag unverified commits.
- The Figma MCP server needs OAuth authorization and is unavailable until the
  user grants it. Irrelevant to this work.

---

## 11. Pre-commit checklist

```sh
npm test                                      # expect 1,566 pass, 0 fail
npm run test:tz                               # expect 74 pass, 0 fail
npx tsc --noEmit 2>&1 | grep '^tests/'        # expect empty
npx prettier --write "tests/**/*.ts" "app/**/*.ts"
```

Plus, whenever you touch a defect test, the flip-verification in §5.

When you fix a defect: update `tests/DEFECTS.md` in the same commit — remove the
root cause or mark it fixed, so the ledger never lies about the current state.

---

## 12. Commit history so far

```
4231d3e docs: add a defect ledger mapping root causes to their tests
ee1ab1f test: close the remaining coverage gaps
70bdce7 test: repair false-negative tests and extend coverage to untested modules
fb00314 chore: ignore vitest coverage output
434a161 test: widen emulator seed types and add missing fixtures
8fe1021 test: comprehensive suite for the projection engine and actual-vs-projected
c9677c3 test: add Vitest harness for the financial projection engine
```

Nothing under `app/` has been modified. The first production change is yours.
