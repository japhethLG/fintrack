# FinTrack fix phase: summary

**Date:** 2026-10-01 · **Branch:** `claude/financial-projections-engine-g5fgkv` · **Starts from:** `92b2c1b` (test baseline)

This closes the fix phase that followed [test-verification.md](test-verification.md). Every fix
was driven by a test that failed first. When a fix landed, its known-defect test turned red and was
converted to a plain test. A passing test was rewritten only with a hand-derived justification,
recorded in the per-stream fix logs:

| Stream | Fix log |
| --- | --- |
| Occurrence engine, identity, merge, date convention | [fixes/engine-dates.md](fixes/engine-dates.md) |
| Loans, cards, installments | [fixes/debt.md](fixes/debt.md) |
| Income/expense forms, editing, preview, validation | [fixes/forms.md](fixes/forms.md) |
| Balance ownership, atomic writes, completion lifecycle, settings | [fixes/write-path.md](fixes/write-path.md) |
| Calendar balances, risk views, health score, totals | [fixes/display-numbers.md](fixes/display-numbers.md) |
| Currency, ingestion guards, error surfacing, account deletion | [fixes/presentation-robustness.md](fixes/presentation-robustness.md) |

The calendar drop target (E2E-CAL-03) was fixed directly in `fcfc7f8`.

---

## 1. Result

| Suite | Before fixes | After |
| --- | --- | --- |
| `npm test` (logic) | 1,566 | **2,023** |
| `npm run test:tz` | 74 | 74 |
| `npm run test:ui` (jsdom) | 637 pass, 30 todo | **719 pass, 16 todo, 0 fail** |
| `npm run test:e2e` (3 timezones) | 513 pass | **513 pass, 0 fail, 0 flaky** |
| `tsc --noEmit` (app/tests/e2e) | clean | clean |

| Known-defect tests still open | Before | After |
| --- | --- | --- |
| Logic `it.fails` | 125 | **10** |
| UI `knownDefect` | 220 | **2** |
| E2E `knownDefect` runs | 139 | **0** |

Every remaining known-defect test was flipped and confirmed to fail on a wrong value (an assertion), not a crash.

---

## 2. Decisions applied

| Question | Decision | Where it landed |
| --- | --- | --- |
| D1: live data | Yes, negligible. One-time rebase. | `write-path` §migration |
| D2: loan `calculationType` | Implement all three | `debt` §calculation types |
| D3: card minimum-payment trap | Re-analyse; fix if a bug. **It was a bug.** Unpaid interest now compounds. | `debt` §D3 |
| D4: weekend adjustment at boundaries | Re-analyse; fix if a bug. **The window edge was a bug**; rule start/end bound the logical date. | `engine-dates` §D4 |
| D5: overdue still-projected rows | Count in the risk views; don't move the realized balance | `display-numbers` §1 |
| "Recalculate Balance" | Fix it, don't hide it | `write-path` |
| Hidden schedule defaults | Follow the entered start date | `forms` |
| Monthly totals | Count occurrences everywhere | `display-numbers` |
| Bill coverage | Exactly 14 days | `display-numbers` |
| Empty account | Neutral "not enough data yet" | `display-numbers` |
| Currency | No hard-coded symbols; default PHP | `presentation-robustness` |
| Firestore rules | Not touched | — |

### Calls made during the fixes

Each is justified in its fix log, and each can be revisited.

- **Daily rules ignore weekend adjustment.** One payment per day, instead of stacking Saturday and Sunday onto Monday.
- **`reducing_balance`** means equal principal plus interest on the remaining balance. Under the other common reading it would be identical to amortized.
- **"Pay Full Balance"** is one payment of the balance with no interest, as on a card's grace period.
- **Override Current Balance** sets `initialBalance = target − Σ completed`. No adjustment row is created, so income and expense totals stay clean.
- **The risk-view horizon is 90 days,** so "90+ days" is honest. It's `RISK_HORIZON_DAYS` if you want it longer.
- **Amounts are rounded to cents when saved.** Amortized payments were being stored with sub-cent tails.
- **Every gesture is one Firestore transaction.** Completing a projection writes a deterministic document `${uid}__${occurrenceId}`, so a retry or a stale second tab updates one row instead of creating two.
- **Delete Account order:** reauthenticate first, then delete the data, then delete the login.

---

## 3. What existing users will see on first login

Two idempotent, versioned migrations run once per user. Both log what they change with `console.info`.

1. **Balance rebase** (`balanceModelVersion`).
   - `initialBalance` is reset to `currentBalance − Σ completed`.
   - The balance the user sees does not change.
   - This repairs profiles the old migration seeded wrongly, and makes "Recalculate Balance" agree with the shown balance.
2. **Loan and installment payment day** (`scheduleModelVersion`).
   - `scheduleConfig.dayOfMonth` is pinned to the start date's day.
   - The old form saved the creation day as a hidden default that the old engine ignored. Without this step, existing loans would move to that day.

Other visible changes:

- **Amounts show cents everywhere**, in the user's currency.
- **Card balances** fall when payments are completed.
- **Loan balances** fall, the instalment stays level, and payment numbers are stable.
- **The calendar's today balance** equals the Dashboard balance. Overdue items are flagged.

---

## 4. Still open

### Known defects (12 tests)

| Test(s) | Defect | Why it's left |
| --- | --- | --- |
| UI-BAL-26/27 | "Start of week" and "date format" preferences do nothing | A small feature, not a fix. Needs a go-ahead. |
| `occurrenceIdGenerator` | A bi-weekly id changes if the rule's start date is edited | Needs a product call on what anchors a pay cycle |
| `loans.test` | `loanConfig.firstPaymentDate` is stored but never read | Reading it would change every loan whose two dates differ. Decide which field is authoritative. |
| `installments+generator` ×2 | Installment interest; bi-weekly installment plans | Feature work, and the interest semantics are a decision |
| `transactionFactory` ×2 | Breakdown edge cases (principal 0; overridden amount) | Rare paths |
| `alertsAndHistory` ×2 | Balance-history snapshot details | Nothing writes snapshots: the feature is inert |
| `migrations` | A stale `variance` survives a legacy reclassification | Legacy-only path |
| `projectedVsActual` | Category percentages aren't scoped per type | Low impact |

### Product decisions parked as todo tests

Each is `it.todo("DECISION: …")` or `test.fixme`:

- **Completion rules:**
  - May a completion be dated in the future?
  - May an actual amount of 0 be recorded (waived or refunded)?
  - Should sub-cent amounts be rounded or rejected?
- **Loans and installments:**
  - Does skipping a payment defer it or forgive it?
  - Does paying a loan on a different date shift the schedule?
  - What is a loan's balance when it's paid early?
  - Is installment "interest" a flat surcharge or an annual rate?
- **Reporting:**
  - Is variance attributed to the scheduled month or the paid month?
  - Does "Total Overdue" include missed income?
- **Rule settings:**
  - What happens to overrides after a rule's frequency changes?
  - Should expense rules offer Daily?
- **Settings:**
  - What does the light theme do?
  - Where should low-balance warnings appear?
  - May the low-balance threshold be negative?
- **Performance:** what's the budget for 200+ rules? The risk walks are now linear, but this hasn't been re-measured.

### Risks and gaps

- **No Firestore security rules in the repo.** The user deferred this. Delete Account's order is now safe under rules that require an authenticated caller.
- **Gestures need a connection.** A gesture made offline now fails with an error instead of queuing, because Firestore transactions require being online.
- **More than about 5 simultaneous writers on one profile** can exhaust the transaction retries. The user sees an error, and nothing is half-applied.
- **Old overdue items stay invisible.** Overdue rows older than the default window (about 2 months back) don't appear in the risk views.
- **Alerts are inert.** `createAlert` is never called, although the spec lists "Overdue Alerts".
- **CI runs none of these suites.** `.github/workflows/deploy.yml` only builds.
