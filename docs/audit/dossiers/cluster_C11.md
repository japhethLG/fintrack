# Cluster C11

Variance report: byCategory omits income; projected totals only count completed -> understated projection

Source files implicated:
- app/lib/logic/balanceCalculator/variance.ts

## Member findings (from first-round analysts)

### [F55] (medium/correctness) calculateVarianceReport byCategory omits all income categories
- File: app/lib/logic/balanceCalculator/variance.ts : 32-56
- Why wrong: The per-category map is populated only inside the `else` (expense) branch, so `byCategory` in the returned VarianceReport never contains any income category rows. The VarianceReport type (types.ts:354-359) defines a generic `byCategory: Array<{category, projected, actual, variance}>` with no indication it is expense-only; a consumer treating it as a full category variance breakdown will be missing every income line (salary, freelance, etc.). The income totals are still aggregated separately, but income variance can never be broken down by category.
- Scenario: Period has completed income: Salary projected 5000 / actual 4800, and Freelance projected 1000 / actual 1500. The report's income.projected=6000, income.actual=6300 are correct, but byCategory contains zero income entries — a UI rendering 'category variance' shows no salary/freelance rows at all, only expense categories. Correct: byCategory should include income categories (or the type/usage should explicitly document it is expense-only).
- Suggested fix: Populate categoryMap for income transactions too (move the category tracking out of the expense-only branch), or rename/document the field as expense-only and add a separate income breakdown if income categories are needed.
- First-round verification: UNVERIFIED (verifier crashed)

### [F56] (medium/logic-error) calculateVarianceReport projected totals only count completed transactions, understating projected for the period
- File: app/lib/logic/balanceCalculator/variance.ts : 19-22
- Why wrong: The report claims to compare 'projected vs actual' for the period {start,end}, and exposes income.projected / expenses.projected. But by filtering to `status === "completed"` FIRST, projectedIncome/projectedExpenses sum only the projected amounts of transactions that happen to be completed. Projected items that are still pending, missed, or were skipped contribute nothing to the projected baseline. So variancePercent only measures amount-overrides on completed items and never reflects under-delivery (a projected bill that was never paid, or income that never arrived). This makes 'projected' here NOT the period's projected total, contradicting the natural reading of a variance report and the spec's 'Actual vs projected tracking'.
- Scenario: Period projects $5000 of expenses across 5 bills of $1000. Only 2 are completed (actuals $1000 each). The report yields projectedExpenses=2000, actualExpenses=2000, expenseVariance=0, variancePercent=0% — implying the user is perfectly on budget, while 3 projected bills ($3000) were dropped from 'projected'. Correct: projectedExpenses for the period should be 5000 (sum of all projected occurrences in range), surfacing the missed/pending bills as variance.
- Suggested fix: Compute projected totals from ALL in-range transactions (projected+completed+skipped as appropriate) and actual totals from completed-only, instead of restricting both numerators/denominators to completed transactions. Decide explicitly how skipped/pending map into projected vs actual.
- First-round verification: UNVERIFIED (verifier crashed)
