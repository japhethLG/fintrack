# Cluster C12

Bill coverage: off-by-one N+1-day window; same-day paycheck covers same-day bill; cumulative per-bill shortfall mislabels; daysUntilDue key mismatch

Source files implicated:
- app/lib/logic/balanceCalculator/billCoverage.ts

## Member findings (from first-round analysts)

### [F58] (medium/edge-case) Off-by-one: "next N days" window spans N+1 calendar days (today + N inclusive)
- File: app/lib/logic/balanceCalculator/billCoverage.ts : 22-32
- Why wrong: endDate is computed as today + daysAhead, and the filter is inclusive on BOTH ends (date >= todayStr AND date <= endDateStr). That spans today plus daysAhead future days = daysAhead + 1 distinct calendar days. The widget and SPECIFICATION label this 'Next 14 days' / 'Next N days', but the implemented window is 15 days for daysAhead=14. To produce an N-day window starting today, the inclusive upper bound should be addDays(today, daysAhead - 1).
- Scenario: today = 2026-06-01, daysAhead = 14. endDate computes to 2026-06-15. A bill scheduled 2026-06-15 (the 15th calendar day) is INCLUDED in the 'Next 14 days' report even though it falls outside a true 14-day horizon (which should end 2026-06-14). Wrong output: bill on 06-15 counted in totalUpcoming and can flip canCoverAll to false; correct output: that bill excluded from a 14-day window.
- Suggested fix: Use const endDate = addDays(today, daysAhead - 1); so the inclusive [todayStr, endDateStr] range covers exactly daysAhead days, or make the upper bound exclusive (date < endDateStr with endDate = addDays(today, daysAhead)).
- First-round verification: UNVERIFIED (verifier crashed)

### [F59] (medium/logic-error) Same-day paycheck can be credited to cover a same-day bill depending on arbitrary input order
- File: app/lib/logic/balanceCalculator/billCoverage.ts : 35-56
- Why wrong: The comparator orders only by date string. For transactions falling on the SAME date, Array.prototype.sort is stable (ES2019+), so the relative order of a same-day income vs a same-day bill is whatever order they happened to arrive in the input array (Firestore/query order), with no financial rule applied. There is no secondary sort key forcing income before bills (or vice versa). Whether a same-day paycheck is treated as available to cover a same-day bill is therefore non-deterministic and not driven by any intended policy. A coverage predictor should apply a deterministic, conservative rule for same-day ties (e.g., process bills before same-day income, since funds may not clear in time, or at minimum sort deterministically).
- Scenario: currentBalance = 0. On 2026-06-05 there is a bill of 1000 and a salary income of 1500, both dated 2026-06-05. If Firestore returns the income first, runningBalance becomes 1500, then bill -> 500, canCover = true. If it returns the bill first, runningBalance becomes -1000, canCover = false, shortfall = 1000, and the bill is reported 'at risk'. Identical financial data yields opposite coverage verdicts purely based on document ordering.
- Suggested fix: Add a deterministic tie-breaker to the comparator and a defined policy, e.g. on equal dates sort expenses before income (conservative) — return dateA.localeCompare(dateB) || (typeRank(a) - typeRank(b)) where expense ranks before income — or otherwise document and enforce that same-day income is/ isn't available to cover same-day bills.
- First-round verification: UNVERIFIED (verifier crashed)

### [F60] (low/logic-error) Per-bill shortfall and canCover are cumulative, mislabeling cheap affordable bills as 'at risk' with an inflated shortfall
- File: app/lib/logic/balanceCalculator/billCoverage.ts : 54-75
- Why wrong: runningBalance is allowed to carry forward a NEGATIVE value (line 75 sets runningBalance = balanceAfterBill even when negative). Consequently each subsequent bill's canCover and shortfall are computed against the already-negative cumulative balance, not against the user's real ability to pay that individual bill. The per-bill shortfall value equals the cumulative deficit at that point (Math.abs of the running negative), so a tiny bill inherits a large 'shortfall' caused by an earlier large bill. The UpcomingBill.shortfall field reads as 'this bill's shortfall' (and BillItem/widget present it per-bill), but it is actually the running cumulative gap.
- Scenario: currentBalance = 100. Bill1 = 150 on 2026-06-02 -> balanceAfterBill = -50, canCover=false, shortfall=50. Bill2 = 10 on 2026-06-03 -> balanceAfterBill = -60, canCover=false, shortfall=60. Bill2 ($10) is trivially affordable from the original $100 yet is reported 'at risk' with a $60 shortfall. billsAtRisk.length = 2, suggesting two unaffordable bills when only the cumulative budget is short.
- Suggested fix: Decide on intended semantics. If per-bill affordability is wanted, compute canCover/shortfall against a non-negative available balance and/or report the bill's own gap (min(amount, deficit)). If cumulative budgeting is intended, rename/document the field and stop flagging individually-affordable bills as 'at risk', or expose a separate cumulativeShortfall vs perBillShortfall.
- First-round verification: UNVERIFIED (verifier crashed)

### [F61] (low/correctness) daysUntilDue uses scheduledDate while filter/sort key uses actualDate||scheduledDate, allowing negative or inconsistent daysUntilDue
- File: app/lib/logic/balanceCalculator/billCoverage.ts : 27-60
- Why wrong: The in-window filter (line 28) and the sort key (lines 36-37) use t.actualDate || t.scheduledDate, but daysUntilDue (line 59) and firstShortfall.date (line 82) use t.scheduledDate only. For a non-completed transaction that has an actualDate differing from scheduledDate (a rescheduled/manual projected transaction — the project sets actualDate outside completion, see runway.ts/dailyBalance.ts which also branch on actualDate), the transaction can be admitted to the window by its actualDate while daysUntilDue is computed from a scheduledDate that may lie before today, yielding a negative or misleading daysUntilDue, and the bill is also positioned in the running-balance sequence by a different date than the one displayed.
- Scenario: A projected bill with scheduledDate = 2026-05-28 (in the past) but actualDate = 2026-06-03 (rescheduled). With today = 2026-06-01 it passes the filter (date 06-03 within window) and is sequenced at 06-03, but daysUntilDue = ceil((05-28 - 06-01)/day) = -4, so the UI shows 'due 4 days ago' for a bill the engine actually places three days in the future.
- Suggested fix: Use a single consistent effective date everywhere: const effectiveDate = t.actualDate || t.scheduledDate; then base daysUntilDue, the sort, the filter, and firstShortfall.date all on effectiveDate.
- First-round verification: UNVERIFIED (verifier crashed)
