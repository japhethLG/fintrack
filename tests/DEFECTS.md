# Known defects in the projection engine

The test suite encodes every known production bug as an `it.fails` test that
asserts the **correct** behaviour. `it.fails` passes while the assertion fails,
so the suite is green today and turns **red** the moment someone fixes the bug.

**If a test named `KNOWN DEFECT: ...` starts failing, you fixed something.**
Find the root cause below, delete the `it.fails` tests listed against it (or
convert them to plain `it`), and the suite goes green again.

This ledger exists because several root causes are asserted by more than one
test, in more than one file. One two-line fix can turn six tests red at once.
Group the failures by root cause here before triaging them individually.

Every `it.fails` in the suite has been mechanically verified to fail through a
genuine `expect` assertion rather than a crash — `it.fails` cannot tell the two
apart, so a crash-based one would be a false positive that reports "defect still
present" forever. To re-verify after changing the suite:

```sh
grep -rl 'it\.fails(' tests/ | while read f; do perl -pi -e 's/\bit\.fails\(/it(/g' "$f"; done
npx vitest run --reporter=json --outputFile=/tmp/flip.json
git checkout -- tests/          # MANDATORY — restores it.fails
```

Then confirm every failure is an `AssertionError`, not a `TypeError`.

---

## 1. Weekend adjustment is applied after the window filter

**Source:** `app/lib/logic/projectionEngine/occurrenceCalculator.ts:45,53,75,98,141-142`

`adjustForWeekend` is called on the date being pushed, _after_ it has been
checked against `viewStartDate`/`viewEndDate`/`endDate`. So `"after"` can emit a
date past the window end and `"before"` a date before the window start — or even
before the rule's own `startDate`.

**Correct:** every returned date lies within `[viewStartDate, viewEndDate]` and on
or after `startDate`.

**Tests (6):** `occurrenceCalculator.shortCycles.test.ts` (one per branch:
one-time, daily, weekly, bi-weekly) · `occurrenceCalculator.longCycles.test.ts`
(monthly, both directions)

**Note:** one fix clears all six. The likely fix — filter after adjusting — also
interacts with defect 2, so fix them together.

---

## 2. Daily frequency collapses weekend days onto one date

**Source:** `app/lib/logic/projectionEngine/occurrenceCalculator.ts:50-57`

Each day is weekend-adjusted independently inside the per-day loop, so with
`"after"` a Saturday, Sunday and Monday all become the same Monday. The
occurrence id for `daily` is derived from that adjusted date
(`occurrenceIdGenerator.ts:67`), so the duplicates share one id — which means
duplicate `proj_` ids, duplicate React keys, and the day's amount counted three
times.

**Correct:** three distinct occurrences keep three distinct dates and ids.

**Tests (~6):** `occurrenceCalculator.shortCycles.test.ts` ·
`occurrenceIdGenerator.test.ts` (drives the real
`calculateOccurrences` → `generateOccurrenceId` composition) ·
`projectionMerger.test.ts` (asserts merged ids are unique)

---

## 3. Monthly and quarterly drop trailing occurrences

**Source:** `app/lib/logic/projectionEngine/occurrenceCalculator.ts:134` (monthly),
`:154` (quarterly)

The loop condition tests `monthCursor`, which carries the **start date's**
day-of-month, while the emitted date is built from `scheduleConfig.dayOfMonth`.
When `dayOfMonth` falls earlier in the month than the start day, the final period
is cut off — and a mid-stream month can be lost too.

Confirmed: `startDate: "2026-01-20"`, `dayOfMonth: 1`, window
`2026-01-01 .. 2026-03-15` returns `["2026-02-01"]`. Correct is
`["2026-02-01", "2026-03-01"]`.

Semi-monthly is immune (its cursor is normalised with `setDate(1)`) and yearly is
immune (it iterates an integer year). Both are pinned as passing tests.

**Tests (3):** `occurrenceCalculator.longCycles.test.ts`

---

## 4. Yearly ignores a configured `monthOfYear` of January

**Source:** `app/lib/logic/projectionEngine/occurrenceCalculator.ts:171`

`scheduleConfig.monthOfYear || start.getMonth()` treats the valid zero-based
January as absent, so a yearly rule configured for January falls back to the
start date's month.

**Tests (1):** `occurrenceCalculator.longCycles.test.ts`

---

## 5. An unrecognised frequency is silently swallowed

**Source:** `app/lib/logic/projectionEngine/occurrenceCalculator.ts` (the `switch`
has no `default`)

A misspelt, legacy or corrupted `frequency` yields no occurrences and no error.
The rule vanishes from every projection, balance, runway and coverage figure, and
an empty result is indistinguishable from the legitimate "no occurrences in this
window".

**Tests (1):** `occurrenceCalculator.caps.test.ts`

---

## 6. Weekend adjustment silently changes an occurrence's logical identity

**Source:** `occurrenceCalculator.ts:141-142` + `occurrenceIdGenerator.ts`

When weekend adjustment moves an occurrence across a month, quarter or year
boundary, `generateOccurrenceId` derives the id from the **adjusted** date, so the
occurrence changes logical period. Its override and its completion record are
orphaned — the whole point of the occurrence-id design is defeated.

**Tests (~8):** `occurrenceIdGenerator.test.ts`

---

## 7. Loan projections drift after each completed payment

**Source:** `app/lib/logic/projectionEngine/loanProjections.ts:28-43`

Completing a payment increments `loanConfig.paymentsMade` but never reduces
`currentBalance` (see defect 9). Three consequences, each asserted separately:

| Consequence                                                                            | Source   | Correct                                              |
| -------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| Payment amount inflates — PMT is recomputed over the same balance across fewer periods | `:32-37` | amount unchanged as `paymentsMade` rises             |
| Schedule slides earlier — it always starts at `rule.startDate`                         | `:36`    | first remaining payment is `paymentsMade` months out |
| `paymentNumber` double-counts — `paymentsMade + index + 1` while `index` restarts      | `:43`    | payment at `startDate` is number 1                   |

**Tests (~7):** `loans.test.ts` (unit, canonical) · `lifecycle.test.ts`
(end-to-end)

---

## 8. Three `LoanConfig` fields are collected but ignored

**Source:** `app/lib/logic/projectionEngine/loanProjections.ts:32-37`

`monthlyPayment` (the user's own figure, replaced by a recomputed PMT),
`firstPaymentDate` (the schedule keys off `rule.startDate` instead), and
`calculationType` (`flat_rate` and `reducing_balance` produce output identical to
`amortized`).

**Tests (3):** `loans.test.ts`

---

## 9. Credit-card balances are never reduced by payments

**Source:** `app/contexts/FinancialContext/actions/transactionActions.ts:122-140`
and `app/lib/firebase/firestore/transactions.ts:181-192`

Both completion paths branch on `loanConfig` and `installmentConfig` only. Paying
a card never moves `creditConfig.currentBalance`, so the projected payoff
schedule restarts from the original balance forever.

`updateCreditBalance` (`expenseRules.ts:140`) already exists and is **dead code** —
no caller anywhere. The fix is plausibly one line: add a `creditConfig` branch
that calls it. `entityCrud.test.ts` pins the contract that branch would rely on.

**Tests (2):** `actualMutation.firestore.test.ts` (canonical — the firestore
layer) · `actualMutation.actions.test.ts` (the projection path)

---

## 10. The two completion paths disagree

**Source:** `transactionActions.ts:122-140` vs `transactions.ts:181-192`

Completing a **stored** transaction calls `updateLoanBalance`, which reduces the
loan balance and increments the counter. Completing a **projection** only
increments `paymentsMade`. The same user gesture produces different state
depending on whether the row happened to be stored already.

Related: `revertToProjected` decrements `paymentsMade` but never restores
`currentBalance`, so repeated complete/revert cycles permanently erode the loan
balance.

**Tests (~3):** `actualMutation.actions.test.ts` · `actualMutation.firestore.test.ts`

---

## 11. Materialising a projection records the wrong projected amount

**Source:** `app/contexts/FinancialContext/actions/transactionActions.ts:95`

`projectedAmount` is taken from `source.amount` rather than from the projection
being completed. For a loan or card occurrence (whose real projected amount comes
from the amortization/payoff schedule) or for an occurrence carrying an amount
override, the stored projected figure — and therefore the variance — is wrong.

**Tests (~3):** `actualMutation.actions.test.ts` (canonical) · `lifecycle.test.ts`

---

## 12. Rescheduling a projection discards its other overrides

**Source:** `app/contexts/FinancialContext/actions/transactionActions.ts:228`

`rescheduleTransactionAction` writes a fresh `{ scheduledDate }` object, so any
existing `amount`, `notes` or `skipped` override for that occurrence is lost.

**Tests (1):** `actualMutation.actions.test.ts`

---

## 13. Reverting loses a custom date for most frequencies

**Source:** `app/contexts/FinancialContext/actions/transactionActions.ts:414-448`

`getExpectedDateFromOccurrenceId` can only reconstruct monthly and daily dates;
for weekly, bi-weekly, semi-monthly, quarterly and yearly it returns `null`, so
no override is written and the user's custom date is silently lost on revert.

It also reconstructs the monthly date from `source.startDate`'s day-of-month and
ignores `scheduleConfig.dayOfMonth`, so a rule whose `dayOfMonth` differs from its
start day gets a spurious override.

**Tests (2):** `actualMutation.actions.test.ts`

---

## 14. Deleting a completed rule-based transaction leaves the money applied

**Source:** `app/contexts/FinancialContext/actions/transactionActions.ts:346`

The balance reversal is gated on `sourceType === "manual"`. Deleting a completed
**rule-based** transaction removes the record while its effect stays in
`currentBalance`.

**Tests (1):** `actualMutation.actions.test.ts`

---

## 15. A type flip on a completed transaction corrupts the balance

**Source:** `app/contexts/FinancialContext/actions/transactionActions.ts:309-323`

Both the reversal and the re-application read `existing.type`, so changing income
↔ expense on a completed row applies the new amount in the old direction.

**Tests (1):** `actualMutation.actions.test.ts`

---

## 16. Pre-window completed transactions corrupt every balance in the window

**Source:** `app/lib/logic/balanceCalculator/dailyBalance.ts:27-53`

The opening balance reverses **all** completed transactions in the list — and
`subscribeToStoredTransactions` (`transactions.ts:347`) fetches the user's entire
history with no date filter — but the replay loop only walks days inside the
window. Anything completed before the window start is subtracted and never added
back.

The default window is two months back, so any transaction completed earlier than
that skews every displayed balance.

**Tests (1):** `projectedVsActual.balances.test.ts`

---

## 17. `DayBalance.projectedIncome` / `projectedExpenses` are always 0

**Source:** `app/lib/logic/balanceCalculator/dailyBalance.ts:87-88`

The type advertises a projected-vs-actual split per day that the calculator never
populates, so the calendar cannot show one.

**Tests (1):** `projectedVsActual.balances.test.ts`

---

## 18. `getRunway` re-applies completed transactions

**Source:** `app/lib/logic/balanceCalculator/runway.ts:37-46`

**The contract:** forward-looking projections start from `currentBalance`, which
already contains every completed transaction. Re-applying them double-counts.

`getRunway` includes completed rows; `calculateRunwayScore`
(`scoreCalculators.ts:34-37`) correctly excludes them; `calculateForecast` filters
to `status === "projected"`. `getRunway` is the odd one out.

**Tests (1):** `projectedVsActual.forwardLooking.test.ts`

---

## 19. Income variance by category is discarded

**Source:** `app/lib/logic/balanceCalculator/variance.ts:42-47`

`byCategory` is built inside the expense branch only, so income variance has no
category breakdown.

**Tests (1):** `projectedVsActual.balances.test.ts`

---

## 20. `getCategoryBreakdown` mixes income and expenses into one total

**Source:** `app/lib/logic/balanceCalculator/categoryBreakdown.ts:28`

Without a `type` filter, income and expense amounts are summed into one
`grandTotal`, making every percentage meaningless for a mixed list.

**Tests (1):** `projectedVsActual.balances.test.ts`

---

## 21. Health-score insights truncate by push order, not severity

**Source:** `app/lib/logic/healthScore/insights.ts:61`

`.slice(0, 3)` keeps whichever insights were pushed first. A user with a great
runway, great savings and a perfect bill record but a **declining balance** is
shown three compliments and no warning.

**Tests (2):** `healthScore/insightsAndChartData.test.ts`

---

## 22. Chart buckets omit empty periods

**Source:** `app/lib/logic/healthScore/chartData.ts:71-92`

Periods with no transactions are absent rather than zero-filled. On a categorical
axis an 18-day gap renders as one day, and the consumer cannot distinguish "no
activity" from "not in the data".

**Tests (1):** `healthScore/insightsAndChartData.test.ts`

---

## 23. Credit-card payoff advice contradicts itself

**Source:** `app/lib/logic/creditCardCalculator/scenarioCalculator.ts:20` +
`payoffCalculator.ts:60-62`

For a card the summary reports as `totalInterestToPay: Infinity` /
`monthsToPayoff: Infinity`, the scenarios quote escaping that debt as saving
626.43 of interest and **one month** — because the baseline comes from a schedule
truncated after month 12.

Also: `totalPayments` is hardcoded to 0 in credit-card payment breakdowns
(`creditProjections.ts:98`), so "payment N of M" has no M.

**Tests (~3):** `creditCardSummary.test.ts` · `creditCards.test.ts`

---

## 24. Timezone: three date conventions in one engine

**Source:** `useViewDateRange.ts:15-22` · `projectionMerger.ts:31` ·
`forecastCalculator.ts:26,43` · `users.ts:93`

The engine mixes local-midnight parsing (`parseDate`, correct), UTC-midnight
parsing (`new Date("YYYY-MM-DD")`), and UTC-day serialization
(`toISOString().split("T")[0]`). At a positive UTC offset these disagree: the
default view window lands a day early and can slide into the wrong month.

The pure occurrence engine is offset-independent and is asserted to produce
identical output at UTC+8.

**Tests (12):** `tests/timezone/offsets.test.ts` — run with
`npm run test:tz`, **not** covered by `npm test`

---

## Dead code and unreachable branches

Documented rather than tested, so a future refactor that makes them live has a
note to find:

| Location                                    | Why unreachable                                                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billCoverage.ts:49`                        | the completed-amount ternary sits after completed rows are filtered out at `:30`                                                                                     |
| `billCoverage.ts:83`                        | `firstAtRisk.shortfall \|\| 0` — `shortfall` is always set when `!canCover`                                                                                          |
| `transactionActions.ts:369-370`             | `revertToProjected` never returns `null`; it throws instead                                                                                                          |
| `projectionMerger.ts:16`                    | the bare `t.scheduledDate` key needs a row with neither `occurrenceId` nor `sourceId`; both call sites guarantee one                                                 |
| `projectionMerger.ts:57`                    | `proj.occurrenceId \|\| ""` — every generator supplies an id                                                                                                         |
| `expenseRules.ts:140` `updateCreditBalance` | exported, correct, and called by nothing — see defect 9                                                                                                              |
| `reconciliation.ts` (whole module)          | `generateReconciliationReport` / `fixBalanceDiscrepancy` have no callers and are not re-exported from the module index, so the app has drift detection it never runs |
| `balanceHistory.ts`                         | nothing writes snapshots, so the history feature is inert                                                                                                            |
