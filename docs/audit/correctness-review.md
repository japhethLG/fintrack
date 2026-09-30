# FinTrack core-logic correctness review

**Scope:** the projection engine, income/expense rules, projected-vs-actual, transactions,
balances and the numbers derived from them. UI structure, styling, auth and Firestore
security rules are out of scope except where a component computes money.

**Method:** I read the logic layer end to end, then ran an independent audit that was
deliberately blind to the two existing deliverables (`tests/DEFECTS.md` + `HANDOFF.md`,
and `docs/audit/finance-logic-audit.md` + its dossiers). Every claim below that is marked
**verified** was reproduced by executing the real production code against a throwaway
Vitest harness, and where a defect is timezone-sensitive it was run under `TZ=UTC`,
`TZ=Asia/Manila` (+8, no DST), `TZ=America/New_York` (−5/−4, DST at 02:00) and
`TZ=America/Santiago` (DST at 00:00).

Baseline I established before forming any opinion:

| Check | Result |
| --- | --- |
| `npx vitest run` | 1,566 passed, 0 failed, 23 files |
| `npx vitest run --config vitest.config.tz.ts` | 74 passed, 0 failed |
| Production code changed by either prior agent | none (`git diff origin/main..HEAD -- app/` is empty) |
| `it.fails` occurrences in `tests/` | 126 (125 tests + 1 in a comment) |
| Flip all `it.fails` → `it` and re-run | 125 failures, **all `AssertionError`**, zero `TypeError`/`ReferenceError` |

---

## 1. Verdict

The core logic is **not sound today**, and the failures are not confined to edge cases —
several fire on default settings for every user. But the picture is more specific than
"lots of bugs":

- **The arithmetic is largely right.** The PMT formula, the credit-card payoff iteration,
  month-end day clamping, the bill-coverage running-balance sequencing, ISO-week
  computation, and `computeBalanceFromTransactions` are all correct. I re-derived each
  independently.
- **The failures are in placement, identity, and state ownership.** Dates land in the
  wrong month; occurrences are labelled with the wrong logical period and collide; and
  money is stored in two places that disagree.
- **The single worst problem is architectural, not a bug:** `users/{uid}.currentBalance`
  is an incrementally-mutated field written from **fifteen call sites**, while
  `computeBalanceFromTransactions` derives the same number from
  `initialBalance + Σ completed`. Both are live and read on screen. Every
  money-corruption defect in the ledger is a missed or double-applied delta on the
  mutable copy.
- **And there is a live destructive path.** The one affordance the app offers for fixing a
  wrong balance — Settings → "Recalculate Balance" — writes a wrong value in **both**
  directions, depending on which of two independent defects the user has hit. Details in
  §3.1. This needs mitigating before anything else.

Both prior deliverables are genuinely useful and largely accurate. Both also share one
blind spot that matters, and each contains factual errors I can point at. §2 covers that.

---

## 2. Assessment of the two prior deliverables

### 2.1 The test suite + defect ledger (`tests/**`, `tests/DEFECTS.md`, `HANDOFF.md`)

**What it establishes, and it does so well.** 1,640 executable tests over the logic layer,
with 125 known defects encoded as `it.fails` tests that assert the *correct* behaviour.
I verified the central integrity claim myself by mechanically flipping every `it.fails`
to `it` in a throwaway git worktree: exactly 125 tests fail, and **every one fails through
a genuine `AssertionError`** — none crashes. That matters, because `it.fails` also passes
on a `TypeError`, which would make a defect test a permanent false positive. The claim
holds.

The expectations are derived, not snapshotted. `tests/unit/loans.test.ts` defines its own
independent PMT implementation and asserts against both it *and* a hand-derived literal
(`564.88`), with the derivation written out in a comment. `tests/helpers/dates.ts` is built
on raw `Date` accessors rather than the app's dayjs wrappers, so the engine cannot validate
its own date handling. Those are the right instincts and they should be preserved.

**Where it is weaker.**

1. **Coverage is narrower than the headline suggests.** The reported ~99.9% statement
   coverage is over a configured subset (`app/lib/logic`, two files in `app/lib/utils`,
   `app/lib/firebase/firestore`, `FinancialContext/utils`, and
   `actions/transactionActions.ts`). Outside that set and untested:
   - `app/lib/utils/currency.ts` — **zero tests**, not in the coverage config, and every
     number on screen passes through it. `formatCurrencyWithSign` defaults to
     `maximumFractionDigits: 0`, so it silently rounds cents away on signed money.
   - every component that computes its own money figures (~116 components, 17,961 LOC);
   - `useComputedFinancials`, `useFinancialActions`, `useFinancialSubscriptions`,
     `sourceActions`, `userActions`.
   This is acknowledged in `HANDOFF.md` §6, but it is where a large share of the
   user-visible errors actually live — including a whole family of date bugs and the
   quarterly expense-rule defect in §3.3.
2. **It spends effort on dead code without saying so.** `calculateForecast` has **zero
   production callers** (grep across `app/` and `remotion/`), yet it carries ~25 test
   references and three `it.fails` timezone tests. The entire `reconciliation` module,
   `calculateMonthlyTotals`, `getChartData`'s sibling `saveBalanceSnapshot`, and
   `createAlert` are likewise uncalled. The ledger has no reachability field, so a dormant
   contract gap and a live money bug read as equally urgent.
3. **The ledger conflates defects with unmade product decisions.** Of the 125 `it.fails`
   tests, several assert a *choice* rather than a correctness property — `flat_rate` /
   `reducing_balance` `calculationType`, projecting the user-entered `monthlyPayment`
   instead of a recomputed PMT, compounding a trapped minimum payment, and whether an
   empty note should clear an existing note. These are labelled `KNOWN DEFECT:` alongside
   genuine arithmetic errors. They should be `it.todo` against a spec line, otherwise the
   ledger blocks the correct fix as loudly as it blocks the wrong one.
4. **Two concrete factual errors in `HANDOFF.md`.**
   - §4 and §9 state that `computeBalanceFromTransactions`' "only caller is the
     `reconciliation` module, which nothing calls". It is not dead:
     [BalanceSection.tsx](../../app/components/pages/settings/components/BalanceSection.tsx#L62)
     calls it at lines 62 and 168, and `syncComputedBalance` at 114 and 135 — that is the
     "Recalculate Balance" button. This mislabelling is why the destructive path in §3.1
     was missed.
   - §6 says the migration "double-counts on every login". It does not:
     `migrateToInitialBalance` is guarded on `initialBalance === undefined || null`, so it
     runs **once per user**. The double-count is real; the trigger description is wrong,
     and the correction matters because it changes the fix (a one-time data repair, not a
     write-path guard).
5. **`projectionMerger.ts:16` is listed as unreachable dead code.** The
   `sourceId-scheduledDate` fallback in `getKey` is reachable and **double-counts money**
   — verified in §3.2.
6. **Governance.** A green suite that hides 125 known money defects is a reporting
   problem. CI (`.github/workflows/deploy.yml`) runs neither `npm test`, nor
   `npm run test:tz`, nor `tsc`, nor lint — it only builds. So none of this work currently
   gates anything.

### 2.2 The read-only audit (`docs/audit/finance-logic-audit.md` + dossiers)

**What it establishes.** Broad coverage that the test suite structurally cannot reach:
the loan and expense forms, currency formatting, proration, the dashboard widgets,
period comparison, and a severity ranking with a recommended fix order. Its refutation
discipline is good — I independently re-checked several of its dismissals and it was right
each time: the mutable `payment` variable in `loanAmortization` is only reassigned on the
final iteration (not live); negative amortization is unreachable because no in-app caller
passes `monthlyPayment` (I confirmed
[LoanDetailsForm.tsx:39](../../app/components/pages/expenses/components/ExpenseRuleForm/components/LoanDetailsForm.tsx#L39)
omits it); `prorateToDateRange` parses both endpoints the same way so its day diff is an
exact integer; weekly ISO-week ids do not collide; and `calculateForecast` really does have
zero callers.

**Where it is weaker.**

1. **Its stated method overstates what was done.** The header claims "3-vote adversarial
   re-verification per cluster". The per-finding record in the dossiers says otherwise:
   **57 of 79 findings are marked `First-round verification: UNVERIFIED (verifier
   crashed)`**; only 18 got "3 votes, 0 refutes" and 4 got "3 votes, 1 refutes". The
   cluster-level pass and the five hand-verified criticals are real, but roughly 72% of the
   raw findings were never individually checked — and one of those unchecked "low" findings
   (F14) turns out to sit in the middle of the worst chain in the codebase.
2. **F14 is badly under-rated.** "Two stored transactions sharing one `occurrenceId`
   silently drop one during merge" is rated **low/edge-case** and unverified. It is
   reachable through ordinary settings and it is the second link in the destructive chain
   in §3.1.
3. **Two factual slips.** F48 says `balanceLastUpdatedAt` is "currently never read" — it is
   rendered in Settings at
   [BalanceSection.tsx:210-213](../../app/components/pages/settings/components/BalanceSection.tsx#L210).
   (The substantive point — that it is never used as a *computation anchor* — is correct
   and important.) And like the ledger, it treats `computeBalanceFromTransactions` as an
   uncalled ideal rather than a live read path.
4. **F33's parsing claim is weaker than stated for the field it cites.** The balance inputs
   in `BalanceSection` are `type="number"`, whose `.value` cannot contain grouping
   separators, so `parseFloat("1,234.56") === 1` is not reachable there. The general
   concern about `parseFloat` on user amounts still stands for any `type="text"` amount
   field.
5. **No executable artifact.** Nothing in it prevents a regression, and its numeric
   scenarios cannot be re-run.

**Scoreboard on its five criticals.** I re-derived all five from scratch. All five root
causes exist and reproduce, which is a good result. Three are exact as published; two need
correcting:

| Cluster | Verdict |
| --- | --- |
| C6 balance loses pre-window history | **confirmed, numbers exact**; critical is if anything *understated* |
| C14 completed manual type flip | **confirmed, numbers exact**; critical defensible |
| C1 UTC view-range drops paydays | **confirmed, numbers exact**; but its premise is wrong — see below |
| C7 runway/crunch double-count | confirmed, numbers exact, **severity inflated** → high, not critical |
| C4 loan anchor / EMI | confirmed, but **§2.4's arithmetic is wrong** — and the magnitude is understated |

- **C7 is high, not critical.** The impact is two read-only metrics on one page
  (`Forecast.tsx:273-274` → `MetricsGrid`), nothing is persisted, and it self-clears once
  the day rolls over — only completed rows dated today-or-later are double-applied. It is
  also partly self-cancelling, because F54 drops overdue outflows from the same walk.
  Separately, F51's stated mechanism ("crunches caused by carried-over deficits") *cannot
  fire* — the day a balance crosses zero necessarily has expenses and is reported. The gate
  is reachable by a different route the audit did not identify: an already-overdrawn user,
  where `getRunway(-100, [])` returns `{days: 0}` while `getNextCrunch(-100, [])` returns
  `null`.
- **C4's §2.4 numbers are spliced from two dossiers.** For the stated scenario (start
  `2026-01-15`) the correct dates are `2026-04-15 … 2026-12-15`, not `…-10` — the day-10
  figures come from dossier F43, which uses a different start date. And the regenerated
  11-month EMI is **1157.45 (+8.56%)**, not 1153.5. Each dossier is internally consistent;
  the merged summary is not.
- **C1's premise is wrong in a way that changes the fix.** §2.5 says the default window
  lands on the 1st and last of a month "so monthly income lands exactly on the dropped
  boundaries in default usage". Measured in Asia/Manila the default window is
  `{2026-03-31, 2026-09-29}` — `useViewDateRange`'s own `toISOString` bug shifts it back a
  day and thereby *masks* the start-boundary drop. The first-of-month payday drop needs an
  exact local month string, which arrives via `CalendarView` month navigation or the
  Dashboard/Forecast/Transactions date pickers. The practical consequence is a sequencing
  constraint: fix `projectionMerger` alone and you move which day is dropped instead of
  stopping the dropping.

### 2.3 How they relate — and the trap in combining them

They are close to complementary. The suite owns the mutation and persistence layer with
executable proof; the audit owns the display layer and reachability reasoning with cheap
breadth. The clean split is stark: **zero of the audit's 79 findings are anchored anywhere
in `app/lib/firebase/firestore/**`** (I extracted every `File:` line from all 19 dossiers
and checked — not one), which is exactly where most of the ledger's money-corruption
defects live. Conversely the suite touches no component at all.

Where they agree, they agree strongly, and those are the safest things to fix first:
`dailyBalance` reversing all completed history but replaying only the window; `getRunway`
re-applying completed rows; the UTC-vs-local view window; `occurrenceId` from the
weekend-adjusted date; the loan anchor not advancing by `paymentsMade`; the type flip on a
completed manual row; `projectedAmount` from `source.amount`; and the `setMonth` overflow.
Each is established twice over — by a failing assertion and by code reading.

**But you cannot simply apply the audit's fix list on top of the suite, and this is the
most important practical conclusion of this review.** In at least six places the suite
contains a *passing* test that pins as intended the exact behaviour the audit calls a bug.
I verified three of these by reading the test bodies:

| Behaviour | Suite (passing test) | Audit |
| --- | --- | --- |
| `prorateToDateRange` 30-day divisor | asserts `3100` for a 31-day March; comment: *"The fixed divisor is deliberate"* | C10/F27 — medium bug, skews every Forecast budget baseline 3.3% |
| `getBillCoverageReport` window | pins `[today, today+14]` = 15 days in two tests | C12/F58 — off-by-one, use `daysAhead - 1` |
| `calculateBillPaymentScore` ignores overdue | asserts `{score: 100, rate: 100}` with a bill overdue; comment: *"the record stays perfect"* | C8/F76 — should be 25% |
| `calculateVarianceReport` completed-only baseline | asserts `projected: 100`, deliberately excluding an in-range 999 projected bill | C11/F56 — should be 1099 |
| `getNextCrunch`'s `dayExpenses > 0` gate | a whole passing `describe` block characterising it | C7/F51 — drop it to match `getRunway` |
| `getMonthlyMultiplier` daily = 30 | asserts `toBe(30)` | C10/F6 — inconsistent with `52/12` |

Fixing any of these turns a green test red, and `HANDOFF.md` §8 trap 8 then instructs the
next person: *"If a fix conflicts with a test, one of them is wrong."* The comments make
the test look authoritative. Someone working from these two documents will either abandon
a correct fix or spend a long time deciding they are allowed to change a test.

None of the six is resolvable by testing or by auditing — they are product decisions about
window inclusivity, the proration convention, what "projected" means in a variance report,
and whether an overdue bill exists. `SPECIFICATION.md` is the only thing that could settle
them and **neither agent consulted it**. It settles two outright: §3.5 specifies
"Next 14 days of bills", so the 15-day window is a spec violation, not a design choice; and
§2.5's `BalanceSnapshot` carries `projectedIncome`/`projectedExpenses`, so `DayBalance`
zeroing them is an unimplemented feature rather than a dormant contract gap. I list the
rest as decisions in §6.

Three further mismatches worth knowing before you trust either ledger:

- **The suite ships one broken defect test.** `tests/unit/loans.test.ts:612` asserts
  `projections.find(t => t.scheduledDate === "2026-01-01")?.paymentBreakdown?.paymentNumber === 1`.
  Its own comment concedes that after the correct fix "the first projection is legitimately
  payment 4 **and** dated 2026-04-01" — so `find` returns `undefined`, optional chaining
  yields `undefined`, the assertion still fails, and `it.fails` keeps reporting "defect
  still present" forever. This is precisely the false-positive class `HANDOFF.md` §5 warns
  about, and the file's own rule ("assert array length in its own `expect` before
  indexing") was not applied here. The very next test asserts the *opposite* convention
  (`paymentNumber` 6 and 7 by absolute loan position) and does guard its dates — so the
  suite contains two `it.fails` tests demanding incompatible `paymentNumber` semantics.
- **Four audit refutations are wrong or too narrow.** F61 was dropped with no reason and
  the suite has a live failing assertion against it (a bill reported inside a 14-day window
  with `daysUntilDue = 52`). F4 refutes the half of its own claim that F4 had already
  conceded (clamping is fine) and silently drops the live half. F32's refutation is correct
  for `BalanceSection`'s 0.01 guard and blind to the unguarded second consumer. F8-weekly's
  collision refutation is correct but is then generalised in §6 into "weekly ids are fine";
  the suite shows the whole weekly series is labelled one ISO week late. That last one is a
  genuine non-conflict dressed as one: *two occurrences colliding on one id* and *one
  occurrence changing its id* are different claims, and both documents are right about
  their own.
- **The audit recommends mirroring a module it never audited.** C4's prose fix is "mirror
  installments", citing `installmentProjections.ts:35-37` as correct three times. The suite
  proves five defects in that file — including the cursor drift I reproduced in §3.6
  (Jan 31 → Feb 28 → **Mar 28**). The audit's concrete one-line fix happens to be safe; its
  written recommendation propagates a bug.

---

## 3. My own findings

Everything in this section was reproduced against production code. Numbered `N-*` so they
can be referenced independently of either prior ledger.

### 3.1 N-1 (critical, new): "Recalculate Balance" corrupts the balance, in both directions

`Settings → Balance Management` shows the stored `currentBalance` next to a balance
derived by `computeBalanceFromTransactions(initialBalance, transactions)`. When they differ
by more than a cent it renders **"Balance mismatch detected"** and offers
**"Recalculate Balance"**, which writes the derived value over the stored one via
`syncComputedBalance`. Both prior deliverables classified this derivation as dead code, so
neither examined it. It is live, and it is reachable in two independent ways that push the
error in opposite directions.

**Path A — the derived value is too low.** `transactions` from the context is the *merged*
list, and the merge silently drops a stored row when two stored rows share an
`occurrenceId`. A semi-monthly salary on `[15, 30]` with `weekendAdjustment: "after"`
produces two March occurrences that share the id `inc-1_2026-03-2` (see N-2). Complete
both paychecks and one of them disappears from every derived figure:

```
1. Firestore truth: initialBalance 10000 + 28000 + 25000 = 63000
2. what the UI sees: txn-mar30[completed] 25000   proj_inc-1::2026-03-30::[projected] 30000
   txn-mar16 present in merged output? false
3. BalanceSection "computed from N transactions" shows: 35000
4. mismatch banner -> FIRES, quoting 28000
5. clicking "Recalculate Balance" writes 35000 over the correct 63000
   -> permanent loss of 28000
```

**Path B — the derived value is too high.** `migrateToInitialBalance` sets
`initialBalance = currentBalance` for any profile predating the field. Because
`currentBalance` already contains the completed history, the derived balance then counts
that history twice:

```
before migration: currentBalance=23000, initialBalance=undefined
after migration:  initialBalance = 23000   (should be 5000)
BalanceSection "Computed from 6 transactions" = 41000
mismatch banner: FIRES, quoting 18000
clicking Recalculate writes 41000 over the correct 23000 => inflated by 18000
after 2nd login: initialBalance = 23000   (migration is guarded, so it runs once)
```

Every affected user sees a permanent, plausible-looking mismatch warning inviting them to
press a button that makes their balance wrong. **Mitigate this before any other work**
(§6).

### 3.2 N-2 (high, partly new): a stored row with no `occurrenceId` double-counts

`getKey` is `t.occurrenceId || (t.sourceId ? \`${t.sourceId}-${t.scheduledDate}\` : t.scheduledDate)`.
Projections always carry an `occurrenceId`, so their key is always the id; a stored row
without one keys on `sourceId-date` and can therefore never match — and never suppress —
its own projection. The residual pass then re-adds it, so both rows are emitted:

```
rows: proj_rent::2025-01-01::rent_2025-01[projected] 1000   legacy1[completed] 1000
total expense counted: 2000  (truth 1000)
same row WITH occurrenceId -> rows: 1  total: 1000
```

`tests/DEFECTS.md` lists this line under "dead code and unreachable branches". The
reachable population is rule-based completed/skipped rows written before occurrence ids
existed — and this repo carries migrations for two earlier data models, so that population
plausibly exists. One-line fix; the merge should reconstruct the id from the source, or key
projections under both forms.

### 3.3 N-3 (high, new): every quarterly expense rule created in the UI is wrong

`buildScheduleConfig` in the **expense** form handles `semi-monthly`, `weekly`,
`bi-weekly` and `monthly` — and has no `quarterly` or `yearly` case, so it writes
`scheduleConfig = {}`. The engine's quarterly branch then falls back to
`scheduleConfig.dayOfMonth || 1`, which is `1` rather than the start day (the monthly
branch correctly falls back to `start.getDate()`). The first payment is earlier than
`startDate` and gets filtered out, and every later payment moves to the 1st:

```
scheduleConfig {} (what the expense form writes): 2026-05-01 2026-08-01 2026-11-01
with dayOfMonth:15 (what the user chose):         2026-02-15 2026-05-15 2026-08-15 2026-11-15
```

The form's own `SchedulePreview` shows the *correct* dates, because it reimplements
occurrence stepping locally — so the user approves a schedule the engine will never
generate. The **income** form does have a `quarterly`/`yearly` case, so the two forms
diverge; and the branch it added persists `monthOfYear` from
`new Date(values.startDate).getMonth()`, which is a UTC parse feeding a local getter — so
in a negative-offset zone a yearly income source is **saved with the wrong month**, and a
January start (`monthOfYear: 0`) then hits the `||`-treats-zero-as-absent bug in the same
expression. Three defects stacked on one field.

### 3.4 N-4 (medium/high, new): a non-positive `intervalWeeks` freezes the tab

Every loop in `calculateOccurrences` is bounded by `occurrences.length < MAX_OCCURRENCES`
— it counts *output*, not *iterations*. Occurrences are only pushed when the cursor is
inside the view window, so a cursor moving away from the window never increments the guard.
`scheduleConfig.intervalWeeks || 2` rejects `0` but passes negatives straight into
`addWeeks`:

```
intervalWeeks=  2 -> occurrences=16 iterations=16          2ms
intervalWeeks=  1 -> occurrences=31 iterations=31          1ms
intervalWeeks= -2 -> occurrences=1  iterations=5000001  *** NON-TERMINATING ***  12818ms
intervalWeeks=  0 -> occurrences=16 iterations=16          0ms
```

`generateProjections` runs synchronously inside a `useMemo`, so this is a permanently
frozen tab. The current UI hard-codes `intervalWeeks: 2`, so it is not reachable by a
normal user — but there are no Firestore security rules in the repository and no
server-side validation, so the field is whatever the document says. The same
count-the-output structure also means an old `startDate` burns thousands of no-op
iterations per rule per render, which *is* reachable.

### 3.5 N-5 (medium, new): the alerts feature is inert

`createAlert` is exported and never called anywhere in `app/`. The context subscribes to
an `alerts` collection nothing writes, and only `markAlertAsRead`/`dismissAlert` are
wired. `SPECIFICATION.md` §3.5 lists "Overdue Alerts" as a shipped feature. Not a maths
bug, but it means the safety net the spec promises does not exist.

### 3.6 What I independently confirmed and quantified

An exhaustive differential test — a reference implementation of the occurrence engine
(generate on the period axis → adjust for weekends → dedupe → filter to the window),
swept across 8 frequencies × 3 weekend modes × 360 rule configurations per combination —
gives the blast radius rather than one example each:

| Frequency / mode | Configs wrong | Dates missing | Extra/duplicate dates |
| --- | --- | --- | --- |
| `daily` + `before`/`after` | 357 / 360 | 0 | 18,768 / 18,876 |
| `semi-monthly` + `before` (Feb–May window) | 150 / 360 | 150 | 0 |
| `monthly` + `before` (Feb–May window) | 61 / 360 | 50 | 11 |
| `monthly` + `after` (Feb–May window) | 10 / 360 | 10 | 0 |
| `quarterly` + `before`/`after` | 21 / 10 | 20 / 10 | 1 / 0 |
| `yearly` (configured January) | 176 / 360 | 0 | 176 |

A separate sweep over the monthly trailing-drop alone found **3,654 of 24,304**
`(startDay, dayOfMonth, windowEnd)` triples lose their final occurrence.

Composed end-to-end through `mergeTransactionsWithProjections` + `calculateDailyBalances`:

- **Pre-window completed history is deleted from every displayed balance.**
  `currentBalance = 5000` with `+4000` completed in Aug 2025 and a March 2026 window shows
  an opening *and* closing balance of **1000** in all three timezones. Correct is 5000.
- **Runway declares the user broke on a normal day.** `currentBalance = 100`, already net
  of a 200 bill completed today → `getRunway` returns `{days: 0, runOutDate: today}`.
- **And overstates in the other direction.** Balance 300 with an unpaid 400 bill dated
  yesterday → `{days: 365, runOutDate: null}`.
- **A daily rule with weekend adjustment double-bills a weekday and bills outside the
  window.** Window `2026-02-02..2026-02-08` emits 7 rows over 6 distinct dates, two of
  them dated `2026-02-09` — *after* the window end — and nothing on Sat/Sun. Under
  `TZ=America/New_York` the duplicate moves to `2026-02-02` instead, because the UTC-parsed
  window bound and the weekend collapse compound.

Date-stepping, verified:

```
loan start Jan 31:  2026-01-31 2026-03-03 2026-04-03 2026-05-03 ...   (February skipped, then locked to the 3rd)
installment Jan 31: 2026-01-31 2026-02-28 2026-03-28 2026-04-28 ...   (drifts: clamped value becomes the new anchor)
card start Feb 10, dueDate 31: first payment 2026-03-31              (February skipped, one month late)
card start Jan 5,  dueDate 31: 2026-01-31 2026-03-31 ...             (February missing entirely)
installment with frequency "one-time": all 6 ids are inst-1_once     (merge collapses them to one)
```

A settled credit card (`currentBalance: 0`) reports `monthsToPayoff: Infinity`,
`totalInterestToPay: Infinity` and `isMinimumPaymentTrap: true`, because the payoff loop
exits immediately and `willPayOff` is derived from an empty schedule. This is rendered by
`ExpenseRuleDetail`, so it is user-visible.

### 3.7 N-6 (critical, sharpens a known defect): the loan-balance update is unreachable

Both prior deliverables describe the loan problem as "the two completion paths disagree".
It is worse than that — for loans, the balance update never runs at all. The chain:

1. A loan payment is always a projection, so `markTransactionCompleteAction` takes the
   `proj_` branch.
2. That branch creates the stored transaction at `transactionActions.ts:89-110` **without a
   `paymentBreakdown`** (and with `projectedAmount: source.amount` rather than the
   amortized step payment).
3. `completeTransaction`'s loan branch is gated on `rule?.loanConfig && transaction.paymentBreakdown`.
4. So `updateLoanBalance` — the only code that reduces `loanConfig.currentBalance` — is
   **never reached for a loan**.

`loanProjections` then re-derives PMT from an unchanged balance over a shrinking term, so
the projected instalment inflates monotonically. Verified, for a 10,000 @ 5% / 12-month
loan whose true payment is 856.07:

```
paymentsMade  0 -> 856.07   (12 rows)
              1 -> 931.98   (11 rows)
              2 -> 1023.06  (10 rows)
              3 -> 1134.39  ( 9 rows)
              4 -> 1273.55  ( 8 rows)
              5 -> 1452.48  ( 7 rows)
```

And because the schedule is re-anchored at `rule.startDate`, the regenerated leading rows
collide with the completed months and get masked by the merge, so after three payments the
calendar contains **nine occurrences for a twelve-payment loan** — payments #4, #5 and #6
exist nowhere, and the projected remaining outflow reads 5,136.45 against a true 7,704.67.
The stored completed row also loses its principal/interest split entirely.

**This also settles the one substantive disagreement between the two ledgers.** They
disagree about what `paymentNumber` should be: the suite asserts the payment at
`rule.startDate` is number 1, the audit says it must be the absolute position in the loan.
The audit is right, and there is a decisive argument neither document made — the current
value depends on the *viewport*:

```
view 2026-01-01..2026-12-31 -> the 2026-06-15 occurrence reports paymentNumber 6
view 2026-06-01..2026-06-30 -> the same occurrence reports paymentNumber 1
view 2026-12-01..2026-12-31 -> the final payment reports 1, not 12
```

A number that changes when the user scrolls the calendar cannot be correct under any
convention. Fix: attach the absolute index before filtering. Note that this makes the
suite's `loans.test.ts:612` unsatisfiable, per §2.3 — that test must be rewritten, not
satisfied.

**Where it ends.** Both prior deliverables understate the escalation. Simulating successive
projected completions on a 12,000 loan with the balance never reduced:

```
1066.19 -> 1157.45 -> 1266.98 -> 1400.88 -> 1568.28 -> 1783.54
        -> 2070.58 -> 2472.48 -> 3075.37 -> 4080.27 -> 6090.15 -> 12120.00
```

and once `paymentsMade` reaches `termMonths`, `generateLoanProjections` returns `[]` — the
loan **disappears from the calendar, forecast and bill coverage entirely**, while
`loanConfig.currentBalance` is still the full 12,000 and `isActive` is still `true`. It
never gets marked paid off, because the payoff check (`isActive: newBalance > 0`) lives in
`updateLoanBalance`, which as shown above is never reached.

Summed over a realistic loan, the total the app tells the user they will pay is far from the
truth: for 100,000 @ 12% over 24 months, **391,729 against a correct 112,976 — 3.5×**.

### 3.8 N-7 (high, extends a known defect): the type-flip corruption compounds

The audit's C14 describes one broken branch (completed → completed). There are three, and
the error grows rather than staying flat:

- The `!wasCompleted && nowCompleted` branch (`transactionActions.ts:313-316`) signs its
  delta from `existing.type` too, so a projected income of 100 edited to *expense +
  completed* moves the balance **+100 instead of −100** — off by 200.
- After the audit's own case-A edit (completed income 100 flipped to expense, amount
  unchanged, no branch fires), **deleting the row** reverses using the *new* persisted type,
  taking a balance of 1,000 to 1,200 against a correct 1,000. The drift doubles.

The completed → projected revert branch is correct, verified.

There is a matching asymmetry on create/delete: `addManualTransactionAction` never adjusts
the balance, but `removeTransactionAction` does. So each add-completed-then-delete cycle
corrupts the balance by **twice** the amount — add a completed 1,000 expense at balance
10,000 → still 10,000 (should be 9,000); delete it → 11,000 (should be 10,000).

### 3.9 N-8 (critical, new): editing a loan or installment rule resets its progress

`ExpenseRuleForm.handleSubmit` is used for both create and edit — `isEditing` only changes
the button label — and it rebuilds the config objects from scratch with the counters
**hard-coded to zero**:

```ts
formData.loanConfig        = { ..., paymentsMade: 0 }        // index.tsx:222
formData.installmentConfig = { ..., installmentsPaid: 0 }    // index.tsx:246
formData.isActive          = true                            // index.tsx:203, unconditional
```

`editExpenseRuleAction` → `updateExpenseRule` merges `loanConfig` wholesale, so **renaming a
loan resets its payment progress to zero.** Every already-paid instalment reappears as a
future projection, the amortization anchor snaps back to the original start date, and a
deactivated or paid-off rule is silently reactivated. Combined with N-6 (the balance is
never reduced either), a loan becomes effectively immortal: full balance, zero payments
made, projecting from the beginning again.

### 3.10 N-9 (critical, new): blank optional card fields are persisted as `NaN`

`creditMinPaymentPercent`, `creditMinPaymentFloor`, `creditStatementDate` and
`creditDueDate` are all `yup.string().optional()`, and their validators are written
`!value || …` — so an empty string passes. The submit handler then calls `parseFloat` /
`parseInt` on them unconditionally:

```
parseFloat("") = NaN            parseInt("") = NaN
payment with NaN pct/floor = NaN   principal = NaN   next balance = NaN
```

`NaN` is written to Firestore and flows into `calculateDecliningMinimumPayoff`, where
`balance > 0.01` is `false` for `NaN`, so the loop emits exactly one `NaN` payment and
stops. That single row then poisons every downstream sum — one `income + NaN` makes the
whole day's balance, and every subsequent day's, `NaN`. `dueDate: parseInt("")` additionally
produces `setDate(NaN)` → an Invalid Date. Fix: require the fields, or coerce with a
default before parsing.


---

## 4. Remediation plan: what to fix, what to refactor

The distinction I am drawing: **fix** where the code has one wrong expression and the
surrounding design is sound; **refactor** where point fixes would leave the shape that
keeps producing the same class of defect. Six areas need a refactor. Everything else is a
local fix.

Ranked by user impact, with the affected area and the verdict:

| # | Problem | Area | Verdict |
| --- | --- | --- | --- |
| 1 | "Recalculate Balance" writes a wrong balance in both directions (N-1) | Settings + balance ownership | **gate now**, then R3 |
| 2 | Every displayed balance is off by the whole pre-window completed history | `dailyBalance` | fix (one filter) |
| 3 | Two sources of truth for the balance; 9 writers, 6 defect classes | balance ownership | **R3** |
| 4 | Occurrence identity derived from the shifted date → collisions, overrides hitting the wrong month, stored rows dropped | identity + merge | **R2** |
| 5 | Loan balance update is unreachable; instalment inflates ~9%/payment; 3 payments vanish (N-6) | loans + completion | **R6** + fix |
| 6 | Whole periods dropped or duplicated by the occurrence engine (15% of monthly configs; 99% of daily+weekend configs) | occurrence engine | **R1** |
| 7 | Non-UTC users lose paydays, the window's last day, and chart months; one form persists a wrong month | date conventions | **R4** |
| 8 | Runway/crunch double-count completed rows and ignore overdue ones; three functions disagree | risk views | fix |
| 9 | Every quarterly expense rule created in the UI is wrong, and the form preview lies (N-3) | forms + engine | fix + **R5** |
| 10 | Manual type flip, add-as-completed, delete-completed all skip the balance | mutations | fix (subsumed by R3) |
| 11 | Card first payment overflows; February skipped; settled card reports `Infinity`; scenarios quote savings against a truncated baseline | credit cards | fix |
| 12 | Health score: zero-income masking, sign-inverted trend, overdue bills excluded | health score | fix |
| 13 | Cents silently rounded off every signed figure | `currency.ts` | fix |
| 14 | Widgets on one screen disagree about the same month | display layer | **R5** |
| 15 | A negative `intervalWeeks` freezes the tab (N-4) | occurrence engine | fix (in R1) |
| 16 | Editing a loan/installment rule resets its progress to zero and reactivates it (N-8) | expense form | fix (4 lines) |
| 17 | Blank optional card fields persist as `NaN` and poison every later balance (N-9) | expense form | fix |
| 18 | Re-completing double-counts a debt payment; skipping a completed one leaves it permanently "paid" | persistence | fix (subsumed by R6) |

### Refactor R1 — the occurrence engine becomes a four-stage pipeline

`calculateOccurrences` interleaves generation, weekend adjustment and window filtering in
one 8-branch `switch`, and that interleaving *is* the bug source. Restructure into stages:

1. **Generate** candidate *logical* dates on the period axis, with the cursor driven by the
   period being generated — normalised to day 1 of the anchor month for monthly/quarterly
   (the semi-monthly branch already does this correctly and is the model), an integer year
   for yearly, an index off the anchor for weekly/bi-weekly.
2. **Adjust** each candidate for weekends.
3. **Dedupe** by resolved date.
4. **Filter** to `[max(startDate, viewStart), min(endDate, viewEnd)]` on the **adjusted**
   date, with bounds normalised to day granularity.

Return `Occurrence { logicalDate, date }` rather than `Date[]`, so identity can key off
`logicalDate` (that is R2). To bound the diff, keep `calculateOccurrences(): Date[]` as a
thin wrapper and add `calculateOccurrencesDetailed(): Occurrence[]` for the four
generators — production callers are only two, but roughly 110 test call sites do
`ymdAll(occurrences)`.

Also in this pass, because they are the same function: normalise the guard to count
*iterations* not output (N-4); sanitise `intervalWeeks` to `>= 1`; scale
`MAX_OCCURRENCES` to the window or return a `truncated` flag; `?? ` instead of `||` for
`monthOfYear` and `dayOfMonth`; `dayOfMonth ?? start.getDate()` for quarterly; a `default`
branch on the `switch`; sort and dedupe `specificDays`; and a lower bound in
`clampDayToMonth`.

Clears: the monthly/quarterly trailing drop (3,654 of 24,304 configs), the daily weekend
collapse, the semi-monthly clamp duplicates, weekend-adjustment escaping the window and the
rule's own `startDate`, the January `monthOfYear`, the weekly alignment drop, the silent
unknown-frequency return, and the non-terminating loop.

### Refactor R2 — occurrence identity keys off the logical period

Feed `logicalDate` to `generateOccurrenceId`, never the adjusted or overridden date. Derive
the semi-monthly slot index from the position in the sorted `specificDays` array that
produced the occurrence, not by re-deriving it from the output date (the current fallback is
capped at slot 2 and cannot express a third scheduled day). Count bi-weekly intervals in
whole calendar days via dayjs rather than dividing millisecond deltas — the current code
collides across a DST spring-forward (`2025-03-01` and `2025-03-15` both `sal_BW1` in
`America/New_York`, 21 distinct ids for 22 occurrences, verified).

Then make the merge defensive rather than trusting: key stored rows as
`Map<string, Transaction[]>`, match at most one stored row per projection, emit every
stored row that was not consumed, and assert that output ids are pairwise distinct. Add the
`sourceId-scheduledDate` fallback for stored rows that predate occurrence ids (N-2).

This is the fix that closes the destructive path in §3.1(A), and it is the one that must
not be done as a point fix: overrides, completions and React keys all hang off identity.

### Refactor R3 — one owner for the balance

`currentBalance` is written from fifteen call sites and has a live derived twin. Make the read path derive from
`initialBalance + Σ completed` and either drop the stored field or keep it as a cache with a
**single** writer that recomputes rather than nudges. `computeBalanceFromTransactions`
already exists, is correct, and is 100% covered — this is mostly deletion.

The mutation surface to replace: `transactionActions.ts:114,312,316,322,349`,
`transactions.ts:163,179,204,245`, `userActions.ts:21`, `BalanceSection.tsx:75`.

Two prerequisites, both data-level: repair `initialBalance` for profiles the migration
seeded from `currentBalance` (§3.1(B)), and decide what a past-dated still-`projected` row
means (§6 D5) — the derived balance cannot be defined without that answer.

Clears: the manual type flip, delete-completed-rule-based, add-manual-as-completed,
edit-projectedAmount-only, the re-completion reversal, and the spurious mismatch banner.

### Refactor R4 — one date convention, enforced

A calendar day is a `YYYY-MM-DD` string in the user's local zone. The only permitted
string→Date conversion is `parseDate`; the only permitted Date→string conversion is
`formatDate`; "today" is always `getTodayKey()`; elapsed days use
`dayjs(a).startOf("day").diff(dayjs(b).startOf("day"), "day")`; month stepping never uses
`setMonth`. Add an ESLint `no-restricted-syntax` rule for `new Date(<string>)` and
`toISOString` under `app/` so it cannot regress, and run the whole suite under a TZ matrix
in CI rather than one file at UTC+8.

Sites, all verified: `useViewDateRange.ts:20-21`, `useComputedFinancials.ts:21-22`,
`projectionMerger.ts:31-32`, `chartData.ts:42,50,54,73`, `forecastCalculator.ts:26,43`,
`PeriodComparison.tsx:24`, `IncomeSourceForm/formHelpers.ts:101` (this one **persists** a
wrong `monthOfYear`), `LoanDetailsForm.tsx:43`, `users.ts:34,93`, `migrations.ts:96,205`,
nine `new Date().toISOString()` "today" sites, and thirteen display sites that render a
stored date through `new Date(str)`. Also `getDaysBetween` and the daily cursor, which
iterate on wall-clock instants and so lose the range's final day in any zone whose
**spring-forward** happens at 00:00 — this is not UTC-sign-related (America/Santiago and
Asia/Beirut both lose a day; fall-back windows are unaffected). Iterate by index instead.

**Sequencing note that matters.** `useViewDateRange` and `projectionMerger` must be fixed
**together**. The hook stamps its bounds a day early east of UTC, which accidentally
*masks* the merger's start-boundary drop; measured in Asia/Manila the default window is
`{2026-03-31, 2026-09-29}` where `{2026-04-01, 2026-09-30}` was intended. Fixing only the
merger moves which day gets dropped rather than stopping the dropping.

This is a refactor rather than 30 fixes because the value is in the invariant plus the lint
rule; changing the sites without them just resets the clock.

### Refactor R5 — the display layer stops doing its own maths

Move every money computation out of components into `app/lib/logic/**`, then test it there.
Concretely:

- `Dashboard.tsx:52` hand-rolls period aggregation — call `getPeriodStats` and extend it
  with the status counts it wants.
- `RecurringSummaryWidget.tsx:11` keeps a private `getMonthlyMultiplier` — import the
  canonical one. (`income/constants.ts` and `expenses/constants.ts` already just re-export
  it, so this is the only real duplicate.)
- `SchedulePreview.tsx:29-124` reimplements occurrence stepping with different overflow
  rules, so the form shows the user dates the engine will never generate. Three separate
  divergences, all verified: quarterly from Jan 31 previews `2026-05-01, 2026-08-01,
  2026-11-01` where the engine gives `2026-04-30, 2026-07-31, 2026-10-31`; the weekly and
  bi-weekly branches **ignore `dayOfWeek` entirely** (the prop is never even passed), so
  every previewed weekly date is on the wrong weekday; and with no end date the horizon is
  `addMonths(start, 3)` regardless of frequency, so the quarterly and yearly previews render
  exactly **one** tile. It also applies the weekend adjustment *after* its bounds test, so
  with the income form's default `"before"` a Saturday first occurrence is shown *before*
  the rule's own start date. Delete the whole thing and call `calculateOccurrences`.
- `loanConfig.firstPaymentDate` and `loanConfig.loanStartDate` are both persisted
  (`ExpenseRuleForm/index.tsx:220-221`) and **neither is ever read** — the engine anchors on
  `rule.startDate` while the preview anchors on the `loanStartDate` field, so the previewed
  schedule can differ from the projected one by an arbitrary number of days, not just the
  one-day UTC shift. Pick one field and delete the others.
- Four screens estimate monthly totals as `amount × multiplier` while the calendar counts
  actual projected occurrences, so two widgets on one dashboard can disagree about the same
  month. Pick occurrence-counting — it is the accurate one — and use it everywhere.
- `buildScheduleConfig` exists in two divergent copies (income handles
  `quarterly`/`yearly`, expenses does not — N-3). One implementation, shared.
- `ProjectedVsActualWidget.tsx:22-25` buckets both accumulators by one key; bucket projected
  by `scheduledDate` and actual by `actualDate`, and use `??` not `||` so a real
  `actualAmount` of 0 survives.

### Refactor R6 — one completion path

Most gestures have two implementations: one for a `proj_` id and one for a stored row, and
they produce different state from the same user intent. Collapse them: resolve the
projection to a concrete occurrence, then call one function that applies every consequence
(stored row, balance, debt counters, variance, override cleanup). Derive debt progress from
completed payments rather than the hand-maintained `paymentsMade` /
`installmentsPaid` / `loanConfig.currentBalance` counters — that makes
complete → revert → complete idempotent by construction instead of by careful bookkeeping,
and retires the loan/card/installment drift family.

### Local fixes

Safe to do independently, each with a test. Grouped by area, not priority:

**Balance & risk** — reverse only in-window completed rows in `calculateDailyBalances`;
add `&& t.status !== "completed"` to both `getRunway` and `getNextCrunch`; fold overdue
non-completed outflows into day 0; drop the `dayExpenses > 0` gate; align the
365-vs-90 horizon and `MetricsGrid`'s hard-coded "90+ days"; populate
`DayBalance.projectedIncome`/`projectedExpenses`; credit a day's income before debiting its
expenses in `billCoverage` and add a deterministic same-day tie-break; `daysAhead - 1`;
per-bill rather than cumulative shortfall.

**Debt** — advance the amortization anchor by `paymentsMade`; map `paymentNumber` over the
full schedule before filtering; `addMonths` instead of `setMonth` (three sites); step the
installment cursor from the anchor rather than from the previous clamped value; clamp the
credit-card first payment day; filter card projections on the emitted date; populate
`totalPayments`; report a settled card as paid off rather than `Infinity` and not a trap;
compute scenario savings against an `Infinity` baseline correctly; make `full_balance`
pay balance + accrued interest.

**Health & variance** — savings rate 0 for zero-income-with-expenses; `Math.abs(avgBalance)`
in the trend slope; include overdue bills in the bill-payment denominator; rank insights by
severity before truncating; zero-fill chart buckets; compute variance's projected baseline
from all in-range rows; populate `byCategory` for income; return `null` not `0` for a
percentage with a non-positive denominator; scope `getCategoryBreakdown` per type.

**Persistence** — `getTransactions` must apply `limit` after the status filter; add a
`creditConfig` branch that calls the already-written, never-called `updateCreditBalance`;
restore `loanConfig.currentBalance` on revert; make the loan branch tolerate a missing
`paymentBreakdown`; reactivate a plan when its final installment is reverted; clear
`variance` when reclassifying to projected; stop writing `notes: undefined`; reset
`initialBalance` alongside `currentBalance` in the two wipe paths.

**Debt-counter symmetry** (two defects the counters make possible, both verified) —
`completeTransaction` calls `updateInstallmentProgress` unconditionally, so **re-completing**
an already-completed row increments `installmentsPaid` again. The transaction modal actively
invites this ("Resubmitting will update the amount and adjust your balance"), so correcting
an amount twice takes the counter to 3 and silently deletes two real future instalments from
the forecast — the balance stays correct, so nothing looks wrong. And `skipTransaction`
reverses the balance for a previously-completed row but never rolls the counters back, while
`revertToProjected`'s decrement is gated on `status === "completed"` — so once a completed
payment is skipped, the phantom payment is **permanent**. Gate the counter updates on an
actual `projected → completed` transition, or (better) derive them, which is R6.

**Display arithmetic** — `PeriodComparison` divides its percent change by a *signed*
previous value, so a worsening net cash flow renders as a green +100%; `CashFlowChart`
labels the first day's **closing** balance as "Opening", so the Dashboard and the Calendar
report different openings and opposite-signed changes for the same month; and reverting a
completed *manual* transaction leaves `actualAmount`/`actualDate` in place, so it stays
bucketed and valued as though it were still paid.

**Currency** — default `formatCurrencyWithSign` to 2 fraction digits (0 for JPY); make
`formatCurrency`'s minimum match its maximum; derive the sign from the rounded value.

**Cleanup** — delete or wire up `calculateForecast`, the `reconciliation` module,
`calculateMonthlyTotals`, `saveBalanceSnapshot` and `createAlert`; remove the unused
`getSmartStatus` import; fix the stale comment in `projectionMerger` and the dead `amount`
variable in `ProjectedVsActualWidget`.

### Sequencing

**Phase 0 — governance, before any code change.** Make CI run `npm test`,
`npm run test:tz` and `tsc --noEmit`; it currently only builds. Restructure the defect
ledger so `it.fails` cannot lie (§5). Split "defect" from "undecided product question".
Answer the §6 decisions. Without this, every subsequent fix is unverifiable and the six
pinned-spec tests will fight you.

**Phase 1 — R1 + R2 + R4.** These interact: the window bugs, the identity bugs and the
UTC bounds all meet in the same comparisons. Write the differential and invariant tests
first (§5) — they fail today, which is what makes them the spec.

**Phase 2 — R3 + R6, plus the balance and persistence local fixes.** This is where the
money corruption lives. Needs the D1 and D5 answers.

**Phase 3 — the debt calculators.** Needs D2 and D3.

**Phase 4 — R5 and the display fixes**, including currency.

**Phase 5 — health/variance polish and dead-code removal.**

---

## 5. What correct tests look like

The existing suite is good at what it does and should be kept — the independent PMT
implementation in `loans.test.ts`, the raw-`Date` test helpers, and the SDK-level Firestore
emulator that lets real mutation code run are all the right calls. What is missing is a
different *kind* of test, plus a governance change.

**5.1 Differential tests against a reference model.** For the occurrence engine, write a
small independent implementation (generate on the period axis → adjust → dedupe → filter)
and assert the engine equals it across an exhaustive parameter sweep. One test then covers
thousands of configurations instead of one example per branch. This is how I got the numbers
in §3.6, and it found the monthly trailing drop, the yearly January bug and the daily
duplication in a single run. The reference model also forces the ambiguous decisions (D4)
into the open, because you cannot write it without choosing.

**5.2 Invariant tests, not just example tests.** The defects that survived 1,640 example
tests are the ones no single module owns. State the invariants and assert them over
generated inputs:

- every returned occurrence lies in `[max(startDate, viewStart), min(endDate, viewEnd)]`;
- occurrence dates within a rule+window are strictly increasing and unique;
- occurrence ids within a rule+window are unique, and are **invariant** under
  `weekendAdjustment ∈ {none, before, after}`, under month-end clamping, and under an
  override's `scheduledDate`;
- **window composability:** `projections(W) == projections(W₁) ∪ projections(W₂)` for any
  partition of `W`. This one alone catches the trailing drop, the leak past the window end,
  and the override-leaves-window case;
- every stored transaction appears exactly once in the merged output, and merged ids are
  pairwise distinct;
- `dailyBalances.get(todayKey).closingBalance === currentBalance` whenever nothing dated on
  or before today is still `projected`. **This single assertion would have caught the
  worst bug in the codebase**;
- `currentBalance === initialBalance + Σ signed(completed)` after every mutation;
- `getRunway`, `getNextCrunch` and `calculateRunwayScore` name the same first-negative date
  for the same input;
- amortization: `Σ principal == opening balance`, final `remainingBalance == 0`, and
  `remainingBalance == opening + cumulativeInterest − paid` at every step;
- every function's output is invariant under permutation of its input array;
- for fixed string inputs, output is identical under `TZ ∈ {UTC, Asia/Manila,
  America/New_York, America/Santiago}`.

**5.3 A state-machine test for the write path.** Enumerate
`{projected, completed, skipped}² × {amount changed} × {type flipped} × {date changed}`,
plus delete and revert per `sourceType`, and after **every** transition assert the two
invariants above. Then add a randomized-sequence test — apply N random gestures and assert
the invariants still hold. That shape catches the complete → revert → complete erosion
without anyone having to think of it.

**5.4 Replace `it.fails` with a data-driven ledger.** The mechanism is clever and it works
today, but it has three problems: a green CI hides 125 money defects; a fix turns tests red
with no explanation attached; and it cannot distinguish an assertion from a crash (the
`loans.test.ts:612` case is a live instance). Move to a single machine-readable ledger
(`tests/known-defects.json`: id, description, reachability, spec reference, owning tests).
A harness reads it and marks the listed tests expected-to-fail *and asserts the failure is
an `AssertionError`*. CI then reports "125 known defects" as a number that must monotonically
decrease, and fixing one fails the ledger check until the entry is removed — so the ledger
cannot drift from the suite the way `DEFECTS.md` has (125 tests, 24 numbered causes, whole
families with tests and no entry).

**5.5 Close the coverage gaps that matter.** Add `app/lib/utils/currency.ts` to the
coverage config and test it — it has zero tests and it rounds cents off every signed
figure. Then the component maths, which becomes trivial to test once R5 has moved it into
the logic layer: that is the argument for doing R5 before writing those tests rather than
after.

**5.6 Widen the timezone matrix.** One file at UTC+8 structurally cannot see negative-offset
bugs, and several of the worst ones are negative-offset-only: the window's last day losing
its `DayBalance` entirely, the chart's double month shift, the shifted period-comparison
baseline, and the persisted-wrong `monthOfYear`. Run the whole suite under UTC,
Asia/Manila, America/New_York and America/Santiago (the last for the midnight
spring-forward case, which no UTC-sign reasoning will find).

---

## 6. Decisions I need from you

Ordered by how much they block.

**D1 — Is there live production data?** *(blocks R3's data handling, not its code)*
If yes, the derived-balance change needs a one-time reconciliation that logs discrepancies
rather than silently restating balances — and the `initialBalance` values the migration
seeded from `currentBalance` need repairing first. If no, correct the stored values directly
and move on.

**D2 — Loan `calculationType`.** The form collects and stores
`amortized`/`flat_rate`/`reducing_balance`; the engine only ever computes amortized. The
ledger recommends dropping the field; the audit recommends implementing `flat_rate`
(and quotes the gap: a 12,000/10%/24mo flat-rate loan shows 553.74 payment / 1,289.74
interest instead of 600.00 / 2,400.00). Both are defensible. **My recommendation:**
restrict the form to amortized now and drop the field — it is the smaller change and the
other two modes are a feature, not a fix. Three `it.fails` tests are waiting on this answer.

**D3 — Credit-card minimum-payment trap.** The payoff loop clamps principal at 0, so a
trapped balance never grows, and it bails after month 12. Real cards compound.
**My recommendation:** compound it. The numbers get scarier but they get true, and it also
fixes the summary quoting a finite saving against an `Infinity` baseline. The alternative
(keep the clamp, make `isMinimumPaymentTrap` authoritative, stop quoting savings) is
acceptable but leaves the module violating its own conservation identity.

**D4 — Weekend adjustment at a window or rule boundary: clamp or drop?** When shifting a
date would push it past `endDate` or outside the view window, should the occurrence be
dropped, kept unadjusted, or shifted the other way?

**My recommendation, now measured rather than argued** (§9.2): filter the *adjusted* date
against the view window and do **not** extend that check to the rule's own
`startDate`/`endDate`. Enforcing the rule bounds too breaks 8 passing tests; enforcing only
the window breaks 2 — and both of those two are identity tests that the R2 refactor rewrites
anyway. Five of the eight are tests explicitly asserting that `"before"` may move a first
occurrence to the Friday *preceding* `startDate`, which is a defensible reading of "pay
early if it lands on a weekend". The cheaper option is also the one the suite already
endorses, so take it.

**D5 — Does a past-dated, still-`projected` row affect today's balance?** Today the
calendar says yes and `getRunway`/`getNextCrunch`/`billCoverage` say no, so the app
contradicts itself. **My recommendation:** it is still owed — show it as overdue, count it
in the risk views, but do not move the *realized* balance. That means splitting realized
(completed only, up to the anchor) from projected (forward), which is exactly what R3
needs.

**Lower-stakes, defaults I will take unless you say otherwise:** an unrecognised frequency
throws in dev and warns in production; insights rank by severity; chart buckets are
zero-filled; an explicit empty note clears an existing note (only `undefined` means "leave
alone"); `variance` attributes to the scheduled month.

---

## 7. Do these two things now, before the refactor

1. **Disable or gate "Recalculate Balance"** (`BalanceSection.tsx:128-143` and the
   `initialBalance` update at 104-126). It is the only affordance the app offers for fixing
   a wrong balance and it writes a wrong value in both directions (§3.1). Until R3, it
   should be behind a confirmation that shows the full derivation, or removed.
2. **Turn on CI.** `.github/workflows/deploy.yml` builds and deploys to GitHub Pages on
   every push to `main` and runs no tests, no typecheck and no lint. Adding
   `npm test && npm run test:tz && npx tsc --noEmit` costs one block and is the
   precondition for everything in §4. (`npm run lint` is already broken on `main` with a
   `FlatCompat` circular-structure error — unrelated to this work, but it means lint has
   never gated anything either.)

Still deferred, and still true: **there are no Firestore security rules in the
repository** — no `firestore.rules`, no `firebase.json`, no `.firebaserc`. All
authorization is client-side `where("userId", "==", uid)`, which is a query, not access
control. For an app whose client-side API includes `deleteAllUserData(userId)` and
`adjustUserBalance(uid, delta)`, this outranks every defect above. Rules may well be
configured in the Firebase console, but they are not version-controlled, not reviewable and
not deployable from source. Raise it again before any production deploy.

---

## 8. Appendix: consolidated issue register

Every distinct root cause found across all sources, deduplicated and grouped by area. This
supersedes both prior ledgers as the working list.

**Evidence tier** — how well established each item is:

| Tier | Meaning |
| --- | --- |
| **A** | I reproduced it myself in this session against production code |
| **B** | Reproduced by an independent audit pass **and** upheld by a separate adversarial pass |
| **C** | Reproduced by one independent audit pass, then **re-verified by me directly** (see §9) |
| **D** | I did not re-derive the numbers, but the defect is pinned by an `it.fails` test — and my flip run confirmed all 125 such tests fail through a genuine `AssertionError`, so it is executable-verified |

**Nothing in this register is now single-source.** Tier C originally held 31 rows, because
nine adversarial passes and all three test-suite audits were killed by an org spend limit. I
have since verified every one of them myself — 30 confirmed, 1 refuted (DBT-19), with two
numeric corrections — plus the three remaining code-reading rows (UI-5, UI-14, DF-8). §9
records that work and the test-conflict measurement that replaced the dead test-audit agents.
Of the three adversarial passes that did complete, 27 of 28 findings stood.

Current split: **83 rows I reproduced myself**, 24 upheld by an independent adversarial pass,
10 pinned by an `it.fails` test verified through the flip run.

### 8.1 Occurrence generation — `occurrenceCalculator.ts`

| ID | Issue | Sev | Tier |
| --- | --- | --- | --- |
| OG-1 | Monthly loop terminates on a cursor carrying the *start date's* day-of-month, dropping the final in-window occurrence — 3,654 of 24,304 configs | critical | **A** |
| OG-2 | Quarterly has the identical cursor-axis bug | high | **A** |
| OG-3 | Quarterly falls back to `dayOfMonth \|\| 1` instead of `start.getDate()`, so the first payment is dropped and the rest move to the 1st | high | **A** |
| OG-4 | Daily weekend-adjusts each day independently: Sat+Sun+Mon collapse onto one date with one id — 357 of 360 configs | high | **A** |
| OG-5 | Weekend adjustment runs *after* the bounds test, so dates escape `viewEnd`, `endDate`, `viewStart` and the rule's own `startDate` | high | **A** |
| OG-6 | Window bounds compared as raw instants against local-midnight candidates → boundary occurrences dropped in every non-UTC zone | high | **A** |
| OG-7 | Semi-monthly `specificDays` that clamp to the same day emit duplicate occurrences sharing one id (6 pairs bare, 68 with `"after"`) | medium | **A** |
| OG-8 | `monthOfYear \|\| start.getMonth()` discards a configured January (0) | medium | **A** |
| OG-9 | `MAX_OCCURRENCES = 500` truncates silently and window-independently — a daily rule stops ~16 months out | medium | **A** |
| OG-10 | Loop guard counts *output*, not iterations: a negative `intervalWeeks` never terminates and freezes the tab | medium | **A** |
| OG-11 | Weekly/bi-weekly alignment advances a full 7 days when `dayOfWeek` can never match (string from legacy data, or 7), dropping the first period | low | **A** |
| OG-12 | `clampDayToMonth` has no lower bound: day 0 or negative rolls into the previous month; `NaN` passes through | low | **A** |
| OG-13 | No `default` on the frequency switch — an unrecognised value silently yields `[]` | low | **A** |
| OG-14 | Semi-monthly emits descending dates when `specificDays` is unsorted | low | **A** |

### 8.2 Occurrence identity and the merge

| ID | Issue | Sev | Tier |
| --- | --- | --- | --- |
| ID-1 | `generateOccurrenceId` receives the weekend-adjusted/clamped date, so occurrences are labelled with the wrong logical period and two can share one id | critical | **A** |
| ID-2 | `getSemiMonthlyIndex`'s nearest-slot fallback collapses shifted/clamped days onto slot 2 — every `specificDays` pair collides at least once under `"after"` | critical | **A** |
| ID-3 | An override is applied to *every* occurrence sharing a colliding id: one drag moves two months' rent, one skip deletes both | critical | **A** |
| ID-4 | The merge's `Map` overwrites on a duplicate key, so a stored completed row is silently dropped while its balance effect remains | critical | **A** |
| ID-5 | A stored row with no `occurrenceId` can never suppress its projection → the amount is counted twice | high | **A** |
| ID-6 | Identity is unstable across rule edits (`weekendAdjustment`, `startDate`, `specificDays`), orphaning stored rows and overrides | high | **A** |
| ID-7 | `getBiWeeklyIndex` divides millisecond deltas, so a DST spring-forward makes two occurrences share one `BW` index and skips another | high | **A** |
| ID-8 | The merged array can contain two rows with byte-identical `proj_` ids — duplicate React keys and dnd ids | high | **A** |
| ID-9 | `getExpectedDateFromOccurrenceId` reconstructs from `startDate`'s day, ignoring `scheduleConfig.dayOfMonth`, so reverting an untouched row writes a spurious pinning override | low | **B** |
| ID-10 | An override's `scheduledDate` is applied after window filtering, so a row can be emitted outside the window and missing from the one it belongs to | low | **A** |
| ID-11 | `OccurrenceOverride.skipped` has no writer, and where honoured the occurrence vanishes with no way to undo it | low | **A** |

### 8.3 Balance reconstruction and risk views

| ID | Issue | Sev | Tier |
| --- | --- | --- | --- |
| BAL-1 | `calculateDailyBalances` undoes **all** completed rows but replays only in-window ones → every displayed balance off by the pre-window net, unbounded and growing | critical | **A**+**B** |
| BAL-2 | `getRunway`/`getNextCrunch` re-apply completed rows already inside `currentBalance` → false "broke today" | high | **A**+**B** |
| BAL-3 | `billCoverage` walks same-day rows sequentially, and the merge always appends manual income *after* rule bills, so same-day income is deterministically not credited | high | **B** |
| BAL-4 | Overdue past-dated projected rows are counted by the day grid and ignored by all three risk functions — four consumers, three answers | medium | **B** |
| BAL-5 | `useComputedFinancials` passes UTC-midnight bounds into a local-midnight day loop → the window's last day gets no `DayBalance` at all | medium | **A**+**B** |
| BAL-6 | `Dashboard.tsx:124` plots any missing day at *today's* balance, so BAL-1/BAL-5 render as a plausible flat line instead of a visible gap | medium | **B** |
| BAL-7 | `getRunway` scans 365 days over an array holding ~4 months of projections, so runway is silently overstated once the data runs out | high | **A** |
| BAL-8 | `useComputedFinancials` returns an empty Map when `transactions.length === 0`, so a new user's calendar has no balances at all | medium | **B** |
| BAL-9 | `DayBalance.projectedIncome`/`projectedExpenses` hard-coded to 0, though `SPECIFICATION.md` §2.5 requires the split | low | **B** |
| BAL-10 | `billCoverage` window is `daysAhead + 1` days; shortfalls are cumulative but rendered per-bill; `daysUntilDue` off by one across a fall-back DST | low | **B** |
| BAL-11 | `getRunway` and `getNextCrunch` disagree for an already-overdrawn account, and their horizons differ (365 vs 90) while the UI hard-codes "90+ days" | low | **B** |
| BAL-12 | `getDaysBetween` and the daily cursor iterate wall-clock instants → the range's last day is lost in any zone whose spring-forward is at 00:00 | medium | **A**+**B** |

### 8.4 Balance ownership and mutations

| ID | Issue | Sev | Tier |
| --- | --- | --- | --- |
| MUT-1 | Two live sources of truth: `currentBalance` (15 write sites) vs `initialBalance + Σ completed`, both read on screen | critical | **A** |
| MUT-2 | "Recalculate Balance" writes a wrong value in both directions (collision → too low; migration → too high) | critical | **A** |
| MUT-3 | `migrateToInitialBalance` seeds `initialBalance = currentBalance`, double-counting all history — one-shot, not per-login | critical | **A** |
| MUT-4 | `addManualTransactionAction` never adjusts the balance while delete does → each add/delete cycle corrupts by 2× | critical | **B** |
| MUT-5 | Type flip on a completed manual row: all three branches sign the delta from `existing.type`; an unchanged amount fires no branch at all; and the error *compounds* on delete | critical | **A** |
| MUT-6 | Editing a loan/installment rule resets `paymentsMade`/`installmentsPaid` to 0 and forces `isActive: true` | critical | **A** |
| MUT-7 | Deleting a completed **rule-based** row skips the reversal (gated on `sourceType === "manual"`) | high | **D** |
| MUT-8 | Materialising a projection records `projectedAmount = source.amount`, losing the amortized/override/installment amount, and writes no `variance`, `completedAt` or `paymentBreakdown` | high | **B** |
| MUT-9 | Re-completing an already-completed row increments the debt counter again — the modal invites resubmission | high | **B** |
| MUT-10 | Skipping a completed row reverses the balance but leaves counters incremented, and revert cannot undo it → permanent phantom payment | high | **A** |
| MUT-11 | `removeUndefined` makes "clear this field" a no-op, so a reverted manual row keeps `actualAmount`/`actualDate` and stays bucketed as paid | high | **B** |
| MUT-12 | The "Update Current Balance" override writes `currentBalance` without touching `initialBalance` — a shipped, supported way to break the invariant | high | **B** |
| MUT-13 | Rescheduling writes a fresh `{ scheduledDate }`, discarding any existing `amount`/`notes`/`skipped` override | medium | **D** |
| MUT-14 | Revert cannot reconstruct a date for 5 of 8 frequencies, so a custom date is silently lost | medium | **D** |
| MUT-15 | Deleting "Balance History" — a collection nothing ever writes — zeroes `currentBalance` while leaving `initialBalance` | high | **A** |
| MUT-16 | `getTransactions` applies `limit` in the query *before* the client-side status filter | medium | **D** |
| MUT-17 | Wipe paths reset `currentBalance` but not `initialBalance`, so the derived balance resurrects deleted money | medium | **D** |

### 8.5 Debt: loans, cards, installments

| ID | Issue | Sev | Tier |
| --- | --- | --- | --- |
| DBT-1 | `updateLoanBalance` is **unreachable**: the projection path never persists `paymentBreakdown`, which its gate requires. `loanConfig.currentBalance` therefore never declines | critical | **A** |
| DBT-2 | Consequently the projected instalment escalates without bound (1,066 → 12,120), the app quotes 3.5× the true total cost, and at `paymentsMade == termMonths` the loan vanishes while still active | critical | **A** |
| DBT-3 | The amortization anchor is never advanced by `paymentsMade`, so remaining payments re-date to the original start and the tail payments never exist | critical | **A** |
| DBT-4 | `setMonth` overflow skips a month and permanently drifts the day — `loanAmortization.ts:63`, `payoffCalculator.ts:57` and `:125` | high | **A** |
| DBT-5 | Installment cursor chains `addMonths` off the previous clamped value → month-end plans drift (Jan 31 → Feb 28 → **Mar 28**) | high | **A** |
| DBT-6 | `creditConfig.currentBalance` is never reduced; `updateCreditBalance` is correct, exported and dead | high | **A** |
| DBT-7 | Card first payment: unclamped `setDate(dueDate)` overflows a short start month, so the schedule starts a month late | high | **A** |
| DBT-8 | `paymentNumber` uses the post-filter index, so the same occurrence renumbers when the user scrolls | high | **A** |
| DBT-9 | Scenario savings are computed against a baseline truncated at month 13, inverting the advice for exactly the user who needs it | critical | **A** |
| DBT-10 | Card projections stop after 13 months for any card whose payment cannot cover interest | critical | **A** |
| DBT-11 | Principal clamped at 0 freezes the balance instead of growing (a real card compounds). The "accounting identity is broken" sub-claim did **not** reproduce — with payment exactly equal to interest the identity holds | high | **A** |
| DBT-12 | A settled card (`currentBalance: 0`) reports `Infinity` payoff and is flagged a minimum-payment trap | high | **A** |
| DBT-13 | `full_balance` returns the bare balance while interest accrues first, so it takes two payments to clear | medium | **D** |
| DBT-14 | Installments are anchored by the `installmentsPaid` *count*, so completing out of order deletes the earliest unpaid one | medium | **A** |
| DBT-15 | Interest-bearing installments book the whole payment as principal and overstate `remainingBalance` | medium | **A** |
| DBT-16 | `calculationType` (`flat_rate`/`reducing_balance`) is collected, stored and read by nothing | medium | **D** |
| DBT-17 | `paymentBreakdown.totalPayments` hard-coded to 0 for cards | low | **A** |
| DBT-18 | `rule.endDate` and `weekendAdjustment` are ignored by the loan and card paths | low | **A** |
| ~~DBT-19~~ | ~~A debt rule whose config is missing becomes an *unbounded* recurring expense~~ — **refuted**: it falls through to the recurring path, which honours `endDate`. The silent change of amount source remains, bounded | low | **A** |
| DBT-20 | A debt rule with `frequency: "one-time"` collapses every payment onto `<id>_once` | medium | **A** |
| DBT-21 | `loanConfig.firstPaymentDate` and `loanConfig.loanStartDate` are both persisted and neither is ever read | low | **A** |
| DBT-22 | No last-instalment residual: `installmentAmount × count` never reconciled to `totalAmount` | low | **D** |

### 8.6 Health score, variance and forecast

| ID | Issue | Sev | Tier |
| --- | --- | --- | --- |
| HS-1 | Balance-trend slope divided by a **signed** average inverts the verdict for an overdrawn user who is recovering | high | **B** |
| HS-2 | Savings rate forced to 0 when income is 0 and expenses are not → score 20 instead of 0, and the negative-cash-flow warning can never fire | high | **D** |
| HS-3 | `chartData` UTC-parses then formats locally, **twice**, so a first-of-month transaction lands in the previous month labelled with the month before that | high | **A**+**B** |
| HS-4 | Bill-payment score excludes still-projected past bills → 100% "perfect record" for a user who has paid nothing | medium | **B** |
| HS-5 | Balance-trend regression is dominated by *where in the month payday falls*, not by the trend: identical months score 76/C vs 91/A | low | **B** |
| HS-6 | Dividing by a near-zero average makes the trend component a coin flip | medium | **B** |
| HS-7 | `calculateRunwayScore` is the only component ignoring the selected range, so the composite mixes today's forward 90 days with the period's other metrics | medium | **B** |
| HS-8 | Bill-payment selects its population by `scheduledDate` alone while every other module uses `actualDate \|\| scheduledDate` | medium | **B** |
| HS-9 | Insights truncated by push order, so three compliments can crowd out the only warning | medium | **A** |
| HS-10 | Chart buckets omit empty periods, so an 18-day gap renders as one day | medium | **D** |
| HS-11 | Variance filters to completed **before** summing, so `projected` counts only paid rows and the report can never show under-delivery | medium | **A** |
| HS-12 | `byCategory` populated only in the expense branch — income categories never appear | low | **A** |
| HS-13 | `variancePercent` returns 0 for a non-positive denominator, indistinguishable from "on budget" | low | **B** |
| HS-14 | `getCategoryBreakdown` would mix income and expenses into one denominator; both current callers pass a type, so latent | low | **B** |
| HS-15 | `calculateForecast` mixes UTC day keys with local `scheduledDate` strings — and has **zero callers** | low | **A** |

### 8.7 Display-layer arithmetic

| ID | Issue | Sev | Tier |
| --- | --- | --- | --- |
| UI-1 | Blank optional card fields persist as `NaN`, collapsing the card to one `NaN` payment and poisoning every later balance | critical | **A** |
| UI-2 | `prorateToDateRange` divides by a hard-coded 30-day month, so a full month never round-trips (July +3.3%, February −6.7%) | high | **A** |
| UI-3 | Two different "amount of a transaction" formulas coexist, so widgets on one screen disagree once a row is reverted | high | **A** |
| UI-4 | `ProjectedVsActualWidget` buckets the *projected* amount by `actualDate`, so a late-paid bill moves its own baseline into the next month | high | **A** |
| UI-5 | Loan form's headline EMI uses the original principal while its own preview amortizes the current balance over the full term — **860.66 vs 430.33 on one screen**, and the total-interest metric reads 327.97 against the schedule's own 163.99 | high | **A** |
| UI-6 | `CashFlowChart` labels the first day's **closing** balance as "Opening", so Dashboard and Calendar disagree and report opposite-signed changes | high | **A** |
| UI-7 | `SchedulePreview` reimplements occurrence stepping: wrong overflow rules, ignores `dayOfWeek` entirely, shows one tile for quarterly/yearly without an end date, and can show a date before the rule starts | high | **A** |
| UI-8 | `PeriodComparison` divides percent change by a *signed* previous value → a worsening cash flow renders green +100%; and `prev === 0` makes a strictly worse outcome neutral | medium | **A** |
| UI-9 | `PeriodComparison` UTC-parses its bounds, sliding the comparison window a day | medium | **A**+**B** |
| UI-10 | `formatCurrencyWithSign` defaults to 0 fraction digits, silently rounding cents off every signed figure; `formatCurrency` min≠max gives ragged decimals; sign derived from the unrounded value | high | **A** |
| UI-11 | `Dashboard.tsx:52` duplicates `getPeriodStats` with a divergent amount rule | medium | **A** |
| UI-12 | Four screens estimate monthly totals as `amount × multiplier` while the calendar counts occurrences | medium | **A** |
| UI-13 | `RecurringSummaryWidget` keeps a private `getMonthlyMultiplier` copy | low | **A** |
| UI-14 | `CashFlowChart` sampling for ranges > 90 days can skip the endpoint — a 100-day range samples day 98 and never day 99 | low | **A** |
| UI-15 | `getMonthlyMultiplier` uses daily = 30 (360-day year) against weekly 52/12 (365-day year) | low | **A** |
| UI-16 | Thirteen sites render a stored `YYYY-MM-DD` through `new Date(str)`, showing the previous day west of UTC | medium | **B** |
| UI-17 | Nine sites derive "today" from `new Date().toISOString()`; some of those values are **persisted** as form defaults | medium | **B** |

### 8.8 Data-flow and window contracts

| ID | Issue | Sev | Tier |
| --- | --- | --- | --- |
| DF-1 | `useViewDateRange` stamps its bounds with `toISOString()` on locally-built dates — and this *masks* the merger bug at the start bound, so the two must be fixed together | high | **A**+**B** |
| DF-2 | `projectionMerger` and `useComputedFinancials` UTC-parse the window while everything they meet is local | high | **A**+**B** |
| DF-3 | The expense and income forms have divergent `buildScheduleConfig`; the expense one has no `quarterly`/`yearly` case | high | **A** |
| DF-4 | `IncomeSourceForm` persists `monthOfYear` from `new Date(str).getMonth()` — the wrong month is stored permanently | high | **A**+**B** |
| DF-5 | Seven consumers disagree on whether a past-dated still-`projected` row happened | medium | **A** |
| DF-6 | Memos depending on wall-clock "today" don't list it, so bill coverage, health score and the overdue count go stale across midnight | low | **A** |
| DF-7 | `isInitialized`/`isLoading` flip on a hard-coded 1,000 ms timer, so a slow connection renders a zero-balance dashboard as real | low | **A** |
| DF-8 | `isReconciled` and `parentTransactionId` have **zero** write sites; `projectedIncome`/`projectedExpenses` have exactly one (the hard-coded `0`). Consumers then coerce: `ProjectedVsActualWidget` uses `actualAmount \|\| projectedAmount`, so a legitimately recorded `0` falls through to the projection | low | **A** |
| DF-9 | `preferences.startOfWeek` is declared, defaulted and editable in Settings, and consumed nowhere | low | **B** |

### 8.9 Dead or inert

`createAlert` (so the whole alerts feature, including spec §3.5 "Overdue Alerts", is inert) ·
`saveBalanceSnapshot` (balance history never written) · the `reconciliation` module ·
`calculateForecast` · `calculateMonthlyTotals` · `deleteTransactionsBySource` ·
`updateCreditBalance` (until DBT-6 is fixed) · `getSmartStatus` (imported, never called) ·
`loanConfig.firstPaymentDate` / `loanStartDate` · `billCoverage.ts:49` and `:83` ·
`transactionActions.ts:369-370` · `projectionMerger.ts:57`.

### 8.10 Provenance of the register

Originally 31 of these rows were single-source, because nine adversarial passes and all three
test-suite audits were killed by an org spend limit. I have since verified those rows myself
and measured the test suite directly — **§9 records that work, and the tiers above reflect its
outcome.** One row (DF-8) remains unverified and is marked as such.

Two things were deliberately excluded rather than missed:

- **Behaviour in a running browser.** Every reproduction here is a direct call into production
  modules. Browser verification is deferred by agreement, alongside UI structure, auth and the
  Firestore rules. Two rows depend on it for their *symptom* (ID-8's duplicate React keys and
  dnd-kit draggable ids) — the underlying id collision is confirmed either way.
- **Component rendering and styling**, per the scope at the top of this document.

---

## 9. Completing the verification the dead agents were meant to do

Thirteen of the thirty-one audit agents were killed by an org spend limit, and they were
disproportionately the *verification* work: nine adversarial passes and all three
test-suite audits. I have done both myself. This section records the results and supersedes
§8.10.

### 9.1 Re-verification of every tier-C finding

All 31 single-source rows were re-run against production code. **30 confirmed, 1 refuted**,
with two numeric corrections. Highlights where the result changed or sharpened:

- **DBT-19 refuted.** A `cash_loan` rule with no `loanConfig` does *not* become an unbounded
  recurring expense — it falls through to the plain recurring path, which honours `endDate`
  (3 rows for a Jan–Mar rule). The real defect is narrower: the amount silently comes from
  `rule.amount` instead of an amortization schedule.
- **DBT-11 half-refuted.** The principal clamp does freeze the balance (5,000 → 5,000 over
  13 months while `cumulativeInterest` reaches 1,300). But the "breaks its own accounting
  identity" sub-claim did not reproduce: with payment exactly equal to interest,
  `opening + interest − paid` = 5,000 = the reported balance. The economics are wrong; the
  bookkeeping is self-consistent.
- **OG-7 count corrected.** 6 `specificDays` pairs produce duplicate dates bare, **68** under
  `"after"` — not the 136 originally reported.
- **ID-3 is worse than reported.** A single `{skipped: true}` override on a colliding id
  removes **two** projections, not one: two months of rent silently gone. An `{amount: 5}`
  override re-prices both.
- **ID-6 now has a money figure.** Toggling `weekendAdjustment` on a weekly rule shifts every
  id back one ISO week (`W09…W13` → `W10…W14`), orphaning the completed paycheck. Through the
  real merge: **6 rows totalling 6,000 where the truth is 5 rows and 5,000.**
- **DBT-9 is worse than reported.** For a card the summary calls `Infinity`, the only
  scenario offered is *"Pay Off in 1 Year — save 626.43, 1 month"*, and **Double Payment is
  absent entirely** (filtered out by `interestSavings > 0`). The one genuinely helpful option
  is hidden from the user who most needs it.
- **DF-5 confirmed spectacularly.** One unpaid 5,000 bill dated 8 days ago, balance 1,000 —
  four consumers, four answers: `dailyBalances` today = **−4,000**; `getRunway` =
  `{days: 365, runOutDate: null}`; `calculateRunwayScore` = `{score: 100, daysRemaining: 90}`;
  `getPeriodStats` July expenses = **5,000**.
- **MUT-15 confirmed.** Ticking only "Balance History" in the selective-reset modal — a
  collection nothing ever writes — sets `currentBalance` to 0 while leaving
  `initialBalance` at 100,000 and every transaction intact.
- **MUT-9/MUT-10 confirmed against a Firestore fake running the real code.** Correcting a
  completed instalment's amount twice takes `installmentsPaid` from 1 to **3**; skipping a
  completed instalment restores the balance to exactly 100,000 but leaves the counter at 1
  **permanently**.
- **DF-6 / DF-7 confirmed by reading.** `useBillCoverage`'s memo deps are
  `[userProfile, transactions]` while `getBillCoverageReport` reads `new Date()` internally;
  `TransactionsManager`'s overdue tile computes `new Date().toISOString()` inside a memo that
  doesn't depend on it. And `useFinancialSubscriptions` flips `isLoading`/`isInitialized` on
  a literal `setTimeout(..., 1000)`.

### 9.2 The test audit, done as a measurement

Grepping test titles for characterisation language returned 450 candidates — too many to
judge by eye, and the wrong instrument anyway. So I did the decisive thing instead: in a
throwaway worktree, **applied each fix and recorded exactly which tests turn red.**

| Fix | `it.fails` → red (defect fixed, expected) | **passing → red (must be rewritten)** |
| --- | --- | --- |
| Monthly/quarterly cursor normalised (OG-1/2/3) | 3 | **2** |
| `daily` ignores `weekendAdjustment` (OG-4) | 5 | 0 |
| Adjust-before-filter, rule bounds enforced (OG-5) | 5 | **8** |
| Adjust-before-filter, **window only** (OG-5) | 5 | **2** |
| `monthOfYear ?? ` (OG-8) | 1 | 0 |
| `dayOfWeek` aligned arithmetically (OG-11) | **0** | **2** |
| Occurrence cap scaled to the window (OG-9) | **0** | **6** |
| `dailyBalance` reverses only in-window rows (BAL-1) | 2 | 0 |
| Runway/crunch exclude completed, gate dropped (BAL-2/11) | 2 | **9** |
| `billCoverage` window = `daysAhead` days (BAL-10) | **0** | **3** |
| Health score: zero-income, `abs()`, overdue counted (HS-1/2/4) | 1 | **1** |
| Currency 2dp + prorate by actual days (UI-10, UI-2) | **0** | **7** |
| **R2 — ids keyed off the logical date (ID-1)** | 2 | **0** |
| Amortization `addMonths` off a fixed anchor (DBT-4) | 2 | **0** |
| Variance baseline + income categories (HS-11/12) | 1 | **4** |

Four conclusions, all of them planning-relevant:

**(a) The three highest-value structural changes are free.** R2 (occurrence identity from the
logical date), the `dailyBalance` opening-balance fix, and the amortization anchor each break
**zero** passing tests. `HANDOFF.md` §6 warns that R2 means "roughly 110 test call sites" of
churn — that is not so. The test call sites do `ymdAll(occurrences)` on *dates*, and carrying
the logical date alongside leaves them untouched. Do R2 early; it is the cheapest large win
in the codebase.

**(b) Five fixes have *no* test asking for them and only tests arguing against them.**
`dayOfWeek` alignment, the occurrence cap, the bill-coverage window, and the currency/proration
defaults all show `it.fails → 0` with 2–7 passing tests to rewrite. The suite does not merely
fail to cover these — it asserts the buggy behaviour, with comments rationalising it
(*"Silent: no error, no marker — the remaining 231 days are simply absent"*). These are the
items most likely to be abandoned by whoever picks this up.

**(c) The runway fix is the most contested single change: 9 passing tests.** Four of them are
titled **"characterizes the defect: …"** and one is titled *"is contradicted by
`calculateRunwayScore`, which applies the contract correctly"* — a green test asserting the
wrong function's output while naming the right one. A fifth, in `calculateForecast`, asserts
the *inconsistency* between the two modules and so breaks when they are made to agree. These
must be rewritten as specification, not repaired.

**(d) Two areas cost more than the reconciliation predicted.** Variance is 4 tests, not 1
(three are in `lifecycle.test.ts`, which the title-level analysis missed), and the
bill-coverage window is 3, not 2.

**Total: 44 passing tests must be rewritten** to land the 14 fixes above (taking the cheaper
D4 option). That number belongs in the plan, because the alternative is 44 moments where
someone concludes they have broken something.

### 9.3 Deferred, and what remains open

**Deferred by agreement, not missed:** behaviour in a running browser. Every reproduction in
this document is a direct call into production modules. Two rows depend on the browser only
for their *symptom* — ID-8's duplicate React keys and duplicate dnd-kit draggable ids — and
the underlying id collision is confirmed independently. This sits alongside the other agreed
deferrals: UI structure, styling, the auth flow, and the Firestore rules gap in §7.

**Genuinely open:**

- **The remaining ~1,470 passing assertions.** §9.2 measured the tests that fourteen specific
  fixes disturb, and found 44 that must be rewritten. Tests covering code I did not patch
  could still encode wrong expectations. The same measurement, extended fix-by-fix, is how to
  find them — and it is cheap now: worktree, patch, `--reporter=json`, diff the failures.
- **`DEFECTS.md` is still not a faithful index of its own suite** (125 tests, 24 numbered
  causes; whole families have tests and no entry). Use §9.2 to predict what a fix disturbs.
