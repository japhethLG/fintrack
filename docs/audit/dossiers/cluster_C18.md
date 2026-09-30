# Cluster C18

Structural/minor: dup-occurrenceId merge drop, stale comment/dead var, installment no rounding, cashflow chart sampling

Source files implicated:
- app/contexts/FinancialContext/utils/projectionMerger.ts
- app/components/pages/expenses/components/ExpenseRuleForm/formHelpers.ts
- app/components/pages/dashboard/Dashboard.tsx

## Member findings (from first-round analysts)

### [F14] (low/edge-case) Two stored transactions sharing one occurrenceId silently drop one during merge
- File: app/contexts/FinancialContext/utils/projectionMerger.ts : 37-43
- Why wrong: storedByKey is keyed by getKey (occurrenceId for source-backed rows). If two stored transactions resolve to the same key, the second overwrites the first, so only one survives in the map. In the projections pass the surviving one is returned and the key deleted (line 52); in the trailing pass (lines 77-83) storedByKey.has(key) is now false, so the first stored transaction is never pushed and is lost from the merged result. This can occur with duplicate completions of the same occurrence or imported/legacy data that produced two rows for one logical occurrence. A merge should not silently discard a persisted, balance-affecting transaction.
- Scenario: Two completed rows exist for occurrenceId rule_2026-03 (e.g. a double mark-complete): row A actualAmount 500, row B actualAmount 520. The map ends up holding only B. The matching projection returns B and deletes the key; A is never re-added. The widget then counts only 520 toward actual, hiding the duplicate (and the duplicate's real balance impact remains applied to currentBalance), so on-screen actual and the stored balance disagree.
- Suggested fix: Detect and handle key collisions explicitly (e.g. keep a list per key, surface a reconciliation warning, or include all unmatched stored rows regardless of map overwrites) instead of letting Map.set silently drop earlier entries.
- First-round verification: UNVERIFIED (verifier crashed)

### [F15] (low/structure) Stale comment and dead variable obscure the actual matching key in the merge/widget
- File: app/contexts/FinancialContext/utils/projectionMerger.ts : 35-43
- Why wrong: The comment claims the lookup is keyed by 'sourceId + scheduledDate', but getKey (line 15-16) actually prioritizes occurrenceId and only falls back to sourceId-scheduledDate. Because matching is occurrenceId-first, a date change (reschedule/weekend adjust) still matches, which is the opposite of what the comment implies. This is misleading for anyone auditing the dropped/double-count logic. Separately, in ProjectedVsActualWidget.tsx line 38 'const amount = t.actualAmount ?? t.projectedAmount;' is computed and never used, which can mask the intended fallback semantics for the actual column (lines 49/54 use 't.actualAmount || t.projectedAmount', so a legitimately recorded actualAmount of 0 falls through to projectedAmount).
- Scenario: A reviewer reasoning about whether a rescheduled occurrence double-counts would, per the comment, expect a date change to break the key and produce both a projection and a stored row; in reality occurrenceId keeps them matched. Conversely the dead 'amount' var and the '|| projectedAmount' fallback mean a completed transaction with a true actualAmount of 0 (e.g. a waived bill recorded as 0) is counted as projectedAmount in the actual column instead of 0.
- Suggested fix: Fix the comment to state the key is occurrenceId-first, remove the dead 'amount' variable, and use '?? ' (nullish) instead of '|| ' for the actual-amount fallback so an actualAmount of 0 is respected.
- First-round verification: UNVERIFIED (verifier crashed)

### [F22] (low/edge-case) Installment per-payment amount is not rounded and has no final-payment reconciliation, so displayed/charged installments can sum to more or less than the total
- File: app/components/pages/expenses/components/ExpenseRuleForm/formHelpers.ts : 276-288
- Why wrong: The installment amount is total/count (or totalWithInterest/count) returned at full floating-point precision and stored as installmentConfig.installmentAmount, then every projected installment uses that identical amount with no adjusted final payment (installmentProjections.ts maps every step to installmentConfig.installmentAmount). The raw stored value times count equals the total in exact arithmetic, but once each installment is rounded to currency (2 dp) for display and real-world payment, the rounded installments no longer sum to the total. There is no logic to make the last installment absorb the remainder. The InstallmentDetailsForm 'Monthly Installment' card formats to 2 dp, so the shown number times count drifts from the total.
- Scenario: Total 1,000 over 7 installments. Per-installment = 142.857142...; displayed as 142.86. 142.86 x 7 = 1,000.02 — the customer appears to pay 2 cents more than the purchase price, and no final installment is reduced to reconcile.
- Suggested fix: Round each installment to 2 decimals and set the final installment to total - roundedAmount*(count-1) so the sum exactly equals the total (with interest applied to totalWithInterest). Store and project this reconciled final payment rather than reusing one identical amount for every period.
- First-round verification: UNVERIFIED (verifier crashed)

### [F28] (low/edge-case) CashFlowChart closing balance / change can be sampled from a day before the range end when range > 90 days, due to step skipping never landing on endDate
- File: app/components/pages/dashboard/Dashboard.tsx : 113-129
- Why wrong: When the selected range exceeds 90 days, the loop increments by `step` (>1). Because step does not necessarily divide daysDiff evenly, the final iteration can overshoot `end` and exit without ever pushing the endDate data point. CashFlowChart then derives closingBalance and change from `data[data.length - 1].balance` (CashFlowChart.tsx lines 65-73), so the reported 'Closing' balance and the +/- change badge reflect a sampled interior day rather than the true end-of-range balance. The opening point (data[0]) is always correct, but the headline closing/change figures can be off whenever (daysDiff % step) !== 0.
- Scenario: Range of 100 days (daysDiff=99 from current to end). step = ceil(99/90) = 2. The loop visits days 0,2,4,...,98, then current=100 which is past end and the loop ends — day 99 (the true endDate) is never pushed. The chart's 'Closing' balance and change badge come from day 98's closing balance, not day 99's, misstating the projected end balance.
- Suggested fix: After the loop, ensure the endDate point is included (e.g., if the last pushed date !== end, push a final point for `end` using dailyBalances.get(end)). Alternatively compute opening/closing in CashFlowChart from the true first/last dates rather than the down-sampled array.
- First-round verification: UNVERIFIED (verifier crashed)
