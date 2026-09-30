# Fix log: write path, balance ownership, atomicity, completion lifecycle, settings

**Stream:** WRITE PATH, BALANCE OWNERSHIP, ATOMICITY, COMPLETION LIFECYCLE, SETTINGS (R3, R6).
**Base:** `claude/financial-projections-engine-g5fgkv`.
Every expected value in the new tests is hand-derived in a comment or comes from an independent oracle
written in the test; none is computed with app code. Playwright was **not** run (the orchestrator runs E2E
centrally): E2E markers were removed by analysis only.

---

## 1. The design

### 1.1 One owner for the balance (R3)

**The invariant.**

```
users/{uid}.currentBalance  ==  initialBalance + SUM(signed(completed STORED rows))
signed(row) = +amount (income) | -amount (expense),  amount = actualAmount ?? projectedAmount
```

Only STORED rows count. A projection, including an overdue one, has no effect until it is completed
(decision **D5**: overdue items count in the risk views, not in the realized balance).

**Choice: keep `currentBalance` as a cache, with ONE writer family that derives the change from the row's own
before/after state inside a Firestore transaction.** The writers are `ledger.ts` (every gesture on a row) and
`balance.ts` (Recalculate, Override, Update Initial Balance, the rebase). Nothing else writes it.

Why not "derive on read and drop the field":

- Every screen, the calendar, the runway and the AI prompt read `userProfile.currentBalance`, and ~hundreds of
  passing tests seed a profile with a stored balance. Deriving on read is a far larger blast radius for the
  same guarantee, and needs every client to hold ALL rows (the subscription does, but the profile alone is what
  Settings and the dashboard render first).
- The defects it would cure (UI-BAL-42, E2E-ROB-11, ROB-01..03) are cured equally by making the write atomic.

Why not "a single writer that RECOMPUTES from all rows":

- The web SDK cannot run a query inside a transaction. A recompute is a read of N documents outside the
  transaction followed by a write of one number, which is last-writer-wins: writer A (having seen row A) can
  commit after writer B (having seen A and B) and erase B. That is exactly UI-BAL-42 again.

What we do instead, per gesture (`runLedgerTransaction`):

1. inside `runTransaction` read the row, its source (rule / income source) and, only when the balance moves,
   the profile;
2. plan the next row state with a pure function of the row as it is NOW;
3. write the row, the source (debt counters, occurrence override) and `currentBalance` in one commit.

`delta = contribution(after) - contribution(before)`, both read in the transaction. Hence:

| Defect | Why it cannot happen |
| --- | --- |
| UI-BAL-42 two completions in flight lose a delta | Firestore re-runs a transaction whose read documents changed (optimistic concurrency); the second transaction recomputes its delta from the profile the first wrote. The emulator models this (version checks, retries). |
| E2E-ROB-11 stale second tab double-counts | A projection is materialised under the deterministic id `${uid}__${occurrenceId}`. The second tab addresses the same document: it finds the completed row and its change is an UPDATE with delta 0 (same amount) or the difference (different amount). One row, never two payments. |
| E2E-ROB-01/02/03 half-applied writes, duplicate on retry | All writes are one atomic commit: a rejected write leaves nothing; a retry is "create if absent". |
| Manual add/delete/flip/amount edits (UI-BAL-01..04, UI-LIFE-01..03) | There is no per-gesture arithmetic any more: the same subtraction serves every gesture, so these disappear by construction. |

`Recalculate`, `Override` and `Update Initial Balance` read the user's completed rows straight from Firestore
(all of them, never the merged/windowed list that caused UI-BAL-06/07/08 and the wrong "Computed" figure), then
write in a transaction that re-reads the profile and refuses if it moved since the sum was taken (every
completion moves `currentBalance`); the tool then retries (3 attempts).

The Settings "Computed" figure and the mismatch banner use `ledger = { completedCount, sum }` exposed by the
FinancialContext, computed from `storedTransactions` (ALL stored rows).

Trade-off to know: Firestore transactions do not run offline, so a gesture made offline now fails with an error
instead of being queued. The previous flows already depended on a server read (`getDoc`) per gesture.

### 1.2 Override Current Balance: the baseline absorbs it (resolves the DECISION todo)

`initialBalance = target - SUM(signed(completed))`, `currentBalance = target`, in one transaction.

- No transaction row is invented, so income/expense totals, charts and the health score are not polluted and no
  consumer needs a filter for "adjustment" rows.
- The invariant keeps holding, so the mismatch banner never appears after an override and Recalculate cannot
  undo it (UI-BAL-05).
- What changes is the label "Starting Balance (Baseline)", which the warning now explains. An adjustment-entry
  alternative would have touched every total in the app.

### 1.3 One completion path (R6)

`markTransactionCompleteAction` / `Skipped` / `Reschedule` / `Revert` / `Delete` / manual add and edit all resolve
to the same planner in `firestore/transactions.ts` on top of `ledger.ts`. A `proj_` id is first resolved to the
row it would become by REGENERATING the projection from its rule (`resolveOccurrence`): the stored row records
the amortized loan payment, the card's scheduled payment, an amount override and the `paymentBreakdown`, plus
`variance` and `completedAt`. Consequences applied in the same commit:

- **Debt** (contract from `fixes/debt.md`), a pure function of the row (`debtEffectOf`):
  loan `currentBalance -= amountPaid - interestPaid` (whole payment when there is no breakdown) and
  `paymentsMade += 1`; card `currentBalance -=` the same principal; installment `installmentsPaid += 1`.
  Applying a change is `effect(after) - effect(before)`, so re-completing never double-increments and revert,
  skip and delete reverse exactly. Counters clamp at 0. `isActive` follows the plan: a repaid loan / finished
  plan is deactivated, undoing the payment that finished it reactivates it, a rule the user deactivated by hand
  is left alone while unfinished. (Deriving progress from completed payments instead is not feasible: the debt
  stream made `currentBalance`/`paymentsMade` INPUTS of the schedule.)
- **Override cleanup** (only when the `proj_` id carries the occurrence id, as before).
- **Leaving completed** (skip, revert via the modal or the form) removes `actualAmount`, `actualDate`,
  `variance` and `completedAt`.
- **Notes**: only `undefined` leaves a note alone; `""` clears it.
- **Reschedule** of a projection patches only `occurrenceOverrides.<id>.scheduledDate`, so an amount or note
  override survives (UI-LIFE-26, E2E-CAL-01).
- **Revert** keeps a moved date for every frequency: the pattern date comes from the projection engine
  (`occurrenceDates.ts`: generate the rule's projections without that occurrence's override and read the date),
  not from the shape of the id. A never-moved occurrence gets no override (E2E-CAL-04); a stale override that
  would move the regenerated row is unset.
- **Negative actual amounts** are rejected by the dialog schema and by the write path.

### 1.4 Atomicity

- Every multi-document gesture is one `runTransaction`; resets and account deletion use `writeBatch`
  (atomic, at most 500 operations).
- **Reset** (`deleteUserData`): every document is found first (a failing read changes nothing); deletes go out
  children-first (transactions, history, alerts, rules, sources); the balance+baseline reset rides in the LAST
  batch. A usual account is one batch: all or nothing (E2E-ROB-05). If a later batch fails after an earlier one
  committed, `ResetIncompleteError` states "N of M items were deleted, K remain, your balance was not changed";
  the operation is idempotent so running it again finishes it. Resetting Balance History no longer zeroes the
  balance; resetting Transactions sets balance AND baseline to 0.
- **Account deletion** (UI-BAL-23): the login is deleted FIRST (it is the step Firebase refuses:
  `requires-recent-login`), then data and profile in one batch. If that batch then fails the user is told their
  sign-in is gone and their data remains. Residual risk: with real security rules that require an authenticated
  caller, deleting after the login is gone would be denied; rules were not touched (user decision). A
  server-side cleanup on user deletion is the durable fix.
- **Stale modals** (E2E-ROB-07): every open modal is closed when the signed-in uid changes; stored-row actions
  verify `row.userId == acting uid` (`LedgerOwnershipError`); a projection action resolves the source from the
  CURRENT user's lists so it fails with "Source not found"; the auth set-up of a superseded auth event no longer
  subscribes the previous user's profile; the Financial subscriptions drop the previous user's lists when the
  uid changes.

### 1.5 The versioned rebase (decision D1)

`migrateToInitialBalance`, run by `AuthProvider` on login. A profile without `balanceModelVersion`, or without a
numeric `initialBalance`, is rebased once in a transaction:

```
initialBalance = currentBalance - SUM(signed(completed stored rows))      (currentBalance is never touched)
```

and stamped `balanceModelVersion: 1`. The discrepancy the old model had is logged with `console.info`
(`rebased initialBalance for <uid>: 23000 -> 5000 (currentBalance 23000 kept; completed history 18000; the old
model implied 41000, off by 18000)`). Profiles already on version 1 cause no write, two tabs rebase once, other
users' rows are never counted. A profile with no `currentBalance` gets 0. New profiles are created on version 1.
Hand check: legacy 23,000 with +20,000 and -2,000 of history: 23,000 - 18,000 = 5,000.

### 1.6 Schedule migration for legacy loans and installments (orchestrator addition)

The forms stream makes loan and installment payments honour `scheduleConfig.dayOfMonth`. The old expense form
saved the day of creation as a hidden `dayOfMonth` that the old engine ignored, so honouring it would move
existing users' payments to a day they never chose. `migrateLoanInstallmentDayOfMonth` (run by `AuthProvider`
after the rebase) sets, for `cash_loan` and `installment` rules, `scheduleConfig.dayOfMonth` to the day of
`startDate` (local `parseDate`), logging each change with `console.info`. It is versioned by
`UserProfile.scheduleModelVersion` (new profiles are created on 1; fixtures default to 1): the stamp rides in the
same atomic batch as the rule updates, and it is essential, because without it a rerun would overwrite a day the
user chose later. Tests (emulator): a legacy loan started on the 10th with a stored 15 would pay Jan 15, Feb 15,
Mar 15, Apr 15 and pays Jan 10, Feb 10, Mar 10, Apr 10 after migration; a second run writes nothing; a day set
afterwards (25) survives; installments are migrated (missing `scheduleConfig` is created); fixed and card rules
and other users' rules are untouched; a login runs it once.

---

## 2. Defects fixed

| ID | Cause | Fix |
| --- | --- | --- |
| UI-BAL-01/02/03/04, UI-LIFE-01/02/02b/03/03b | Per-gesture balance arithmetic that ignored the add status, the old type and the amount edits | `contribution(after) - contribution(before)` |
| UI-BAL-05 | Override wrote a balance the ledger could not explain | baseline absorbs the override |
| UI-BAL-06/07/08 | Colliding ids (engine stream) + Settings derived from the merged list | ledger from ALL stored rows (precondition of the tests updated: ids are distinct now) |
| UI-BAL-11/12, E2E-JRN-13/14 | Migration seeded `initialBalance` from a balance that already included history | versioned rebase |
| UI-BAL-14/15/16 | Wipe kept `initialBalance`; Balance History reset zeroed the balance | reset balance+baseline with transactions; history reset leaves it |
| UI-BAL-20/21/22, UI-OBS-04/05 | Counts from the merged list; history hard-coded 0 | counts from stored rows; real history count |
| UI-BAL-23 | Data deleted before the login | login first |
| UI-BAL-24/25, UI-OBS-03 | `\|\| 500` | `?? 500`, NaN-only fallback |
| UI-BAL-34 | float residue (0.3 - 0.1 - 0.2) | `cleanMoney` on every cache write |
| UI-BAL-41 | whitespace-only name passed validation | `yup.string().trim().required()` |
| UI-BAL-42, E2E-ROB-11 | read-modify-write outside a transaction; duplicate rows | transactions + deterministic ids |
| UI-BAL-45 | "1 transactions" | singular/plural |
| UI-BAL-46 | profile updates reset the Preferences form | reset keyed on the stored preferences, `keepDirtyValues` |
| UI-BAL-47 | `preferences.defaultWarningThreshold` dereferenced unguarded | optional chaining (context hook, calendar) |
| UI-LIFE-04/04b/05 | skip/revert kept `actualAmount`/`actualDate` | removed when leaving completed |
| UI-LIFE-06/06b | Edit form sent every field (actual amount as projected, reset date) | edit sends only changed fields |
| UI-LIFE-07, lifecycle "variance on first completion" | projection path stored no variance | variance on every completion |
| UI-LIFE-08/08b, firestore "empty note clears" | `notes \|\| old` / `undefined` dropped | `undefined` leaves, `""` clears |
| UI-LIFE-09 | negative actual accepted | rejected (schema + write path) |
| UI-LIFE-10/10b/13/14/14b/15, UI-DISP-39, E2E-JRN-16, lifecycle "reduces the outstanding balance" / "remaining payments keep their amount" | projection path took `rule.amount`, no breakdown, no principal | regenerate the projection; principal = paid - interest |
| UI-LIFE-18/19/22/22b/23/24 | unconditional counter increments; skip did not roll back; plan not reactivated | `effect(after) - effect(before)`, `isActive` follows the plan |
| UI-LIFE-20/21, E2E-JRN-17 | no card branch | card balance reduced |
| UI-LIFE-25/25b/26, E2E-CAL-01/02/04 | id-shape date reconstruction; overrides replaced | engine pattern date; dotted patch |
| E2E-ROB-01/02/03/05/07/11 | sequential writes, sequential deletes, no session guard | see 1.4 |
| firestore/integration (it.fails) | see the commit; 25 converted | |
| DEFECTS.md 9-15 | | marked FIXED |

Also fixed (not in the list): `getTransactions` applied `limit` before the client-side status filter;
`deleteTransactionsBySource` was capped by the 500 limit; `createUserProfile` was not create-if-absent;
`migratePendingToOverrides` wrote `notes: undefined` (real Firestore rejects it); `removeUndefined` was shallow;
`syncComputedBalance`/`computeBalanceFromTransactions` produced float noise so the reconciliation report invented
drift; the Selective Reset / Danger Zone copy no longer says Balance History resets the balance.

---

## 3. Fakes: what changed and why they are faithful

`tests/helpers/firestoreEmulator.ts` (vitest) was more lenient than Firestore in three ways that matter here:

- `writeBatch` was not atomic and silently ignored `update` of a missing document. It now validates every
  queued write first (injected faults, update of a missing doc, `undefined` values, more than 500 writes) and
  applies nothing if any fails: what the server does.
- There was no `runTransaction`. It is now optimistic like the client SDK: reads record a per-document version,
  writes are buffered, at commit the versions are re-checked and a changed read retries the callback (max 5,
  then `aborted`); reads after a write reject.
- `undefined` field values were accepted; the real SDK rejects them (`ignoreUndefinedProperties` is off). The
  emulator now rejects them (the e2e fake already did).
- Test hook `__injectFault({ collection, times, error })`: the next matching commit rejects before anything is
  applied (a server-side rejection; "applied but the ack was lost" stays unmodelled, as before).

`e2e/fakes/firebase-firestore.ts` already had atomic batches, `increment` and the 500 limit. It gains
`runTransaction` with the same contract (structural signature of each read document re-checked at commit, so a
change made by another tab is seen). Fixtures: both `makeUserProfile` builders default
`balanceModelVersion: 1` (fixtures are already on the current model; the legacy-migration tests override it).

---

## 4. Passing tests rewritten (each has a derivation in its comment)

| Test | Why the old expectation was wrong |
| --- | --- |
| `entityCrud` "strips only TOP-LEVEL undefined..." | Pinned a write real Firestore rejects; the emulator now rejects it and `removeUndefined` is deep. |
| `actualMutation.actions` "does not deactivate an installment rule on its final payment" | Pinned the projection path's difference from the stored path. Both now deactivate a finished plan (stored-path test, reactivation-on-revert test). 5 of 6 + 1 = 6 of 6. |
| `actualMutation.actions` "reduces the loan balance the same way..." (fixture) | The rule's first payment moved to 2026-03-01 so the projection being completed exists (interest 12,000 x 1% = 120, principal 565 - 120 = 445, like the stored row). |
| `actualMutation.firestore` re-completion "two balance adjustments" and "reverses the projected amount..." | Pinned two sequential writes `[1_000, 750]` (a visible half-applied state). One atomic commit writes `[750]`: 1_000 - 250. |
| `actualMutation.firestore` skip "leaves the stale actualAmount and variance" | Pinned UI-LIFE-04/05. Skip drops them. |
| `actualMutation.firestore` skip "does not roll back loan counters" | Pinned the permanent phantom payment. Completing 565 (breakdown 165 interest) applied 1 payment and 400 principal; skipping reverses both: 0 and 12_000. |
| `lifecycle` "records the first payment and displaces its projection" | `paymentBreakdown` was asserted undefined. The row now carries payment #1 of 6, interest 6000 x 1% = 60.00, principal 975.29. |
| `lifecycle` "advances paymentsMade but leaves the outstanding loan balance untouched" | Now reduced: 6000 - 975.29 = 5024.71. |
| `reconciliation` (2 tests) | Produced drift with `removeTransactionAction`, which now reverses the balance. They use the plain `deleteTransaction` (document removed, balance untouched); the arithmetic is unchanged. |
| `migrations` "resets the balance when balance history is deleted" | User decision: a Balance History reset must not zero the balance. Now asserts it is left alone; a new test pins balance and baseline 0 for transactions. |
| `auth-lifecycle` "the migration writes exactly once (initialBalance + updatedAt)" | The one write also stamps `balanceModelVersion` (D1 "versioned"). |
| `invariant` "Override ... leaves the ledger untouched" | `initialBalance` 10,000 after overriding to 12,345.67 is the broken invariant (UI-BAL-05). With no history the baseline becomes 12,345.67; no transaction is invented. |
| `invariant` UI-BAL-06/07/08 precondition | Asserted two rows sharing an occurrence id. The engine stream made ids distinct (`inc-1_2026-03-1`, `-2`: slots of [15, 30]). |
| `reset-and-delete` "ticking only 'X'" | Expected `initialBalance` 10,000 for every collection; for Transactions that is the orphaned baseline (UI-BAL-14): 0 there. |
| `reset-and-delete` "Recalculate after a Transactions reset (documents the resurrection)" | Pinned the defect. Balance and baseline are both 0, so no banner; recalculating yields 0. |
| `reset-and-delete` UI-BAL-18/19 regexes | The copy no longer says Balance History resets the balance; the (still open, currency) defect tests match the new sentence. |
| `settings-misc` "a failed balance write is reported" | The override is a transaction, not `updateDoc`; the rejection is injected at the store. Same behaviour asserted. |
| e2e `E2E-CAL-04` | `toBeUndefined()` cannot hold for a rule seeded with `occurrenceOverrides: {}` (deleteField leaves the empty map); asserts "no entries". Not run. |

---

## 5. Known-defect status (measured on the tree merged with the forms stream)

| | Base 3026029 | After |
| --- | --- | --- |
| `it.fails` (unit, integration, timezone) | 72 | 39 |
| `knownDefect(` UI | 178 | 63 |
| `knownDefect(` E2E (not run) | 29 | 14 |

(The forms stream's conversions are included in the "After" figures.) Not run: Playwright (markers removed for
E2E-JRN-13/14/16/17, ROB-01/02/03/05/07/11, CAL-01/02/04).

## 6. Leftovers and risks

- **Calendar pre-window balance** (UI-BAL-35/36, UI-DISP-01..09, E2E-JRN-11/12) and UI-BAL-40 (empty calendar)
  live in `calculateDailyBalances`/`useDailyBalances`: the opening balance undoes completed rows in the window
  and never re-applies older ones. Not touched (display/risk stream). The correct opening is
  `currentBalance - SUM(completed dated >= window start)`.
- `balanceHistory.ts` (nothing writes snapshots): two `it.fails` remain (stale `createdAt` on update, overlapping
  saves). A deterministic `${uid}_${date}` id fixes both.
- Currency symbols in Settings / Danger Zone copy: Phase 3.
- Legacy rule rows stored with `status: "projected"` are deleted by a Transactions reset but not counted (the
  subscription does not load them).
- Deleting a stored completed rule row that clamped a loan balance at 0 restores the un-clamped principal.
- A completion race beyond ~5 simultaneous writers on one profile can hit the Firestore 5-attempt limit
  (error shown, nothing half-applied).
- `updateLoanBalance` / `updateInstallmentProgress` / `adjustUserBalance` remain exported and tested but the
  gestures no longer call them.
