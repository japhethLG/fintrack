<!--
  FinTrack Finance-Logic Correctness Audit
  Generated: 2026-06-01
  Scope: correctness/logic/structure of finance-tracking math (security explicitly out of scope).
  Method: two parallel analyst sweeps (UI/context + lib/logic engine) -> 79 raw findings
  deduped into 19 clusters -> 3-vote adversarial re-verification per cluster (read real code,
  voted to refute) -> 5 critical findings additionally hand-verified by reproducing each
  numeric scenario. 11 weak sub-claims were refuted and dropped.
  Per-cluster dossiers (full reasoning, scenarios, fixes) live in ./dossiers/.
-->

# FinTrack Finance-Logic Correctness Audit — Final Report

## 1. Verdict

FinTrack's finance-tracking logic is **not currently correct**: it contains multiple real, reproducible bugs that produce wrong money figures under normal default usage, not just edge cases. The most serious are in the balance-reconstruction and runway engines (the displayed current/running balance can be off by the entire pre-window completed history, and runway/crunch double-count transactions already baked into the balance), in the loan amortization projection (remaining payments are dated months too early and the final payment is dropped), and in manual-transaction editing (flipping income↔expense silently fails to adjust the balance). A second systemic class of bugs comes from mixing UTC-parsed date strings (`new Date("YYYY-MM-DD")`) with locally-built occurrence dates, which drops whole paydays at month boundaries for every user outside UTC — i.e. essentially all of them. That said, the audit was balanced: several core algorithms are sound — the amortization **PMT formula** itself, the **bill-coverage running-balance sequencing** math, **occurrence date generation** for monthly/quarterly/yearly clamping, and the credit-card payoff iteration are mathematically correct; their bugs are in date placement, ID derivation, and boundary handling layered on top, not in the core arithmetic. The number of confirmed wrong-money paths means the tracker's headline figures (balances, runway, projections, health score) cannot currently be trusted without these fixes.

---

## 2. Critical Bugs

### 2.1 Opening/running balance loses all pre-window completed history
**C6 — critical.** [dailyBalance.ts:30-40](../../app/lib/logic/balanceCalculator/dailyBalance.ts#L30), [dailyBalance.ts:53-94](../../app/lib/logic/balanceCalculator/dailyBalance.ts#L53), [computedBalance.ts:22-31](../../app/lib/logic/balanceCalculator/computedBalance.ts#L22)

`calculateDailyBalances` reconstructs the opening balance by undoing **every** `status === "completed"` transaction with no date filter (collapsing `openingBalance` to `initialBalance`), but the day loop only re-applies transactions whose date lands inside `[startDate, endDate]`. `subscribeToStoredTransactions` fetches **all** stored transactions with no date constraint and `useViewDateRange` defaults the window to ~2 months back, so any completed transaction dated before the window is subtracted but never re-added.

- **Wrong vs correct:** `currentBalance = 5000` with +4000 of completed history dated in 2025 (pre-window) → today's (2026-06-01) closing balance computes to **1000**; correct is **5000**. The error equals the signed net of all pre-window completed transactions and grows without bound the longer the app is used.
- **Fix:** When reconstructing the opening balance, only reverse completed transactions whose effective date is `>= startDate` (the ones the loop will re-apply). Better: anchor explicitly on `balanceLastUpdatedAt` (currently never read — F48), force the running balance at the anchor to equal `currentBalance`, walk forward applying only post-anchor transactions, and stop applying past **projected/pending** items as if they happened (F48/F49: a past unpaid `projected` bill currently drags today's balance below the true value, e.g. 4200 vs 5000).

### 2.2 Runway and next-crunch double-count completed transactions
**C7 — critical.** [runway.ts:32-46](../../app/lib/logic/balanceCalculator/runway.ts#L32), [runway.ts:82-108](../../app/lib/logic/balanceCalculator/runway.ts#L82), contrast [scoreCalculators.ts:36](../../app/lib/logic/healthScore/scoreCalculators.ts#L36)

Both `getRunway` and `getNextCrunch` seed `balance = currentBalance` (which already embeds every completed transaction via `adjustUserBalance`) and then walk forward applying every transaction filtered only by `t.status !== "skipped"` — **including completed ones**. Any transaction completed today or with a future effective date is applied a second time. The parallel `calculateRunwayScore` correctly adds `&& t.status !== "completed"`, proving the intended pattern.

- **Wrong vs correct:** `currentBalance = 100` (already net of a $200 grocery bill completed today) → `getRunway` returns `{days: 0, runOutDate: "2026-06-01"}`, falsely declaring the user broke today. `currentBalance = 400` with a $500 rent completed today → `getNextCrunch` returns a spurious `{date: today, shortfall: 100}`. Completing a bill the same day it's due is routine, so this fires in normal use.
- **Also confirmed:** overdue unpaid `projected` bills with a past `scheduledDate` are silently dropped (loop starts at today), overstating runway — `getRunway(300, [projected -400 dated yesterday])` returns `{days: 365, runOutDate: null}` (F54). `getNextCrunch`'s `dayExpenses > 0` gate hides crunches caused by carried-over deficits, disagreeing with `getRunway` (F51). The infinite-runway return of `days = maxDays(365)` mismatches the UI's hardcoded "90+ days" (F57, low).
- **Fix:** Add `&& t.status !== "completed"` to both per-day filters; fold overdue non-completed outflows into the day-0 starting balance before iterating; drop the `dayExpenses > 0` gate in `getNextCrunch` to match `getRunway`; align the horizon/label.

### 2.3 Editing a completed manual transaction's type does not adjust the balance
**C14 — critical.** [transactionActions.ts:301-326](../../app/contexts/FinancialContext/actions/transactionActions.ts#L301), [ManualTransactionForm/index.tsx:108-113](../../app/components/pages/transactions/components/ManualTransactionForm/index.tsx#L108), [formHelpers.ts:80-93](../../app/components/pages/transactions/components/ManualTransactionForm/formHelpers.ts#L80)

`updateManualTransactionAction` computes every balance delta from `existing.type` and **never reads `updates.type`**, while the edit form leaves the Type select enabled when editing. When a completed transaction's type flips, the old impact must be reversed and the new impact applied with the opposite sign — but both deltas use the old type.

- **Wrong vs correct:** A completed **income** of 100 flipped to **expense** with amount unchanged: `oldAmount === newAmount` so **no branch fires** and the balance is untouched — off by **200** (correct: drop by 200). Editing the amount 100→120 applies +20 using the income sign → balance +20 instead of the correct net **−220** (off by 240). Since balance is maintained incrementally, it stays wrong until a manual reconcile.
- **Fix:** Compute old impact from `existing.type` and new impact from `updates.type ?? existing.type`, apply the net difference, or disable the Type field when editing.

### 2.4 Loan projection: remaining payments shifted months too early; final payment dropped; EMI inflated
**C4 — critical.** [loanProjections.ts:27-43](../../app/lib/logic/projectionEngine/loanProjections.ts#L27), [transactionActions.ts:123-131](../../app/contexts/FinancialContext/actions/transactionActions.ts#L123), contrast [installmentProjections.ts:35-37](../../app/lib/logic/projectionEngine/installmentProjections.ts#L35)

The amortization schedule is built with `startDate: parseDate(rule.startDate)` (the original first-payment date) and `termMonths: remainingPayments`, but the schedule anchor is **never advanced by `paymentsMade`**. `calculateAmortizationSchedule` starts at `config.startDate` and adds one month per step. The installment generator does this correctly by advancing `currentDate` by `installmentsPaid` first — proving the asymmetry.

- **Wrong vs correct (F7/F43):** Loan start 2026-01-15, term 12, `paymentsMade = 3`. The 9 remaining steps land on **2026-01-15 … 2026-09-15**; correct is **2026-04-10 … 2026-12-10**. Already-paid Jan/Feb/Mar are re-projected and the true Oct/Nov/Dec payments are dropped. Because `occurrenceId` is month-based, regenerated early steps re-collide with completed months and the schedule runs one month short, dropping the real final payment (F13).
- **paymentNumber wrong (F44):** `.filter()` runs before `.map((step, index) => ...)`, so `paymentNumber = paymentsMade + index + 1` uses the windowed index. A June payment of a 24-month loan is labeled "Payment 1 of 24" instead of 6.
- **EMI inflated (F46):** Projected-loan completion increments `paymentsMade` but never reduces `currentBalance` (unlike the stored path, which calls `updateLoanBalance`). Regenerating with the full balance over fewer months inflates the EMI: balance 12000 @ 12% over 11 months → **1153.5/payment vs the true ~1066.19** (~+8%).
- **Fix:** `startDate: addMonths(parseDate(rule.startDate), loanConfig.paymentsMade)` (mirror installments); map paymentNumber over the full schedule before filtering; on projected-loan completion also reduce `currentBalance` by the principal portion.

### 2.5 View-range UTC parsing drops whole paydays at month boundaries
**C1 — critical.** [projectionMerger.ts:28-33](../../app/contexts/FinancialContext/utils/projectionMerger.ts#L28), [occurrenceCalculator.ts](../../app/lib/logic/projectionEngine/occurrenceCalculator.ts), [dateUtils.ts:12-14](../../app/lib/utils/dateUtils.ts#L12)

`projectionMerger` builds the view bounds with `new Date(viewDateRange.start)` / `new Date(viewDateRange.end)` on bare `"YYYY-MM-DD"` strings, which JS parses as **UTC midnight**, then feeds them into `calculateOccurrences`. There, candidate occurrence dates are built **locally** via `parseDate` (dayjs) and `new Date(year, month, day)`, and compared against the bounds with inclusive guards (`date >= viewStartDate`, `date <= effectiveEnd`). The two time bases differ by the UTC offset. `useViewDateRange` defaults the window to the 1st and last day of a month, so monthly income/expenses land exactly on the dropped boundaries in default usage.

- **Wrong vs correct:** In Asia/Manila (+8), `new Date("2026-06-01")` = Jun 1 08:00 local, so a monthly salary on the 1st fails `>= viewStart` and the **June payday is dropped** entirely; June projected and opening balances are silently understated. In America/New_York (−4), `new Date("2026-06-30")` = Jun 29 20:00 local, so a last-day payday fails `<= effectiveEnd` and is dropped.
- **Fix:** Parse view bounds with the same local `parseDate`, make the end inclusive at day granularity (`dayjs(parseDate(end)).endOf('day')`), or compare occurrences by `YYYY-MM-DD` string. Apply the identical fix to `useComputedFinancials.ts:21-22` (see C1b/F18).

---

## 3. High-Severity Bugs

### 3.1 Occurrence IDs derived from the weekend-adjusted date → ID collisions
**C2 — high.** [occurrenceIdGenerator.ts:1-6,37-45](../../app/lib/logic/projectionEngine/occurrenceIdGenerator.ts#L1), [incomeProjections.ts:36-44](../../app/lib/logic/projectionEngine/incomeProjections.ts#L36), [expenseProjections.ts:55-63](../../app/lib/logic/projectionEngine/expenseProjections.ts#L55), merge key at [projectionMerger.ts:15-16](../../app/contexts/FinancialContext/utils/projectionMerger.ts#L15)

`calculateOccurrences` applies `adjustForWeekend` to every pushed date, and the projection builders pass that **already-adjusted** date into `generateOccurrenceId` — directly contradicting the function's docstring promising stability "even if the scheduled date shifts (weekend adjust)". Because `projectionMerger` dedups on `occurrenceId`, a collision shadows/drops a real occurrence.

- **Wrong vs correct (F2):** Semi-monthly `[15,30]`, 'after', March 2025: day-15 (Sat)→Mar 17 gives `getSemiMonthlyIndex = 2`, and day-30 (Sun)→Mar 31 also gives index 2 → **both paychecks collapse to `src_2025-03-2`**. Completing one makes the other vanish.
- **Wrong vs correct (F38):** Monthly `dayOfMonth = 1`, 'before': Feb 1 2025 (Sat)→Jan 31 → `rent_2025-01` (collides with January); Mar 1 (Sat)→Feb 28 → `rent_2025-02`. Each month's rent collides with the prior month.
- **Note:** F8's daily-collision claim is real but its weekly claim was refuted (an exhaustive weekday sweep found zero ISO-week collisions); treat daily separately under C3.
- **Fix:** Derive the occurrence ID from the **logical (pre-adjustment)** date — compute the ID inside `calculateOccurrences` before `adjustForWeekend`, or return `{logicalDate, scheduledDate}` and key on `logicalDate`.

### 3.2 Occurrence generation: same-day duplicates, daily weekend collapse, weekend leaks past window
**C3 — high.** [occurrenceCalculator.ts:50-57,115-123,141,161,179](../../app/lib/logic/projectionEngine/occurrenceCalculator.ts#L50), [dateUtils.ts (projectionEngine)](../../app/lib/logic/projectionEngine/dateUtils.ts)

Each branch tests the **raw** date against the window but pushes `adjustForWeekend(date)`, with no de-duplication. `projectionMerger` maps projections 1:1 with no cross-projection dedup, and `dailyBalance`/`summaryCalculations` sum every transaction's `projectedAmount` per date — so duplicates are genuinely **double/triple-counted**, not silently dropped.

- **F3:** Semi-monthly `[14,15]`, 'after', Feb 2026 — both day14 (Sat) and day15 (Sun) → Mon 2026-02-16 (two paychecks one day).
- **F39:** Semi-monthly `[29,30]`, Feb 2025 — both clamp to Feb 28 **and** share `getSemiMonthlyIndex = 1`, so identical date and ID.
- **F41:** Daily 'after', week of 2025-01-10 — Sat and Sun both → Mon Jan 13, plus Mon itself = **three $10 expenses on Monday, zero on the weekend**, identical IDs.
- **F40:** Window membership is tested on the raw date but the adjusted date is pushed, so an occurrence at `effectiveEnd` (e.g. Mar 1 2025 Sat) leaks out to Mar 3, outside the requested window. (F4, the month-end clamp variant, was refuted — the clamping math itself is correct.)
- **Fix:** Test `adjustForWeekend(date)` against the window before pushing; de-duplicate semi-monthly/daily by resolved scheduledDate; skip weekend adjustment for daily frequency.

### 3.3 Loan form: contradictory payments, calculationType ignored, wrong total interest
**C5 — high (consensus medium).** [LoanDetailsForm.tsx:27-54,130-147](../../app/components/pages/expenses/components/ExpenseRuleForm/components/LoanDetailsForm.tsx#L27), [formHelpers.ts:262-274](../../app/components/pages/expenses/components/ExpenseRuleForm/formHelpers.ts#L262), [ReviewStep.tsx:168-171](../../app/components/pages/expenses/components/ExpenseRuleForm/steps/ReviewStep.tsx#L168)

- **F19:** The headline EMI uses the **original principal** (`calculateLoanPayment(loanPrincipal, …)`), while the preview amortizes `loanCurrentBalance || loanPrincipal` over the **full** term. For principal 10000 / balance 5000 / 6% / 12mo the card shows **860.66** but every preview row shows **430.33** — two contradictory payments on screen, and the remaining balance is spread over the full term instead of the ~6 remaining months.
- **F20:** `calculationType` (flat_rate / reducing_balance / amortized) is stored but **read by nothing** in `app/lib` — `calculateLoanPayment` always applies amortizing PMT. A flat_rate 12000 / 10% / 24mo loan displays payment **553.74 / interest 1289.74** instead of the correct **600.00 / 2400.00** (~half the true interest).
- **F21:** Total interest = `calculatedPayment * termMonths - loanPrincipal` overstates interest for partially-paid loans (it includes interest on principal already repaid).
- **Fix:** Drive the headline EMI and preview from the same balance/term; branch `calculateLoanPayment` on `calculationType`; compute total interest by summing the schedule's interest column.

### 3.4 Health score: zero-income masking, balance-trend sign inversion, overdue exclusion
**C8 — high.** [scoreCalculators.ts:100-117,131-159,201-216](../../app/lib/logic/healthScore/scoreCalculators.ts#L100), [Forecast.tsx:194-202,255-258](../../app/components/pages/forecast/Forecast.tsx#L194), [insights.ts:36-45](../../app/lib/logic/healthScore/insights.ts#L36)

- **F23/F71:** `rate = totalIncome > 0 ? (savings/totalIncome)*100 : 0` forces rate to **0** when income = 0 and expenses > 0. Income 0 / expenses 2000 → savings −2000 but rate 0, hitting the `rate >= 0` bucket for **score 20** instead of the intended 0 (inflating the 0.3-weighted component by +6). F24 is the same pattern in Forecast, so the "Negative Cash Flow" alert (gated on `actualSavingsRate < 0`) never fires despite a real deficit. F72: the misleading "increase your savings rate to at least 10%" insight fires instead of "spending more than you earn".
- **F73:** `calculateBalanceTrendScore` divides slope by the **signed** `avgBalance`. Balances rising from −1000 to −200 (slope +200, avg −600) give `normalizedSlope = −33.3` → trend "declining", score 0, when the balance is clearly **improving** (should be +33.3 / score ~100). Fix: divide by `Math.abs(avgBalance)`.
- **F76 (low):** The bill-payment score filters out `status === "projected"`, excluding overdue unpaid bills from the denominator → 1 on-time bill + 3 overdue = 100% on-time score (should be 25%).
- **F77 was refuted** (the health-score runway's exclusion of completed is defensible here).

### 3.5 Currency precision/formatting errors
**C9 — high.** [currency.ts:45-106](../../app/lib/utils/currency.ts#L45), [BalanceSection.tsx:21-90](../../app/components/pages/settings/components/BalanceSection.tsx#L21)

- **F29:** `formatCurrencyWithSign` defaults `maximumFractionDigits = 0`, silently rounding away cents on money it renders. A 0.49 variance shows "**+₱0**"; income 1234.56 in `DayDetailSidebar` shows "**+₱1,235**". Fix: default to 2 fraction digits (0 for JPY).
- **F30:** `formatCurrency` uses `minimumFractionDigits = 0` → ragged "1,234 / 1,234.5 / 1,234.57".
- **F31:** Sign derived from the raw value while magnitude is rounded separately → `formatCurrency(-0.001)` = "**-₱0**". Fix: derive sign from the rounded value.
- **F33:** `parseFloat` on user balance strings mis-parses grouping/locale separators — `parseFloat("1,234.56") = 1` (stores ₱1) and EUR de-DE `parseFloat("1234,56") = 1234` (drops the cents), both passing the yup `is-number` test.
- **F32 was refuted:** float accumulation residue (~1e-16) is real but far below the 0.01 mismatch threshold, so it does not trip a false "Balance mismatch" warning.

### 3.6 Credit-card calculator: first-payment overflow, truncated-baseline scenarios, full_balance extra month
**C13 — high.** [creditProjections.ts:31-46](../../app/lib/logic/projectionEngine/creditProjections.ts#L31), [scenarioCalculator.ts:20-85](../../app/lib/logic/creditCardCalculator/scenarioCalculator.ts#L20), [payoffCalculator.ts:30-56](../../app/lib/logic/creditCardCalculator/payoffCalculator.ts#L30)

- **F45:** `firstPaymentDate.setDate(creditConfig.dueDate)` has no month-length clamp (unlike the later branches). Start 2026-02-10, dueDate 31 → `setDate(31)` overflows Feb to **Mar 3**, the `< startDate` guard is skipped, and the whole schedule starts at Mar 31 instead of Feb 28 — a full month late.
- **F67:** When the current strategy never pays off (minimum-payment trap), the schedule truncates at month 13 / cumulativeInterest 1300. A Double Payment that truly pays off in 36 months (interest 2000.56) computes `interestSavings = 1300 − 2000.56 = −700.56` and is **discarded by the `interestSavings > 0` filter** — hiding the one helpful option from the user who most needs it, even though the summary correctly reports `Infinity`. Fix: detect the non-terminating baseline and treat its interest/months as Infinity.
- **F68:** `full_balance` returns the bare balance, but interest is accrued first, leaving a one-month-interest residual → balance 5000 @ 24% takes **2 months / 102 interest** instead of clearing in 1. Fix: pay `balance + accrued interest` (or honor grace period).
- **F70 (low):** dead `currentTotal` variable. **F69 was refuted** (APR/12 is an accepted convention).

### 3.7 Standalone amortization: month-end date overflow (plus dormant gaps)
**C15 — high.** [loanAmortization.ts:35-64](../../app/lib/logic/amortization/loanAmortization.ts#L35), contrast [dateUtils.ts:55](../../app/lib/utils/dateUtils.ts#L55)

- **F65 (the only one reachable in production):** `currentDate.setMonth(getMonth()+1)` overflows month-ends. Start 2026-01-31 → emitted dates **Jan 31, Mar 3, Apr 3, May 3, …** (February skipped, then locked to the 3rd) instead of the dayjs `addMonths` result Jan 31 / Feb 28 / Mar 31 / Apr 30. `loanProjections` feeds `parseDate(rule.startDate)` and uses `step.date` for occurrence IDs and placement, so any loan starting on the 29th–31st gets wrong payment dates. Fix: use `addMonths`.
- **F62 (final payment not trued up → ~0.03 residual), F63 (negative-amortization drops capitalized interest), F64 (sub-cent residual surfaced unrounded)** are real code gaps but **dormant** — neither in-app caller passes `monthlyPayment`, so the analytic PMT path always ends at exactly 0 and `payment ≥ interest`. Worth fixing defensively (and rounding emitted `remainingBalance`) before any caller supplies a rounded payment. **F66** (mutable `payment` var) was refuted as a live bug.

---

## 4. Medium-Severity Bugs

- **C1b — UTC date-key off-by-ones in other modules (medium).** Same `new Date("YYYY-MM-DD")` / `toISOString()` vs local-`formatDate` mismatch as C1, confirmed live in: [chartData.ts:42-82](../../app/lib/logic/healthScore/chartData.ts#L42) (F74 — in NY, daily key for `2026-06-15` becomes `2026-06-14`, monthly bucket `2026-06-01`→`2026-05`, label `2026-06`→"May 2026"; mis-attributes Dashboard chart totals); [PeriodComparison.tsx:24-33](../../app/components/pages/dashboard/components/PeriodComparison.tsx#L24) (F75 — prev window `2026-05-01..2026-05-30`, dropping May 31 from the comparison); [forecastCalculator.ts:26-44,60](../../app/lib/logic/forecasting/forecastCalculator.ts#L26) (F78 — `toISOString` keys mis-date forecast points by one day in +UTC zones); [useComputedFinancials.ts:18-24](../../app/contexts/FinancialContext/hooks/useComputedFinancials.ts#L18) (F18 — day grid shifted one day). **F50 was refuted** (the proration day diff is always an exact integer). Fix: route all date parsing through `parseDate`/`formatDate`/`addDays`.

- **C10 — prorateToDateRange fixed 30-day month over-counts (medium).** [frequencyUtils.ts:44-54](../../app/lib/utils/frequencyUtils.ts#L44). Divides a monthly amount by a hardcoded `daysInMonth = 30` but multiplies by the inclusive actual day count. A $6000 monthly source over a full July (31 days) = **6200** (+3.3%); over a 28-day February = **5600** (−6.7%); over Q3 (92 days) = **18,400** vs the correct 18,000. Drives Forecast "Budgeted vs Actual". F6: `getMonthlyMultiplier` uses daily = 30 while weekly = 52/12 (~1.4% internal inconsistency). **F5's DST/fractional-day claim was refuted.** Fix: prorate against the actual days in the spanned month(s) or 365/12.

- **C16 — ProjectedVsActual widget buckets projected by actualDate (medium).** [ProjectedVsActualWidget.tsx:22-25](../../app/components/pages/dashboard/components/ProjectedVsActualWidget.tsx#L22). A single key `t.actualDate || t.scheduledDate` drives both the projected and actual accumulators. Salary scheduled 2026-06-30 (projected 5000) recorded late on 2026-07-02 → June shows **projected 0 / actual 0** (the 5000 baseline vanishes); the amount mis-buckets to July. Fix: bucket projected by `scheduledDate`, actual by `actualDate`.

- **C11 — Variance report understates projected and omits income categories (medium).** [variance.ts:19-56](../../app/lib/logic/balanceCalculator/variance.ts#L19). Filters to `status === "completed"` **before** summing, so `projectedExpenses` counts only completed items: 5 projected $1000 bills with 2 completed → projected 2000 / actual 2000 / variance **0%** ("on budget") while $3000 of unpaid bills is dropped (F56). `byCategory` is populated only in the expense branch, so income categories never appear (F55). Severity capped because `metrics.variance` is currently unconsumed by the UI/AI. Fix: compute projected from all in-range transactions; populate the category map for income too.

- **C12 — Bill coverage window and ordering (medium).** [billCoverage.ts:22-75](../../app/lib/logic/balanceCalculator/billCoverage.ts#L22). F58: `endDate = addDays(today, daysAhead)` with inclusive bounds spans **15** calendar days for a "Next 14 days" label. F59: the comparator sorts by date string only with no tie-breaker, so a same-day paycheck-vs-bill verdict is decided by arbitrary Firestore order (`canCoverAll` can be true or false from identical data). F60: a negative `runningBalance` is carried forward, so a trivially-affordable $10 bill after a $150 shortfall is flagged "at risk" with a cumulative **$60** shortfall. **F61 was refuted.** Fix: `endDate = addDays(today, daysAhead - 1)`; add a deterministic same-day tie-breaker (bills before income); clamp the running balance or report per-bill gaps.

---

## 5. Low-Severity / Structural

- **C18 (low):** [projectionMerger.ts:37-43](../../app/contexts/FinancialContext/utils/projectionMerger.ts#L37) — two stored rows sharing one `occurrenceId` collapse in the `Map`, dropping one from the merged result while its balance impact was already applied (F14). Stale comment claiming "sourceId + scheduledDate" key (actually occurrenceId-first) and dead `amount` var / `||` vs `??` fallback in the widget (F15). [formHelpers.ts:276-288](../../app/components/pages/expenses/components/ExpenseRuleForm/formHelpers.ts#L276) — installment amount unrounded with no final-payment reconciliation: 1000/7 → 142.86 × 7 = **1000.02** (F22). [Dashboard.tsx:113-129](../../app/components/pages/dashboard/Dashboard.tsx#L113) — for ranges > 90 days the sampling step can skip the endDate, so the CashFlowChart "Closing"/change figures read an interior day (F28).
- **C7-F57 (low):** runway returns `days = 365` for infinite runway while the UI shows "90+ days".
- **C13-F70 (low):** dead `currentTotal` in the scenario calculator.

---

## 6. What's Correct (verified sound)

- **Amortization PMT formula** itself is correct; on the analytic path the schedule ends at exactly 0 (the F62/F63 gaps are dormant). The bug is in **date stepping** (F65), not the math.
- **Bill-coverage running-balance arithmetic** (the sequential subtraction) is correct; the issues are window size, tie-break ordering, and per-bill labeling — not the core sequencing.
- **Monthly/quarterly/yearly occurrence date clamping** (`clampDayToMonth`: Jan 31 → Feb 28 → Mar 31) is correct (F4 refuted).
- **Credit-card payoff iteration** computes correctly; the summary correctly reports `Infinity` for non-terminating strategies (the scenario filter, not the core loop, is wrong).
- **`computeBalanceFromTransactions`** correctly defines the completed-only source of truth — it's the *daily* reconstruction and runway that diverge from it.
- **Float accumulation residue** (F32) exists but is harmless (~1e-16, below all thresholds).
- **ISO-week occurrence IDs** for weekly schedules do not collide (F8 weekly claim refuted).
- **`prorateToDateRange` day diff** is an exact integer (no DST off-by-one; F5/F50 date claims refuted).

---

## 7. Refuted / Not Confirmed

- **C17 (Forecast horizon end-point semantics) — fully refuted.** `calculateForecast` takes a `daysToForecast` count and emits exactly that many points, self-consistent with its contract; grep shows it has **zero callers**, so the hypothesized off-by-one cannot occur. A count-API vs date-range-API style observation, not a correctness bug.
- **Individual sub-findings dropped from confirmed clusters:** F50 (proration UTC), F4 (month-end clamp), F8-weekly (ISO-week collision), F32 (float mismatch warning), F69 (APR/12), F66 (mutable payment var), F77 (health-runway completed exclusion), F61 (daysUntilDue key), F15 partially (treated as low only). F62/F63/F64 (C15) are real but **dormant** (unreachable on current call paths).

---

## 8. Recommended Fix Priority

1. **C6** — Anchor the daily/running balance to `balanceLastUpdatedAt`; stop undoing pre-window completed history and stop applying past projected/pending items. (Corrupts the headline balance for every long-term user.)
2. **C7** — Exclude completed from runway/crunch loops; fold in overdue outflows. (False "broke today" / false crunches.)
3. **C14** — Fix manual-edit type-flip balance adjustment (or disable the Type field on edit).
4. **C4** — Advance the loan amortization anchor by `paymentsMade`; fix paymentNumber; reduce `currentBalance` on projected-loan completion.
5. **C1 / C1b** — Replace all `new Date("YYYY-MM-DD")` / `toISOString()` date handling with `parseDate`/`formatDate`/`addDays` (fixes dropped paydays, chart mislabeling, period comparison, forecast keys).
6. **C2 / C3** — Derive occurrence IDs from the logical (pre-weekend-adjust) date; test adjusted dates against the window; de-duplicate semi-monthly/daily; skip weekend adjust for daily.
7. **C8** — Fix zero-income savings-rate masking and the balance-trend sign inversion; include overdue bills in the bill-payment denominator.
8. **C5 / C13 / C15** — Loan-form consistency + `calculationType`; credit-card first-payment clamp, truncated-baseline scenarios, full_balance month; amortization `addMonths`.
9. **C9 / C10 / C16 / C11 / C12** — Currency precision, proration denominator, widget bucketing, variance projected baseline, bill-coverage window/ordering.
10. **C18** + remaining low items — structural cleanups and rounding reconciliation.

Dossiers with full per-finding reasoning, scenarios, and suggested fixes: [cluster_C1](./dossiers/cluster_C1.md), [cluster_C1b](./dossiers/cluster_C1b.md), [cluster_C2](./dossiers/cluster_C2.md), [cluster_C3](./dossiers/cluster_C3.md), [cluster_C4](./dossiers/cluster_C4.md), [cluster_C5](./dossiers/cluster_C5.md), [cluster_C6](./dossiers/cluster_C6.md), [cluster_C7](./dossiers/cluster_C7.md), [cluster_C8](./dossiers/cluster_C8.md), [cluster_C9](./dossiers/cluster_C9.md), [cluster_C10](./dossiers/cluster_C10.md), [cluster_C11](./dossiers/cluster_C11.md), [cluster_C12](./dossiers/cluster_C12.md), [cluster_C13](./dossiers/cluster_C13.md), [cluster_C14](./dossiers/cluster_C14.md), [cluster_C15](./dossiers/cluster_C15.md), [cluster_C16](./dossiers/cluster_C16.md), [cluster_C18](./dossiers/cluster_C18.md).
