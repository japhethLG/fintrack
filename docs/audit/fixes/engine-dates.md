# Fix log: projection engine, occurrence identity, merge, date convention

**Stream:** PROJECTION ENGINE, OCCURRENCE IDENTITY, MERGE, AND DATE CONVENTION (R1, R2, R4)
**Base:** `claude/financial-projections-engine-g5fgkv` (92b2c1b)
**Not touched by design:** debt calculators (`loan/credit/installmentProjections`, `amortization/**`, `creditCardCalculator/**`),
`ExpenseRuleForm/**`, `transactionActions.ts`, `app/lib/firebase/**` (except the two date lines in `users.ts`/`migrations.ts`), `BalanceSection`.

Every expected value in the new tests is hand-derived or comes from an independent reference model; none is computed with app code.

---

## 1. What changed, by area

### R1: the occurrence engine is a pipeline (`occurrenceCalculator.ts`, `dateUtils.ts`)

1. **Generate** logical dates on the period axis (month index, year, week index, day index), bounded by the rule's own
   `startDate`/`endDate`. Generators jump straight to the window instead of walking from the rule's start.
2. **Adjust** each logical date for weekends.
3. **Dedupe** by logical date (slots that clamp to the same day, e.g. `[30, 31]` in February, are one occurrence).
4. **Filter** the ADJUSTED date to the view window. Bounds are normalised to whole local calendar days; stage 1 reads
   `MAX_WEEKEND_SHIFT_DAYS = 2` beyond the window on each side so dates the adjustment moves INTO the window are found.

`calculateOccurrences(): Date[]` is a thin wrapper over the new `calculateOccurrencesDetailed(): {logicalDate, date}[]`.
All arithmetic is on integer day numbers (`toDayNumber`, `dayNumberOfDate`, `dateFromDayNumber`, `weekdayOfDayNumber`,
now in `app/lib/utils/dateUtils.ts`), so nothing depends on the zone, DST, or the wall-clock time of the input Dates.

Also in this pass: loops count ITERATIONS (`MAX_ITERATIONS`), output is still capped at 500; `intervalWeeks` is sanitised to an
integer >= 1 (else 2); `??`-style fallbacks for `monthOfYear`/`dayOfMonth` (0 and January are real values); quarterly
`dayOfMonth` falls back to the start date's day; `specificDays` are sorted and de-duplicated; an invalid `dayOfWeek`
(string, 7, null) is ignored instead of skipping a week; `clampDayToMonth` has a lower bound of 1; an unknown frequency
throws outside production and warns + returns `[]` in production.

### R2: identity from the logical date (`occurrenceIdGenerator.ts`, `recurringProjections.ts`, `projectionMerger.ts`)

- `generateOccurrenceId` takes the LOGICAL date. The generators (`recurringProjections.ts`, shared by income and standard
  expense projections) pass `Occurrence.logicalDate`, never the adjusted or overridden date.
- Semi-monthly slot = index in the sorted, de-duplicated `specificDays` (matched on the month-clamped slot day; a day that
  matches no slot falls back to the NEAREST slot instead of being capped at 2).
- Bi-weekly interval index is counted in whole calendar days (the `sal_BW1` collision across a DST spring-forward is gone).
- **Overrides are windowed on the row's final date** (ID-10): a row dragged out of a window is not emitted by it, and a row
  dragged in from up to 366 days away is found there.
- **Merge** (`projectionMerger.ts`) matches in passes: (1) same id + same date; (2) the id an older version derived from the
  weekend-adjusted date (`legacyOccurrenceId.ts`) + same date; (3) same id, any date (rescheduled rows); (4) rows with no
  `occurrenceId` match on `sourceId + scheduledDate`. A projection is matched by at most one stored row, every unconsumed stored
  row is emitted, and emitted projection ids are made pairwise distinct.

### R4: one date convention

`parseDate`/`formatDate` are the only conversions; `getTodayKey()` is the only "today"; days are iterated by index.

| Site | Fix |
| --- | --- |
| `useViewDateRange`, `useComputedFinancials`, `projectionMerger` (fixed together) | bounds built with `formatDate`, parsed with `parseDate`; no `toISOString()`/`new Date(str)` |
| `forecastCalculator` | `formatDate` labels/filter, day-index loop |
| `chartData` (labels, weekly/monthly buckets, `getBestBucketType`) | `parseDate`, day-number diff |
| `PeriodComparison` | previous period on day numbers |
| `balanceCalculator/utils.getDaysBetween` | `eachDayBetween` (index iteration; fixes the Santiago/Beirut midnight spring-forward loss of the last day) |
| `frequencyUtils.prorateToDateRange` | day numbers (values unchanged) |
| `users.ts:34,93`, `migrations.ts:96,205` | `getTodayKey()` (date lines only) |
| `IncomeSourceForm/formHelpers` | `monthOfYear` from `parseDate(startDate)`; default start date = `getTodayKey()` |
| `ManualTransactionForm/formHelpers` (Add Transaction), `TransactionsManager` (Overdue tile) | `getTodayKey()`; sort by string compare |
| Display: `BillItem`, `TransactionRow`, `QuickTransaction`, `UpcomingBillsWidget`, `UpcomingPaymentsWidget`, `ExpenseRuleDetail`, `IncomeSourceDetail`, `IncomeSourceForm` review, `MetricsGrid` | `parseDate(str).toLocaleDateString(...)` |
| `CalendarView`, `chartData` Date clones | `new Date(x.getTime())` (so the convention scan can tell clones from string parses) |

Regression guard: `tests/unit/dateConvention.test.ts` scans `app/**/*.{ts,tsx}` (TypeScript AST) and fails on
`new Date(<string literal | template | date-string-named variable>)`, `.toISOString().split/slice/substring`, and `.setMonth(`.
Justified exceptions are in an explicit `ALLOWED` list, each with a reason; **a stale entry fails the test**, so the list can only
shrink. After merging the debt stream, 7 entries remain: 6 in `ExpenseRuleForm` (later stream: `SchedulePreview` stepping and the UTC "today" defaults) and one harmless `new Date(startDate)` Date clone in `payoffCalculator`. Drop the `ExpenseRuleForm` entries as that form is fixed.

---

## 2. Defects fixed

IDs are the verified test IDs (`docs/audit/test-verification.md`), the ledger numbers (`tests/DEFECTS.md`) and the review IDs.

| ID | Cause | Fix |
| --- | --- | --- |
| DEFECTS 1 / OG-5 | weekend adjustment ran after the window check | window filters the adjusted date (stage 4) |
| DEFECTS 2 / OG-4 / UI-RULE-12 | daily adjusted each day independently: Sat+Sun+Mon stacked on one id | daily ignores weekend adjustment (see section 4); ids unique |
| DEFECTS 3 / OG-1, OG-2 | monthly/quarterly loop tested a cursor carrying the start day | period-axis generation |
| DEFECTS 4 / OG-8 / UI-RULE-11 | `monthOfYear \|\| ...` treated January as absent | `??`-style resolution |
| DEFECTS 5 / OG-13 | no `default` on the frequency switch | throw in dev, warn + `[]` in production |
| DEFECTS 6 / ID-1, ID-2, ID-7, ID-8 | id derived from the adjusted date; slot fallback capped at 2; bi-weekly by milliseconds | logical-date identity, slot index, whole-day bi-weekly |
| ID-3, ID-4 (merge) / UI-LIFE-27/28/29, UI-BAL-06/07/08 (via merge), E2E-CAL-08/09/10/11 | colliding ids: one override hit two rows, a `Map` dropped a stored row | unique ids + multi-match merge |
| N-2 / ID-5 / UI-LIFE-30 | stored row with no `occurrenceId` could never replace its projection | pass 4 of the merge |
| N-3 (engine half) / UI-RULE-27/70/62 | quarterly fell back to day 1 (expense form writes `{}`) | fall back to the start date's day |
| N-4 / OG-10 / E2E-ROB-08 | negative `intervalWeeks` spun 5M iterations | sanitised + iteration-counted guard |
| OG-6, OG-7, OG-11, OG-12, OG-14 | raw-instant bounds; clamp duplicates; bad `dayOfWeek`; no lower clamp; unsorted `specificDays` | pipeline, dedupe, sanitising, clamp lower bound, sorting |
| ID-10 | override date applied after window filtering | windows apply to the final row date |
| DEFECTS 24 (12 tests) / DF-1, DF-2 / UI-OBS-07 / UI-DISP-43 / E2E-CAL-13 / E2E-JRN-05 | three date conventions in one engine | R4 (above) |
| DF-4 / UI-RULE-10 / UI-RULE-11 | `monthOfYear` persisted from a UTC parse | `parseDate` |
| UI-OBS-08, UI-RULE-16 (income form), E2E-JRN-10, E2E-TXN-03 | UTC "today" default dates | `getTodayKey()` |
| UI-LIFE-32, E2E-JRN-09, E2E-TXN-02 | Transactions Overdue tile used the UTC day | `getTodayKey()` |
| UI-BAL-09/10/13 | `balanceLastUpdatedAt` stamped with the UTC day | `getTodayKey()` |
| UI-LIFE-31, UI-RULE-17/18, UI-DISP-40/41/42, E2E-TXN-01, E2E-JRN-01/02/03/04/06/07/08 | stored dates rendered through `new Date(str)`; chart and comparison windows by UTC | `parseDate`, day-number arithmetic |
| getDaysBetween DST loss (review R4) | wall-clock cursor, time of day drifts to 01:00 | `eachDayBetween` by index |

**Known-defect counts (grep of markers):** `it.fails` unit 68 -> 44, integration 46 -> 42, timezone 12 -> 0;
UI `knownDefect` 222 -> 198; E2E `knownDefect` calls 55 -> 31.

E2E markers were removed by analysis only (Playwright was not run here): CAL-05/06/07/07b/08/09/10/11/12/13, JRN-01..10,
TXN-01..03, ROB-08. Two of those (CAL-12, and the passing "Monday carries three payments") were rewritten, see section 5.

---

## 3. D4: weekend adjustment at a rule/window boundary

**Verdict: the window must filter the ADJUSTED date (that part WAS a proven bug); the rule's own `startDate`/`endDate` bound the
LOGICAL date only (that part is NOT a bug).** This is the review's recommendation, now verified rather than assumed.

Candidate behaviours for a payment whose adjusted date falls outside `[startDate, endDate]`: (A) keep it, (B) drop it,
(C) clamp by shifting the other way.

**Window (proven bug).** Filtering the un-adjusted date means a window does not contain what LANDS in it: a payday shown on
Fri Jul 31 is missing from the July window because its raw date is Aug 1, and it appears only once August has been visited
(E2E-CAL-07/07b: July's closing was 1,200 on first visit, 1,300 after visiting August, because the view range only grows).
Experiment: restoring the old "filter the logical date" in stage 4 makes 10 unit tests fail:
- the brute-force reference model (the row whose ADJUSTED date is in the window is missing) and "returns dates ... always inside
  the window" (dates past `viewEnd` or before `viewStart` are returned);
- "keeps an occurrence whose adjusted date is in the window even though its logical date is not";
- 6 of the original DEFECTS-1 window tests (one-time, bi-weekly, monthly 'after', the Sunday-series pair, yearly).
(Composability holds either way, because partitioning by logical date is also a partition; the defect is the window's meaning, not
its additivity.) Consequence of the fix: 3 previously passing tests and 7 known-defect tests asserted an out-of-window date (the
old leak) and were rewritten (section 6).

**Rule bounds (not a bug).** Experiment: temporarily enforcing `startDate`/`endDate` on the adjusted date (B) makes 17 unit tests
fail, including **6 previously passing tests** that explicitly pin "'before' may move the first payment to the Friday preceding
`startDate`" (one-time Saturday and Sunday, weekly Saturday and Sunday series, bi-weekly Saturday series, monthly id stays inside
the month with `start = Sun Mar 15`). It also breaks the new invariants:
- "never loses a payment to weekend adjustment: the occurrence count is the same for none/before/after" (a first payment moved
  before `startDate`, or a last payment moved past `endDate`, is silently DELETED, so merely choosing "pay early" changes how many
  payments exist);
- "ids ignore weekendAdjustment" (the id set changes because a payment vanished);
- the brute-force differential test.

(C) clamping (shift the other way) contradicts the user's explicit Friday/Monday choice and no test supports it.

So: keep. Pinned by `occurrenceCalculator.shortCycles` ("keeps the last payment of a rule ending on a Saturday, paid the next Monday
with 'after'": Sat Jan 3/10/17, end Jan 17 -> Mon Jan 5/12/19), `longCycles` ("keeps 'before'-adjusted dates inside the window;
startDate bounds the logical date"), UI wizard tests for income (weekly Saturday end date) and expense (Sun Mar 1 'before' -> Fri Feb 27),
which replace the two `DECISION` todos. Note the visible consequence: a rule with an earlier start shows February's Saturday-28th
payday on Mon Mar 2 in March, under February's id.

---

## 4. Daily + weekend adjustment

**Decision: a daily rule ignores weekend adjustment.** Every day already has an occurrence, so "move a weekend payday to
Friday/Monday" has no meaning. Alternatives were worse:
- *stack Sat+Sun+Mon on Monday with unique ids*: total preserved, but a $10 daily coffee appears as $30 on Monday, and Friday
  stacks three items on one cell, none of which matches the user's week;
- *dedupe by adjusted date* (what the review's stage 3 read as): silently deletes two of every three payments.

Ids are the day itself (`daily_2026-03-14`), unique either way. Consistency with the suite: 4 existing tests
(the 2 unit DEFECTS-2 tests, the unit "daily 'before' earlier than viewStart", UI-RULE-12) already asserted unique dates, and pass as written.
UI-RULE-13 (duplicate preview cards) is still open only because the preview lives in `ExpenseRuleForm` (see section 7).
E2E-CAL-05/06/12 asserted "three payments on Monday with unique ids" and were rewritten to the new behaviour.
The form could hide the weekend control for daily rules; that is a form-stream decision.

---

## 5. Id-format change and data impact

**No id FORMAT changed** (`rule_YYYY-MM`, `rule_YYYY-Www`, `rule_BWn`, `rule_YYYY-MM-slot`, `rule_YYYY-Qn`, `rule_YYYY`,
`rule_once`, `rule_YYYY-MM-DD`). The VALUES change for occurrences whose weekend-adjusted date used to be in a different
period than the logical date, and for bi-weekly rules in DST zones:

| Frequency | Old id came from the adjusted date, so these change |
| --- | --- |
| monthly / quarterly / yearly | adjustment crossing a month / quarter / year boundary (Sun 1st "before", Sat Dec 31 "after", ...) |
| weekly | Saturday or Sunday with "after" (Monday is the next ISO week) |
| bi-weekly | weekend-anchored rules with "before" (the index was one too low); any rule across a DST spring-forward in a UTC-offset DST zone (index one too low until fall-back) |
| semi-monthly | an adjusted day that is not exactly a slot day (Sun 15 -> Mon 16 fell back to slot 2 and collided with the 30th) |
| daily | weekend days under adjustment (no longer adjusted) |

Unchanged (the vast majority): any rule with `weekendAdjustment: "none"`, and every occurrence that was not moved across a period.

**Stored rows (completions, skips):** keep matching. The merge recomputes the old id (`legacyOccurrenceId.ts`, byte-identical to the
previous algorithm) from the projection's adjusted date and accepts a stored row whose id equals it AND whose `scheduledDate`
equals the projection's date. Tests: `projectionMerger.identity.test.ts` (semi-monthly "after", the E2E-CAL-11 scenario, both
paydays under one old id).

**Stored overrides (`occurrenceOverrides`) keyed to an old id: NOT migrated, by design.** An override has no date to disambiguate
with, and the old ids were ambiguous by construction (Feb's shifted payday and Jan's own payday both owned `rule_2026-01`), so any
automatic mapping would apply one month's override to another. Effect: for weekend-adjusted rules, an old drag/amount/notes override
on an id listed above stops matching and the row shows at its natural date again. Users with live data (D1) on weekend-adjusted
weekly/bi-weekly/semi-monthly rules could be affected; a one-off migration (re-key overrides using the override's own
`scheduledDate` to find the occurrence) is possible if D1 says there is live data.

`transactionActions.ts` and `migrations.ts` still call `generateOccurrenceId(..., parseDate(scheduledDate), ...)` as a FALLBACK when
a row has no id (scheduledDate can be adjusted or overridden, so that id can drift). That is the mutation stream's code; note
for them.

---

## 6. Passing tests that were rewritten

Nothing was deleted and no assertion was loosened; changed expectations carry a hand derivation in a `REWRITTEN` comment.

| Test | Change and justification |
| --- | --- |
| `shortCycles` weekly / bi-weekly "terminates ... dayOfWeek can never be matched" (renamed "ignores ...") | Expected the FIRST period dropped (advanced a full 7 days because the alignment loop never matched, OG-11). Invalid `dayOfWeek` is ignored; Thu Jan 1 + 7/14-day steps. |
| `shortCycles` weekly "moves a Sunday series back to Fridays with 'before'..." | Adds Fri Jan 30: Sun Feb 1 (Jan 4 + 28) adjusts INTO `[Jan 1, Jan 31]`; the old expectation omitted it because the window test ran on the raw Feb 1. |
| `longCycles` quarterly "defaults dayOfMonth to 1" and "... still uses day 1" (renamed "falls back to the startDate day") | Required behaviour (task item): quarterly falls back to the start date's day (N-3). Jan 15 -> Jan 15/Apr 15/Jul 15/Oct 15; Jan 10 -> Jan 10, Apr 10. |
| `caps` unrecognised / undefined frequency "returns an empty array rather than throwing" | Pinned the silent swallow (OG-13). Now throws outside production; new test covers the production warn + `[]` path. |
| `dateUtils` `clampDayToMonth` "a day below 1 is returned as-is" | Day 0 fed to `new Date(y, m, 0)` is the previous month's last day (OG-12). 0, negatives and NaN clamp to 1. |
| `occurrenceIdGenerator` `runSchedule` helper | Fed the ADJUSTED date to the id generator; now `calculateOccurrencesDetailed` + `logicalDate` (the real composition). |
| `occurrenceIdGenerator` bi-weekly "keeps distinct ids for every occurrence of a weekend-adjusted schedule" | Old ids `BW0,BW1,BW2` came from adjusted Fridays. Logical Saturdays Jan 3/17/31 give offsets 0/14/28 -> `BW1,BW2,BW3`. Window widened to start Jan 1 so Fri Jan 2 is inside it. |
| `occurrenceIdGenerator` semi-monthly "falls back to slot 2 for a day above the first scheduled day" (renamed "NEAREST slot") | Pinned the capped fallback (ID-2). With `[15,30]`: 16 -> slot 1 (distance 1 vs 14), 29 -> slot 2, 31 -> slot 2. |
| `occurrenceIdGenerator` weekly "keeps the weekly id when weekend adjustment moves a Sunday back" | Window widened from Jan 11..Jan 11 to Jan 9..Jan 11 so the adjusted Fri Jan 9 is inside it. |

Known-defect tests whose EXPECTATION (not just the marker) changed, each hand-derived in a comment:
- daily Sat/Sun/Mon and Fri..Mon id tests: dates are the real days, ids `src_2026-01-03` etc., instead of "all pushed onto Monday";
- monthly / weekly-Saturday / quarterly / yearly / semi-monthly slot-1 id-drift tests: windows widened to contain the adjusted date
  (Feb 27, Feb 2, Dec 31 2027, Dec 31 2027, Feb 27); the yearly one gains the 7th entry Fri 2033-12-30 (Sun 2034-01-01 "before")
  with id `src_2034`;
- "weekly with 'after' emits a date past endDate" REVERSED (D4: the Jan 19 payment is kept) and renamed;
- "monthly never earlier than startDate after 'before'" and "never past the window end after 'after'" strengthened (the original
  assertions were vacuous on an empty result) and the first renamed to state what it now pins.

UI: the two `DECISION` todos for D4 (`income.forms`, `expense.forms`) became tests. E2E (not run): the `daily, weekend 'after'`
describe in `weekend.spec.ts` was rewritten for the daily decision (every day one payment; opening 1,050 / closing 1,060 on Mon
Mar 16 replaces 1,030 / 1,060; drag and complete operate on single-payment days; stored id `daily_2026-03-16`).

Converted tests keep their original titles (for example "UI-RULE-27 - quarterly expense: engine bills on the 1st...") so the ID stays
greppable; the titles describe the old defect, not the current behaviour.

---

## 7. Found but not fixed

| Item | Why |
| --- | --- |
| Bi-weekly id is anchored to `startDate` (known-defect `occurrenceIdGenerator` "keeps its id when the rule's startDate is edited") | Not in R2's list. The test demands `BW2` for both anchors, which no absolute-epoch numbering can satisfy; changing the numbering would orphan every stored `BWn` override. Editing `startDate` also moves the phase, so the dates change too. Needs a product call. |
| `installmentProjections.ts` passed the weekend-ADJUSTED date to `generateOccurrenceId` | Resolved by the debt stream (it now passes the logical date); verified after merging: the merge compiles and all suites are green. |
| `transactionActions.ts` / `migrations.ts` id fallbacks from `scheduledDate`, `getExpectedDateFromOccurrenceId` (ID-9) | Mutation stream. |
| UI-RULE-13 (duplicate cards in the Schedule Preview) and UI-RULE-19..26, 28 | The preview and hidden-default logic live in `ExpenseRuleForm/**` (and the income form imports that preview). The preview should call `calculateOccurrencesDetailed`. |
| UI-RULE-63/64, 61/62 legacy weekly edit | Form edit path. (UI-RULE-62, the quarterly half, is fixed by the engine fallback.) |
| Silent 500-occurrence cap (OG-9) | Pinned by 6 passing tests; scaling it or returning a `truncated` flag is a separate decision. |
| Chart buckets omit empty periods (DEFECTS 22) | Display/health stream; dates in `chartData` are fixed, bucket zero-filling is not. |
| Legacy override keys | see section 5. |
| `SchedulePreview`, `LoanDetailsForm`, `ExpenseRuleForm/formHelpers`, amortization, credit payoff, `creditProjections`: `new Date(str)`, `setMonth`, UTC "today" | Owned by other streams; on the convention test's allow-list. |
| `DF-6` memos not keyed to "today" | Out of this stream. |

## 8. Suite state (after merging the debt stream)

`npm test` 1,762 pass; `npm run test:tz` 74 pass; `tsc` clean for app/tests/e2e; full UI suite 640 pass, 27 todo; affected UI folders
also green under `America/New_York` and `Asia/Manila` (593 pass, 27 todo). Known-defect markers against the merged base:
`it.fails` unit 42 -> 18, integration 43 -> 39, timezone 12 -> 0; UI `knownDefect` 202 -> 178; E2E 53 -> 29.
