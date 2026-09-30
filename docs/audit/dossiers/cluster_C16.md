# Cluster C16

ProjectedVsActual widget buckets completed by actualDate but projections by scheduledDate

Source files implicated:
- app/components/pages/dashboard/components/ProjectedVsActualWidget.tsx

## Member findings (from first-round analysts)

### [F12] (medium/edge-case) Widget buckets completed transactions by actualDate but projections by scheduledDate, dropping/mis-bucketing late-paid occurrences
- File: app/components/pages/dashboard/components/ProjectedVsActualWidget.tsx : 22-25
- Why wrong: A projection contributes to the period via its scheduledDate, but once completed the same occurrence is filtered by actualDate (which markTransactionCompleteAction sets to data.actualDate, possibly a different month than scheduledDate). The merger matches the completed transaction to its projection by occurrenceId and removes the projection, so the occurrence no longer has a scheduledDate-based entry. If the actualDate falls outside the selected period, the occurrence disappears from that period's projected total entirely; if it lands in an adjacent period, the projected amount moves to the wrong period. The 'projected' baseline for a period should be stable (based on when the occurrence was scheduled), independent of when the user happened to record the payment.
- Scenario: Selected period = June 1-30. Salary income scheduled 2026-06-30, projected 5000. Widget shows Income 0 / 5000. The user records it as received late on 2026-07-02 (actualDate), marks completed. The merger replaces the June projection with the stored transaction (occurrenceId matches). Now actualDate '2026-07-02' > end '2026-06-30', so the row is filtered out of June. June's widget now shows Income 0 / 0 (the projected 5000 vanished). Correct: June projected should remain 5000.
- Suggested fix: Bucket the projected component by scheduledDate and the actual component by actualDate (or consistently bucket everything by scheduledDate for a 'projected for this period vs collected' view), rather than using a single actualDate||scheduledDate key for both halves of the comparison.
- First-round verification: UNVERIFIED (verifier crashed)
