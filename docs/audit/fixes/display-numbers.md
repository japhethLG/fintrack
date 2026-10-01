# Fix log: displayed numbers (calendar balances, risk views, health score, monthly totals, widgets)

**Stream:** DISPLAYED NUMBERS (R5 and the display half of the risk views).
**Base:** `claude/financial-projections-engine-g5fgkv` (32736d5).
**Not touched by design:** currency symbols/formatting (`currency.ts`, hard-coded `$`/`₱`, decimals, minus signs, axis ticks), the write
path (`transactionActions`, `ledger.ts`, firestore), the forms, `computedBalance.ts`, `.github/`, Firestore rules, `.env*`.

Every expected value in the new tests is hand-derived in a comment next to it; none is computed with app code.

---

## 1. The model (decision D5), defined once

`app/lib/logic/balanceCalculator/openItems.ts` is the single definition. Every consumer (calendar, runway, next crunch, bill coverage,
health runway, overdue alert) reads it.

- **B** = `currentBalance` = `initialBalance + SUM(completed)`, the realized balance. Only completing a row moves it.
- A row is **completed**, **skipped**, or **open**. An open row is **overdue** if it is `projected` and dated BEFORE today (local day),
  **upcoming** if dated today or later.
- **Overdue expenses do not move B**, but they are OWED: every projection starts day 0 at `B - (sum of overdue expenses)`.
- **Overdue income is not credited.** Money that has not arrived is not money you can spend. It is listed (flagged) on its own day.
- A day is judged by its END-OF-DAY balance, income credited before expenses. The same rule orders same-day rows everywhere
  (`compareOpenRows`: date, income before expenses, then name, then id), so the answer never depends on which list a row came from.
- Overdue rows are tracked back only to `defaultWindowStart(today)` = the 1st of the month two months ago (the oldest day the app
  projects without the user browsing). The view window only ever grows; anchoring on a fixed start keeps every risk number independent of
  how far the user has scrolled.
- **Calendar** (`calculateDailyBalances`, anchored on B, a function of `B`, the rows and `today` only):
  - history before today = "B minus everything completed after that day" (no window, no navigation dependence; UI-BAL-35/36, UI-DISP-01..09);
  - today: opening = B (less anything completed today); `overdueOwed` is deducted on today; closing = B when nothing is due or overdue,
    i.e. the same number Dashboard and Settings print;
  - after today: projects forward from `B - overdue owed + upcoming rows`;
  - an overdue row is listed on its own day, flagged ("overdue" badge on the row, a danger ring and an "Overdue" tooltip on the chip), but is in no day's totals and
    does not move its day. Identity on every day: `closing = opening + income - expenses - overdueOwed`;
  - a completed row dated AFTER today (paid ahead of its due date; the Complete dialog defaults the date to the due date) stays listed and
    totalled on its own day (a chip never hops away from its date), but its MONEY moves on today, which is what B already says. So today's
    closing is B even then, and the identity above holds with that row counted on today;
  - a user with a balance and no rows sees B on every day (the hook no longer returns an empty map for zero rows; UI-DISP-14, UI-BAL-40).
- **Runway / next crunch / health runway** are ONE walk (`walkRisk`): B, overdue expenses folded into day 0, completed rows never touched
  (BAL-2), the `dayExpenses > 0` gate gone, an already-overdrawn account reported today (`days 0`, shortfall = the deeper of "now" and
  "end of today"). **One horizon, 90 days** (`RISK_HORIZON_DAYS`): the default window always covers at least the next 90 days (it ends on the
  last day of the month three months ahead; the worst case, today = Jan 31, ends Apr 30 = day 89), so "no run-out within 90 days" is a
  statement about data the app really has and the label "90+ days" says exactly that. A 365-day scan over ~4 months of generated rows
  over-states the runway once the data ends (BAL-7). UI-DISP-34 is satisfied by agreement, not by the particular horizon (see section 4).
- **Bill coverage**: window exactly `BILL_COVERAGE_DAYS = 14` days = today .. today+13 (spec "Next 14 days of bills"; the Dashboard Upcoming
  widget and the Expenses/Income "Next N days" widgets now also mean exactly N days). Order: overdue expenses first (listed with
  `daysUntilDue < 0` and an "Overdue" tag), then the window, income before bills within a day. `shortfall` is each bill's OWN uncovered part
  (`amount - max(balance, 0)`), not a cumulative carry; `projectedBalance` still runs on.

## 2. Totals by occurrence counting (no `amount x multiplier`)

`app/lib/logic/forecasting/recurringTotals.ts`:

- **Period totals** (`summarizePeriod`, `healthScore/periodStats.ts`): ONE definition used by the Dashboard KPIs, the Calendar month tiles and
  range panel, and the Forecast "Actual". A row belongs to `actualDate || scheduledDate`; completed rows at `actualAmount ?? projectedAmount`;
  pending rows at the plan; skipped rows nowhere.
- **Monthly Recurring** (Recurring Summary widget, Income manager, Expense manager): the recurring rows (not one-time, not manual) of the CURRENT
  CALENDAR MONTH from sources/rules that are current. Labelled "Scheduled for March 2026". Five Fridays are five payments.
- **Annual Projection** (Income manager): `annualRecurringTotals`, the engine's occurrences of the next 12 months (today .. same day next year - 1),
  labelled "Next 12 months". A daily source is 365 payments (UI-DISP-24, UI-RULE-67).
- **Current / Active** (`isIncomeSourceCurrent`, `isExpenseRuleCurrent`): switched on AND not past its end date AND not a repaid loan, a settled
  card or a fully paid installment plan. Only these count as "Active" or in any total (UI-DISP-25..28, UI-RULE-68/69).
- **Forecast Budgeted** = the PLAN of the period: every non-skipped row scheduled in it at its projected amount (`plannedTotals`), the same plan the
  Projected vs Actual widget calls "projected". A 3,000 salary is a 3,000 budget in a 31-day month (UI-OBS-01); one-time rules and manual rows
  are part of the plan (the budget must cover the rows the actuals cover). No proration.
- **Total Debt** (`totalDebt`): loans + cards + unpaid instalments (remaining x amount), the same function on the Expenses page and the Forecast
  (UI-DISP-06, E2E-JRN-18).
- `frequencyUtils`: `getMonthlyMultiplier` and `prorateToDateRange` are no longer used by any figure. Kept as TYPICAL-MONTH helpers (doc says so):
  daily is 365/12 (not 30), `prorateToDateRange` values each day at `monthly / days-in-that-month` (a whole month is exactly the monthly amount).

## 3. Defects fixed (verified test IDs)

| ID | Cause | Fix |
| --- | --- | --- |
| UI-BAL-35/36, UI-DISP-01/02/03/07/08/09, E2E-JRN-11/12 | undid all completed rows, replayed only the window; window grows on navigation | anchored on B |
| UI-DISP-14, UI-BAL-40 | empty map when no transactions | always computed |
| UI-DISP-04/15/16 | chart "Opening" was day 1's closing | opening = first day's opening |
| UI-DISP-05 | Bills tab vs calendar | one model; test rewritten for the 14-day window |
| UI-DISP-19/20 | percent change by signed previous, `0` baseline neutral | `percentChange` by `|prev|`; zero baseline is "new" |
| UI-DISP-23 | `\|\|` turned an actual 0 into the plan | `??`; plan by `scheduledDate`, actual by `actualDate` |
| UI-DISP-24/25/26/27/28, UI-RULE-67/68/69 | multipliers; ended/settled/paid-off counted | occurrence counting, `isCurrent` |
| UI-DISP-29/30 | trend normalised by a signed average | normalised by mean absolute balance; sorted by date |
| UI-DISP-31/35 | zero income with expenses scored 20 / no alert | rate -100, score 0, "Negative Cash Flow" shows |
| UI-DISP-32 | overdue bills left out of the bill-payment denominator | counted (a bill due today is not late yet) |
| UI-DISP-33/34 | runway re-spent completed rows; 365 vs 90 | one walk, one horizon |
| UI-DISP-36 | "this month" subtitle | "net in <period label>" |
| UI-DISP-37 | same-day order depended on the list | income first, then name, then id |
| UI-DISP-06, E2E-JRN-18 | Forecast Total Debt omitted installments | shared `totalDebt` |
| UI-OBS-01 | budget prorated by days/30 | plan, no proration |
| BAL-1, BAL-2, BAL-4, BAL-7, BAL-9, BAL-10, BAL-11 (review ids) | see section 1 | see section 1 |
| HS-1, HS-2, HS-4, HS-6, HS-9, HS-10, HS-11, HS-12 (review ids) | trend sign, zero income, overdue bills, near-zero average, insight order, empty buckets, variance baseline, income categories | see section 1/2 |
| UI-14 (review) | Dashboard sampled > 90 days could skip the end | `sampleDayOffsets` always keeps the last day |
| empty account (E2E-ROB fixme, UI-DISP todo) | "93/100 Grade A", "90+ days" | neutral "Not enough data yet" on the health card and the runway card (no rows at all) |
| DECISION todos resolved | overdue vs today, 14/15 days, cumulative shortfall, bucketing, monthly totals, zero baseline % | now real tests |

Also: the Dashboard overdue alert uses the same overdue definition; the chart leaves out a day that has no balance instead of drawing today's
balance there (BAL-6); `variance` baseline = every non-skipped planned row, actual = completed rows only (so under-delivery shows), income
categories listed.

## 4. Passing tests rewritten (justification: a user decision or a proof of correctness overrides the old pin)

| Test | Old | New | Justification |
| --- | --- | --- | --- |
| forwardLooking: coverage window (3 tests), `daysUntilDue` | 15-day window | 14 days; overdue `before` row listed with `daysUntilDue -1` | user decision 14 days, D5 |
| forwardLooking: coverage "FIRST uncoverable bill" | shortfalls `[100, 400]` | `[100, 300]` | per-bill shortfall: Electric 300 finds nothing left, Water's 100 is not re-billed |
| forwardLooking: runway/crunch "characterizes the defect" (5) and "contradicted by calculateRunwayScore" | completed rows re-spent | completed rows never walked; runway = crunch = score | BAL-2: B already contains them |
| forwardLooking: `dayExpenses > 0` block (2) | overdrawn account reported late / never | reported today | gate dropped (BAL-11) |
| forwardLooking: `calculateForecast` contract test | `getRunway` runs out tomorrow | `{days: 10, runOutDate: null}` | same BAL-2 |
| forwardLooking: bill payment "ignores still-projected bills" | `{100, 100}` | untouched overdue bill `{0, 0}`; plus 3 paid + 1 overdue = 75 and a bill due today not late | D5, HS-4 |
| forwardLooking: `getMonthlyMultiplier` daily; `prorateToDateRange` (8) | 30; 30-day divisor (3,100, 2,800) | 365/12; calendar days (3,000, 3,000, 1,961.2903 across Mar 20 .. Apr 8: 12 x 3,000/31 + 8 x 3,000/30) | user decision: no approximations; UI-OBS-01 |
| balances: `calculateVarianceReport` "counts only completed" | projected 100 | plan 1,099 (100 + pending 999; skipped 888 out), actual 120, variance -979 (-89.08%) | HS-11 |
| balances: 8 daily-balance tests | implicit time independence | `freezeToday("2026-01-01")` in the describe; 4 tests with rows completed on 01-02..01-04 pass `today` explicitly | the series now depends on today (what is history, overdue, upcoming); fixtures meant "upcoming" |
| lifecycle: scenarios | frozen at 2026-01-02, the 01-01 salary a day overdue | frozen at 2026-01-01; an early payment moves its money on the payment day (listed on its due date); each changed curve hand-derived in comments (e.g. paying the 1,200 rent on 01-01: 01-01 = 2,000 + 3,000 - 1,200 = 3,800) | D5; an unpaid overdue salary is not credited |
| lifecycle: "overdue" suite (4) | overdue bill spent on its own day, dropped from coverage | owed from today (02-10: 2,000 - 1,200 = 800), listed in coverage (daysUntilDue -5, projected 800) | D5; the older rows are settled as skipped so the 02-05 rent is the only overdue row |
| lifecycle: invariant guard | `closing = opening + income - expenses` | `... - overdueOwed`, overdue rows out of totals, a completed row dated after today moves on today | documented identity of the new model |
| lifecycle: variance (2), late payment | income variance 0; Feb variance 0 | plan includes the pending salary (-3,000 / -100%); Feb plan 1,200, actual 0 | HS-11 |
| timezone offsets: coverage (4), runway (1) | today+14 in, yesterday out, stale expense ignored | today+13 last day, yesterday listed as overdue (`-1`), the stale expense runs out today | 14-day decision, D5 |
| healthScore tests: chart buckets (12), tz invariance (1) | sparse | zero-filled (31 days in March, 61 in Mar+Apr, 5 weekly buckets); activity read through a `withActivity` filter AND a bucket-count assertion | HS-10 (a range with no activity stays `[]`) |
| healthScore: "keeps insights in source order" | all four fire, order by push | danger first then warnings; same three kept | severity ranking |
| UI crossScreen: Upcoming 14d (income 2,000, net +570), Bills tab 14,539.17, Recurring Summary (4,750 / 2,730), Budgeted `[2,729.88, 2,820.88]`, Income Upcoming Payments 4,750 | see test comments | income 0, net -1,430; 12,539.17 (13,969.05 - 1,429.8817); 4,820 / 2,681 / 2,139; 2,929.88; 2,750 | 14-day window; occurrence counting; plan |
| UI dashboard: late-paid bill `[0,0,130,100]` | plan followed the payment | `[0,0,130,0]` (plan in Feb, actual in Mar) | bucketing decision |
| UI dashboard: multipliers 3,067 | multiplier | 2,800 (March: 4 Fridays 400 + 2 bi-weekly 400 + semi-monthly 2,000) | counting |
| UI dashboard: brand-new health card | finite numbers | "Not enough data yet" | empty-account decision |
| UI forecast: "no bills and a positive balance: 90+ days" | neutral | "Not enough data yet"; a second test keeps "90+ days / No crunch" for a user WITH data | empty-account decision |
| UI forecast: UI-DISP-34 | `120 days` next to `No crunch` | `60 days` + `Crunch on 5/15/2026`; a bill 120 days out gives `90+ days` + `No crunch` | the premise (a 120-day run-out is found) belongs to a 365-day horizon; the fix is agreement on one horizon (90). To return to 365 change `RISK_HORIZON_DAYS`. |
| UI forecast: coverage window (D13/D14/D15), overdue todo | 15-day | 14-day; overdue test asserts today opens at 300, owes 400, closes at -100, runway 0 days | decisions |
| UI managers/mutation/rules.managers (about 14 expectations) | `x 52/12`, 5,067, 2,273, 108, 433 | real counts: Jan 2026: 5,400 / 2,400 after deactivating Salary / 2,065 (1,000 + 100 + 564.8817 + 100 + 300) / 125 / 500; Annual 60,800; March mutation values (2,761, 2,686, ...) | counting; each derived in its test |

Resolved DECISION todos (now real tests): overdue vs today's balance, 14 vs 15 days, cumulative vs own shortfall, plan bucketing, "Monthly totals
authoritative", empty-account score, zero-baseline percent, empty-account fixme (E2E). Left open (not answered): previous period for a full-month
selection, "X% spent" cap, performance budget (the walks are now O(rows + days), so the 4-11 s with 200 rules should be re-measured), future-dated
completions, overdue modal total.

## 5. New tests

- `tests/ui/display/oneHousehold.test.tsx`: ONE household (H3), the same March on Dashboard, Calendar, Forecast and both managers (income 3,500,
  expenses 1,660, net 1,840, today's balance 5,600 on Dashboard/Forecast/Calendar, month opens 4,000 and closes 5,840, scrolling the calendar
  changes nothing).
- `tests/unit/balanceCalculator/realizedAnchor.test.ts`, `riskViews.test.ts`; `tests/unit/healthScore/periodAndHealth.test.ts`;
  `tests/unit/forecasting/recurringTotals.test.ts` (53-Wednesday year = 53 payments where the multiplier says 52).

## 6. Counts and leftovers

See the final report for suite counts. Known-defect markers: `it.fails` 25 -> 11, UI `knownDefect` 60 -> 25, E2E `knownDefect` 13 -> see report.
The remaining ones belong to the currency/formatting stream (UI-BAL-37/38, UI-DISP-10..13/17/18/21/22, UI-OBS-02/06 ...).

Leftovers and risks:

- **Future-dated completions**: a completed row dated after today is listed and totalled on its own day, but its money moves on today. On that
  one day the panel's Income/Expenses tiles therefore do not add up to the day's opening-to-closing movement. A Complete dialog that defaults
  the actual date to today would remove the case.
- **Overdue older than the default window** (before the 1st of the month two months ago) is not tracked by the risk views or the overdue alert.
- **Overdue income** is not credited anywhere in the projections; a user who is simply late recording a payday sees a lower projection until
  they complete it.
- `OverdueTransactionsModal` "Total Overdue", `geminiService` "Upcoming (next 30 days)" (E2E-ROB-12), `SchedulePreview` are outside this stream.
- Forecast "Budgeted" includes manual rows (their plan equals what they were entered at).
- The day panel's tiles are by displayed day; the Calendar month tiles include overdue rows (they are part of the month's plan).

## 7. After merging the currency stream (def776d)

- Merged `claude/financial-projections-engine-g5fgkv`; their formatting calls were kept (`useCurrency`), mine only changed numbers.
- Opening/Closing balances (calendar overview, day chips, Dashboard cash-flow card), the pie total, the Recurring Summary widget and the Income/Expense
  manager summary cards no longer pass `maximumFractionDigits: 0`: they print cents like every other amount. Pins updated with derivations
  (e.g. H1 March closing 14,539.1683 -> 14,539.17, today 13,969.05, Mar 1 opens 12,350.00).
- Calendar, journey and robustness e2e pins gained `.00`; the cash figures that changed value are in the rewritten navigation spec (D5).
