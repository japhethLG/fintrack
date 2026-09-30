# Cluster C10

prorateToDateRange fixed 30-day month over-counts; getMonthlyMultiplier daily=30 inconsistency

Source files implicated:
- app/lib/utils/frequencyUtils.ts

## Member findings (from first-round analysts)

### [F5] (medium/correctness) prorateToDateRange uses a fixed 30-day month and an off-by-one-prone day count, distorting prorated amounts
- File: app/lib/utils/frequencyUtils.ts : 44-54
- Why wrong: Two issues. (1) `new Date(startDate)`/`new Date(endDate)` parse 'YYYY-MM-DD' as UTC midnight; if other call sites in this codebase build dates locally (they do — parseDate is local) the mixing is inconsistent, and DST transitions inside the range make `(end-start)/86400000` a non-integer, so `Math.ceil(...)+1` can over- or under-count by a day. (2) The hardcoded `daysInMonth = 30` means proration of a full real month is wrong: a full 31-day month yields monthlyAmount * 31/30 = 103.3% of the monthly amount, and a 28-day February yields 28/30 = 93.3%. For a 'consistent monthly projection' this systematically over/understates income and expenses by up to ~3.5% per month.
- Scenario: monthlyAmount 3000, prorate over a full January (startDate '2026-01-01', endDate '2026-01-31'). daysDiff = ceil(30 days)+1 = 31. Result = 3000/30 * 31 = 3100 instead of the intended 3000 (a +$100 / +3.3% error for the month). February full month: 3000/30*28 = 2800 (-$200). Correct: prorate against the actual number of days in the spanned month(s), or against 365/12, not a flat 30.
- Suggested fix: Use the actual day count of the spanned month (or 365/12 = 30.4375 average) and parse dates with the same local parser (parseDate) used elsewhere; count days inclusively with a day-granular diff to avoid DST fractional-day rounding.
- First-round verification: 3 votes, 0 refutes

### [F6] (low/correctness) getMonthlyMultiplier uses daily=30 while semi-monthly=2 and weekly/bi-weekly use 52/26 weeks, creating internally inconsistent monthly equivalents
- File: app/lib/utils/frequencyUtils.ts : 16-34
- Why wrong: The multipliers mix conventions. Weekly/bi-weekly correctly annualize (52/12, 26/12). Daily uses 30 (a 30-day month) which implies a 360-day year, inconsistent with the weekly basis (which implies 365.25/7*... per year). A truly daily income would occur ~30.44 times in an average month or 365/12; using 30 understates daily income/expense by ~1.5%. This is a metric-consistency issue rather than a per-occurrence bug, but because Income/Expense/Forecast pages all rely on this helper for 'consistent monthly projections', the daily and weekly figures are computed on different year-length assumptions.
- Scenario: A daily expense of $10 yields a monthly estimate of $300 here, but on a 365-day-year basis (consistent with weekly's 52/12) it should be 10 * 365/12 = $304.17. Over a year this under-projects daily items by ~$50 per $10/day. Correct: 365/12 (~30.44) for daily to match the weekly basis.
- Suggested fix: Use 365/12 (~30.44) for the daily multiplier to match the annualization basis used for weekly (52/12) and bi-weekly (26/12), so all frequencies share one year-length convention.
- First-round verification: 3 votes, 1 refutes

### [F27] (medium/correctness) prorateToDateRange over-counts budgeted income/expenses for any month longer than 30 days (and full quarters)
- File: app/lib/utils/frequencyUtils.ts : 44-54
- Why wrong: Budgeted metrics in Forecast.tsx (lines 255-256) compute a monthly-equivalent amount then prorate it with prorateToDateRange. The proration divides by a fixed 30-day month but multiplies by the actual inclusive day count of the selected range. For a 31-day month the range spans 31 days, so a 'monthly' income (multiplier 1) is scaled by 31/30 ≈ 1.033 — a 3.3% overstatement of budgeted income/expenses for that month. The 'This Quarter' preset (about 91-92 days) is scaled by ~91/30 ≈ 3.03x a monthly amount rather than 3x. The intended behavior (per the 'Budgeted vs Actual' comparison) is that a full calendar month of a monthly source equals exactly one month's amount.
- Scenario: Monthly salary $6,000 (multiplier 1 -> monthlyIncome $6,000). User selects July 1-31 (31 days). prorated = 6000/30 * 31 = $6,200. The Forecast 'Budgeted' income shows $6,200 instead of $6,000, and the budgeted vs actual variance is skewed by $200 every 31-day month. For June (30 days) it is exact; the bug is silent on 30-day months and visible on 31-day months and quarters.
- Suggested fix: Prorate using the actual number of days in the month(s) spanned, or use 365/12 ≈ 30.44 as the average month length, or detect a full-calendar-month range and return monthlyAmount unchanged. Avoid mixing an inclusive actual day count with a fixed 30-day denominator.
- First-round verification: UNVERIFIED (verifier crashed)
