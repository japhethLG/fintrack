# Cluster C8

Health score: zero-income savings-rate masking, balance-trend inversion on negative avg, bill-payment excludes overdue, runway sub-score excludes completed

Source files implicated:
- app/lib/logic/healthScore/scoreCalculators.ts
- app/components/pages/forecast/Forecast.tsx
- app/lib/logic/healthScore/insights.ts

## Member findings (from first-round analysts)

### [F23] (high/logic-error) Savings-rate divide-by-zero guard masks a deficit: zero income + positive expenses reports 0% (not negative), giving a falsely positive score
- File: app/lib/logic/healthScore/scoreCalculators.ts : 100-117
- Why wrong: When totalIncome === 0 but totalExpenses > 0 (the user is spending with no recorded income for the period), the ternary `totalIncome > 0 ? ... : 0` forces rate to 0 instead of a negative number. A 0% savings rate then matches the `rate >= 0` branch and yields a score of 20 instead of the intended 0 for a pure deficit. The correct behavior per the documented scale ("Negative = 0") is that spending with no income is the worst case (negative savings rate, score 0). The guard at line 101 only handles income===0 AND expenses===0; the income===0, expenses>0 case falls through with the wrong sign.
- Scenario: Period has no income transactions and one $2,000 expense. totalIncome=0, totalExpenses=2000, savings=-2000. rate computed as 0 (because of the `: 0` fallback). Score = 20 (the `rate >= 0` bucket) and the rate displayed is 0%. Correct: savings rate is -infinity/undefined (pure deficit), score should be 0, and `generateInsights` should fire "You're spending more than you earn" (it checks savingsRate < 0, which never triggers here).
- Suggested fix: Treat income===0 with expenses>0 as a deficit: e.g. `const rate = totalIncome > 0 ? (savings / totalIncome) * 100 : (totalExpenses > 0 ? -100 : 0);` (or return score 0 directly). Ensure the negative-cash-flow insight path is reachable when there is spending but no income.
- First-round verification: UNVERIFIED (verifier crashed)

### [F24] (medium/logic-error) Forecast actual/budgeted savings rate has the same zero-income masking bug, showing 0% 'warning' instead of a deficit when income is 0 but expenses exist
- File: app/components/pages/forecast/Forecast.tsx : 194-202
- Why wrong: Identical divide-by-zero handling to the health score. When income is 0 and expenses > 0, savingsRate is forced to 0 rather than reflecting the deficit. The MetricsGrid then renders it with `status={savingsRate >= 20 ? 'success' : savingsRate >= 0 ? 'warning' : 'danger'}`, so a period where the user spent money with no income shows a benign 'warning' 0% savings rate, while the negative-cash-flow Alert in MonthlyOverview (gated on `actualSavingsRate < 0`) never appears. The budgeted block at lines 257-258 has the same pattern (`proratedIncome > 0 ? (surplus / proratedIncome) * 100 : 0`).
- Scenario: Date range with $0 projected/actual income and $3,000 of expenses. actualMetrics.savingsRate = 0 (not negative). MetricsGrid shows Actual Savings Rate '0.0%' with 'warning' styling; MonthlyOverview's 'Negative Cash Flow' alert (line 303, `actualSavingsRate < 0`) does not render even though surplus is -$3,000. Correct: indicate a deficit (negative or N/A) and surface the negative-cash-flow alert.
- Suggested fix: Mirror the fix from scoreCalculators: when income===0 and expenses>0, treat savings rate as negative (or display 'N/A'/'-'), and base the deficit alert on `surplus < 0` rather than on `savingsRate < 0`.
- First-round verification: UNVERIFIED (verifier crashed)

### [F71] (high/logic-error) Savings-rate score gives 20 (not 0) and reports 0% when income is zero but expenses exist
- File: app/lib/logic/healthScore/scoreCalculators.ts : 101-116
- Why wrong: The divide-by-zero guard `totalIncome > 0 ? ... : 0` forces the savings rate to exactly 0 whenever there is no income, regardless of how large expenses are. Because the bucket test is `else if (rate >= 0) score = 20`, a user with ZERO income but positive expenses (spending with no earnings, the worst possible savings situation) is scored 20/100 in the savings component and the reported rate is 0%. The intended behavior (per the doc comment 'Negative = 0') is that spending more than you earn yields score 0. The only legitimate 'neutral' zero-income case (no income AND no expenses) is already handled separately on line 101. The correct logic is: if `totalIncome === 0 && totalExpenses > 0`, the savings rate is effectively -infinity and the score should be 0 (and `rate` should be reported as negative, not 0).
- Scenario: Period has income=$0, expenses=$1000 (e.g. a month where all income was marked projected/skipped but bills posted). Code computes savings=-1000, rate=0, score=20, returns {score:20, rate:0}. Correct output: score=0 (negative savings), and rate should reflect overspending (negative). The weighted overall score is inflated by 0.3*20 = +6 points versus the correct 0.
- Suggested fix: Handle the zero-income-with-expenses case explicitly before the bucket ladder, e.g. `if (totalIncome === 0) return { score: totalExpenses > 0 ? 0 : 100, rate: totalExpenses > 0 ? -100 : 0 };` (or compute rate as a large negative so the existing `else score = 0` branch is taken).
- First-round verification: UNVERIFIED (verifier crashed)

### [F72] (medium/logic-error) Misleading savings insight fires for zero-income overspending
- File: app/lib/logic/healthScore/insights.ts : 36-45
- Why wrong: This is a downstream effect of the zero-income bug in scoreCalculators.ts. When income=0 and expenses>0, `calculateSavingsRateScore` returns rate=0 and score=20. Here `savingsRate < 0` is false (rate is 0), the no-transactions branch requires `components.savingsRate === 100` (it is 20, so false), so the code lands on `savingsRate < 10` and emits 'Try to increase your savings rate to at least 10%.' For a user with literally zero income and active spending, the correct insight is the spending-more-than-you-earn warning, not a mild 'increase to 10%' nudge. The insight thresholds therefore do not match the underlying financial situation.
- Scenario: income=$0, expenses=$1000 for the period. Insight shown: 'Try to increase your savings rate to at least 10%.' Correct insight: 'You're spending more than you earn. Review your expenses.'
- Suggested fix: Fix the root cause in calculateSavingsRateScore so rate is negative when income is 0 and expenses>0; then the `savingsRate < 0` branch here fires correctly. Alternatively also guard the zero-income case explicitly in the insight selection.
- First-round verification: UNVERIFIED (verifier crashed)

### [F73] (medium/logic-error) Balance-trend score inverts trend direction when average balance is negative
- File: app/lib/logic/healthScore/scoreCalculators.ts : 201-216
- Why wrong: The slope is normalized by dividing by the signed average balance. When `avgBalance` is negative (the user is overdrawn / in debt across the window), dividing a positive slope (balance rising = improving) by a negative average flips the sign of `normalizedSlope`, so an improving balance is classified as 'declining' (and a worsening balance is classified as 'improving'). The normalization denominator must be magnitude-only; it should use `Math.abs(avgBalance)` so the sign of `normalizedSlope` always matches the sign of `slope`.
- Scenario: Daily closing balances over 5 days climb from -1000 to -200 (clearly improving). slope=+200, avgBalance=-600, normalizedSlope=(200/-600)*100=-33.3. Code sets trend='declining', score=Math.max(0, 30-333)=0. Correct: trend='improving', score≈100. The trend component (20% weight) is wrong by ~20 points and the emitted insight wrongly says 'Your balance is trending downward.'
- Suggested fix: Use `const normalizedSlope = avgBalance !== 0 ? (slope / Math.abs(avgBalance)) * 100 : 0;` so the slope sign is preserved.
- First-round verification: UNVERIFIED (verifier crashed)

### [F76] (low/logic-error) Bill-payment score silently excludes overdue unpaid bills, inflating the on-time rate
- File: app/lib/logic/healthScore/scoreCalculators.ts : 131-159
- Why wrong: The denominator filters out `t.status === "projected"`, which is the status of a past-due bill that was never marked paid. So a bill that was scheduled in the past, is overdue, and remains unpaid does not count against the bill-payment rate at all - it is simply excluded. The metric is documented as '% of past transactions completed on or before scheduled date', and an overdue unpaid bill is the clearest failure to pay on time, yet it is omitted from both numerator and denominator. This can make the on-time rate (and thus the 20%-weighted component) artificially high precisely when the user is missing payments. Note that skipped past bills ARE in the denominator (status !== 'projected') but never counted as on-time, which is a separate, defensible-but-inconsistent choice.
- Scenario: Period has 1 completed-on-time bill and 3 past-due bills still in 'projected' status. pastExpenses=[the 1 completed], rate=100%, score=100 - a perfect bill-payment score while 3 bills are overdue. Correct behavior: the 3 overdue unpaid bills should be counted in the denominator (as not-on-time), giving rate=25%.
- Suggested fix: Include overdue unpaid bills in the denominator, e.g. keep past expenses with status 'projected' or 'completed' (treating overdue 'projected' as not-on-time), and decide explicitly how 'skipped' should be treated rather than implicitly counting it as a missed payment.
- First-round verification: UNVERIFIED (verifier crashed)

### [F77] (low/edge-case) Runway score excludes completed transactions dated today/future while currentBalance + canonical runway treat them differently
- File: app/lib/logic/healthScore/scoreCalculators.ts : 34-46
- Why wrong: This runway routine drops all completed transactions and always uses `projectedAmount` (never `actualAmount`). The canonical runway in balanceCalculator/runway.ts filters only `skipped` and uses `actualAmount` for completed. For past-dated completed transactions the health-score behavior is correct (they are already baked into currentBalance), but a transaction that is completed AND dated today or in the future (possible for manual transactions completed with a forward scheduledDate, or completed-today items) is counted by currentBalance/canonical runway but ignored here, so the two runway numbers diverge. Also, using `projectedAmount` rather than the day's effective amount is inconsistent with every other aggregator in the module (savings, chart, periodStats all use actualAmount for completed).
- Scenario: User marks a $3000 expense completed today (scheduledDate = today, status=completed); currentBalance already reflects it. The dashboard runway tile (canonical getRunway, which includes completed-today and would double-subtract from a balance that already includes it) and the health-score runway disagree about today's cash position. Edge case, but produces two different runway numbers on the same dashboard.
- Suggested fix: Make the health-score runway use the same filter/amount convention as balanceCalculator/runway.ts (filter only 'skipped', use actualAmount ?? projectedAmount for completed) OR reuse getRunway directly and map its day count to the score buckets, so the dashboard shows a single consistent runway.
- First-round verification: UNVERIFIED (verifier crashed)
