# FinTrack: integration and E2E verification

**Date:** 2026-09-30 · **Branch:** `claude/financial-projections-engine-g5fgkv` · **Production code changed:** none

This pass did not trust `HANDOFF.md`, `tests/DEFECTS.md`, `docs/audit/finance-logic-audit.md` or
`docs/audit/correctness-review.md`. Their claims were treated as hypotheses. Each one in scope was
either reproduced through the real UI (jsdom) or in a real browser (Playwright), or refuted. Bugs
found independently are listed separately. Every row below names the test that proves it.
Expected values in tests are hand-derived, never computed with app code.

---

## 1. What exists now and how to run it

| Suite | Command | What it exercises | Result |
| --- | --- | --- | --- |
| Logic (pre-existing) | `npm test` / `npm run test:tz` | `app/lib/logic/**`, firestore modules | 1,566 + 74 pass, unchanged |
| **UI integration (new)** | `npm run test:ui` | Real `<Providers>` + real pages in jsdom against the in-memory Firestore | **637 pass, 30 todo, 0 fail** |
| **E2E (new)** | `npm run test:e2e` | Static production export in Chromium × 3 timezones (UTC, Asia/Manila, America/New_York) | **513 pass, 9 skipped (decision fixmes), 0 fail, 0 flaky** |

Flip checks (known-defect tests run as ordinary tests; each must fail on a wrong value, not a crash):

- `npm run test:ui:flip`: 220 failures, **all `AssertionError`**.
- `npm run test:e2e:flip`: 142 failures = exactly the 142 known-defect runs (139 defect runs + 3 harness self-tests). The classifier reports 138 `mismatch` and 4 `missing-element`. The 4 are E2E-JRN-05/06/07, whose assertion is "the correct text is visible". The same selector passes in UTC, so the absent text *is* the defect.

### No real backend is ever contacted

Org policy forbids database connections, and `.env.local` holds real Firebase keys.

- **UI suite:** mocks `app/lib/firebase/config`, `firebase/*`, Gemini and ImgBB. It also blocks `fetch`, XHR, WebSocket and non-loopback sockets, and fails any test that attempts one.
- **E2E build:** `FINTRACK_E2E=1` aliases `firebase/*`, Gemini and ImgBB to in-browser fakes. It injects dummy `NEXT_PUBLIC_*` keys and builds into `.next-e2e/`. `e2e/scripts/serve.mjs` refuses to serve a build containing any real Firebase or Google endpoint or key.
- **E2E runtime:** a fixture aborts every non-localhost request and fails the test.
- **Flag unset:** `next.config.js` is byte-for-byte equivalent to before.

Details: `tests/ui/README.md`, `e2e/README.md`.

### Layout

```
tests/ui/harness/   renderApp, auth fake, network guard, money parser, knownDefect
tests/ui/{balance,rules,lifecycle,display}/   UI-BAL / UI-RULE / UI-LIFE / UI-DISP tests
tests/ui/observed.test.tsx                    UI-OBS
e2e/fakes/          browser Firebase/Gemini/ImgBB fakes      e2e/helpers/  seeding, clock, flows
e2e/specs/{journeys,calendar,robustness}/     E2E-JRN / E2E-CAL, E2E-TXN / E2E-ROB
```

Known defects use `knownDefect("<ID>", …)`: the test asserts the **correct** behaviour and is marked expected-to-fail. **When a fix lands, its tests turn red. Delete the marker; don't "fix" the test.** Genuine product decisions are `it.todo("DECISION: …")` / `test.fixme(true, "DECISION: …")`.

---

## 2. Doc claims: verdicts

### Confirmed in the running app

| Claim (source) | Evidence (observed vs correct) | Tests |
| --- | --- | --- |
| "Recalculate Balance" writes a wrong balance when two stored rows share an `occurrenceId` (review N-1A) | Semi-monthly [15,30] "after", March paid: stored 93,000, Settings computes 68,000, Recalculate writes 68,000 | UI-BAL-06/07/08, UI-LIFE-27/28/29 |
| Legacy-profile migration seeds `initialBalance` from a balance that already includes history, so Recalculate inflates (N-1B) | Legacy 18,200 with history: banner "mismatch $16,200", Recalculate writes 34,400 | UI-BAL-11/12, E2E-JRN-13/14 |
| Calendar/daily balance loses completed history older than the view window (C6) | 9 months history, true 18,200: Calendar today closing 7,400 | UI-BAL-35, UI-DISP-01…09, E2E-JRN-11/12 |
| Loan payments never reduce `loanConfig.currentBalance`; EMI inflates; payments vanish (N-6) | 8,000 @ 12%: EMI 1,045.52 → 1,189.03 → 1,380.39 → 1,648.32, progress 0%, 4 remaining payments disappear | UI-LIFE-10…15, UI-DISP-38/39, E2E-JRN-15/15b/16 |
| Loan `paymentNumber` depends on the calendar viewport | Nov 10 payment prints #1 or #2 depending on paging | UI-LIFE-16/17 |
| Card payments never reduce the card balance | 0% card 1,000 paid 400 twice → Total Debt still 1,000 | UI-LIFE-20/21, E2E-JRN-17 |
| Re-completing an installment increments `installmentsPaid` again; skipping a completed one leaves the counter | 2 instead of 1; a future payment disappears | UI-LIFE-18/22/23 |
| Editing a loan/installment rule resets progress (N-8) | `paymentsMade` 5 → 0, paid payments reappear | UI-RULE-56…59 |
| Blank optional card fields persist `NaN` (N-9) | Amount NaN, detail card "NaN%" | UI-RULE-42…45 |
| Quarterly expense rules persist `scheduleConfig {}` and move to the 1st (N-3) | Start Jan 5: January bills $0 instead of $300 | UI-RULE-27/70 |
| Schedule preview shows dates the engine never generates | Weekly preview on Mondays, engine bills Fridays; quarterly from Jan 31 previews May 1 | UI-RULE-01/02/07/08/23/28 |
| Manual type flip / add-as-completed / delete corrupt the balance (MUT-4/5) | Flip 100 expense → income: 9,900 vs 10,100; add completed then delete: +2× drift | UI-BAL-01…04, UI-LIFE-01…03 |
| Reschedule discards other overrides | A drag drops amount and notes overrides | UI-LIFE-26, E2E-CAL-01 |
| Daily + weekend adjustment stacks Sat/Sun/Mon on one day with one id | Mon 3/16 carries 3 payments with identical ids and React keys | UI-RULE-12/13, E2E-CAL-05/06/12 |
| Occurrence id from the weekend-adjusted date collides (C2) | Semi-monthly [15,30] "after": both March paydays `semi_2026-03-2`; one drag moves both | E2E-CAL-08/09/10/11 |
| Runway double-counts completed-today rows | Balance 100 after paying 200 today → "0 days, crunch today" | UI-DISP-33 |
| Health score: zero-income masking, trend sign inversion, overdue bills excluded | Recovering −2,000 → −500 scores 2/100; worsening scores 100 | UI-DISP-29…32, 35 |
| Timezone date bugs (defect 24 / C1b) | New York: lists, upcoming widgets, chart labels and Period Comparison one day early; `balanceLastUpdatedAt` UTC-dated | UI-BAL-09/10/13, UI-DISP-40…43, E2E-JRN-01…10, E2E-TXN-01…03 |
| Negative `intervalWeeks` freezes the tab (N-4) | Page never renders, renderer unresponsive | E2E-ROB-08 |
| Cents rounded off signed amounts; negative zero; ragged decimals (F29/F30/F31) | "+$1,235" for 1,234.56; "-$0.00" + "Negative balance!" | UI-BAL-31/34/38/39, UI-DISP-21/22 |
| Prorating by a 30-day month skews Budgeted vs Actual | $3,000 salary budgeted $3,100 in January | UI-OBS-01 |
| Empty account scores Health 93/A, "90+ days runway" | Brand-new user with balance 0 | E2E-ROB (DECISION fixme), UI-DISP todo |

### Refuted or corrected

| Claim | Finding | Tests |
| --- | --- | --- |
| Migration "double-counts on every login" (HANDOFF §6) | Runs **once**; re-logins add zero writes. The double-count is real; the trigger description is wrong | UI-BAL auth-lifecycle |
| Yearly expense rules have the quarterly `{}` bug | Engine falls back to start month/day; yearly bills correctly | UI-RULE expense.forms |
| January `monthOfYear` (0) treated as absent | Works in UTC; only breaks via the New York save bug (UI-RULE-10/11) | UI-RULE income.forms |
| Deleting a rule loses its completed transactions / balance | Both preserved | UI-RULE rules.edit |
| Complete → revert → complete erodes loans/cards/installments | Idempotent for balance, counters and rows | UI-LIFE debt |
| Double-clicking "Mark Complete" double-counts | One stored row, one balance move | E2E-CAL menus-modals |
| Ancient daily rule (2015) is a performance problem | Capped at 500 occurrences; pages load promptly | E2E-ROB malformed-data |
| Month-start payday dropped when navigating the calendar in Manila | Drawn correctly in all three zones; balances chain Jan→Aug and across the year boundary | E2E-CAL navigation |
| Calendar grid shifts a day in New York | Grid cells, month totals and today marker are correct; the shift is in list/label widgets only | E2E-JRN timezones |
| "Revert loses the custom date" (all frequencies) | Monthly and daily keep it; weekly and bi-weekly lose it | UI-LIFE-25/25b, E2E-CAL-02 |
| Delete of a completed rule-based row skips reversal (MUT-7) | Not reachable: the UI offers Delete only for manual rows | UI-BAL reset-and-delete |
| Forecast $17,000 vs Expenses $18,200 Total Debt (harness observation) | Expenses is right; Forecast omits installments | UI-DISP-06, E2E-JRN-18 |

---

## 3. New defects (in none of the prior docs)

Severity is a judgement: **Critical** corrupts stored money or loses data; **High** shows wrong
money or breaks a core flow; **Medium** shows misleading figures or accepts bad input;
**Low** is cosmetic.

### Critical

- **Failed writes leave money half-applied.**
  - Completing a projection whose balance write fails stores the transaction but leaves the balance unchanged (E2E-ROB-01).
  - Retrying then stores a second completed row, so drift is permanent (ROB-02).
  - Stored-row edits adjust the balance *before* the document write, so a rejected write still moves the balance (ROB-03).
- **A failed reset deletes part of the data.** Income sources and rules are gone when the transactions delete fails (E2E-ROB-05).
- **A stale modal survives a user switch.** Completing it as the second user changes their balance and rewrites the first user's transaction (E2E-ROB-07).
- **Concurrent completions lose or double updates.** Two in flight at once lose one balance delta (UI-BAL-42). Completing the same occurrence from a stale second tab double-counts (E2E-ROB-11).
- **Account deletion is not atomic.** If Firebase refuses to delete the auth user, their data is already gone while they stay signed in (UI-BAL-23).
- **A profile without `preferences` crashes the whole app** once any transaction exists (UI-BAL-47).

### High

- **The Complete dialog accepts a negative actual amount.** Completing a 100 expense with −50 *credits* the balance (UI-LIFE-09).
- **Reverting or skipping a completed row keeps its `actualAmount`/`actualDate`.** A projected 100 row prints −$120 (UI-LIFE-04/05).
- **Saving only a note on a completed row overwrites `projectedAmount`** and resets `actualDate` (UI-LIFE-06/06b).
- **Monthly and weekly rules ignore the entered first-payment date.** `dayOfMonth`/`dayOfWeek` default to *today*, so entering Mar 5 bills Mar 15 (UI-RULE-19/21). Loan and installment Day-of-Month inputs are ignored too (UI-RULE-35/53).
- **Editing only the amount of a quarterly expense moves it to the 1st.** A legacy weekly rule moves to Sundays (UI-RULE-63/64). Editing a deactivated rule reactivates it (UI-RULE-61/62).
- **"Pay Full Balance" on a card emits a second, interest-only bill** (UI-RULE-41).
- **The calendar drop target is chosen from the overlay, not the pointer.** Releasing over Fri 3/20 files the item under Sat 3/21 (E2E-CAL-03).
- **Monthly-on-the-1st with "before" completes the wrong item.** Paying 7/31, which is Aug 1's payday moved earlier, stores July's id. July's closing figure also depends on whether August was visited first (E2E-CAL-07/07b/11).
- **New York: month-end items and Closing vanish** from the June–August calendar (E2E-CAL-13). A Jun 30 payday is missing (UI-DISP-43), and the Transactions count drops the window's last day (E2E-JRN-05).
- **A rule with a `null` amount crashes the Calendar;** a non-numeric amount prints NaN on five screens (E2E-ROB-09/10).
- **Failed rule deletes, deactivations and single-step expense creates show no error** (E2E-ROB-04/06).
- **The calendar's balance for today changes after browsing back a month** (the window only grows) (UI-BAL-36).
- **Calendar cells drop the minus sign on negative balances:** "$500" for −$500 (UI-BAL-37, UI-DISP-13, E2E-JRN-20).

### Medium

- **Validation shows errors but still saves:**
  - loan term 0 → `Infinity` (UI-RULE-39/40);
  - installment count 0 → `Infinity` (UI-RULE-54/55);
  - min % above 100 and due date 32 (UI-RULE-49/50);
  - end date before start date (UI-RULE-15/29);
  - semi-monthly with no dates (UI-RULE-05/25).
- **Ended income sources, paid-off installments and settled cards still count** in monthly recurring totals and "Active" (UI-DISP-25…28, UI-RULE-68/69).
- **The "today" date disagrees between screens:**
  - The Transactions "Overdue" card uses UTC while the Dashboard alert uses local time (E2E-JRN-09, E2E-TXN-02).
  - Add Income/Expense/Transaction default dates are UTC (E2E-JRN-10, E2E-TXN-03, UI-OBS-08, UI-RULE-16/30).
  - A bill due today counts as Overdue in New York (UI-LIFE-32).
- **Low-balance threshold 0 is stored and shown as 500;** changing only the theme rewrites it (UI-OBS-03, UI-BAL-24/25).
- **Selective Reset counts are wrong:** projections are counted as deletable, and Balance History is a hard-coded 0 (UI-OBS-04/05, UI-BAL-20…22).
- **Any profile update discards unsaved Preferences edits** (UI-BAL-46).
- **The AI prompt's "Upcoming (next 30 days)" includes overdue rows** (E2E-ROB-12).
- **Installments starting Jan 31 drift to the 28th** (UI-RULE-52).
- **A note cannot be cleared** (UI-LIFE-08/08b, UI-RULE edit).

### Low

- **Hard-coded `₱`/`$` for other currencies:**
  - Settings inputs and reset copy (UI-OBS-02, UI-BAL-17…19, 32/33);
  - the calendar sidebar (E2E-JRN-19, UI-DISP-12).
- **EUR/CAD/INR balances print differently on Settings and Dashboard** (UI-BAL-28…30).
- **Inconsistent decimals:**
  - "$564.882" (3 decimals) and "$138.4" (UI-DISP-10/11);
  - "₱8,662.5" (E2E-JRN-21);
  - Y-axis "$10000000k" (UI-DISP-17/18).
- **Label and wording errors:**
  - ordinal chips "1th"/"22th" (UI-RULE-04/24);
  - "Computed from 1 transactions" (UI-BAL-45);
  - Forecast "Next 30 Days" subtitle says "this month" (UI-DISP-36).
- **Radix "Missing Description" accessibility warning** on every dialog (UI-OBS-06).

---

## 4. Decisions still needed (tests are parked as todo/fixme until answered)

These carry over from `correctness-review.md` §6 and are **still unanswered**:

- **D1:** is there live production data?
- **D2:** loan `calculationType`.
- **D3:** credit-card minimum-payment trap.
- **D4:** weekend adjustment at a rule boundary.
- **D5:** does an overdue still-projected bill affect today's balance?

New ones raised by testing (30 UI todos, 3 E2E fixmes):

- **Monthly totals:** 52/12 averages or actual occurrence counts.
- **Bill coverage window:** 14 or 15 days. The spec says "Next 14 days", and the app shows today+14 inclusive.
- **ProjectedVsActual bucketing:** by scheduled or actual month.
- **Hidden schedule defaults:** today or start date.
- **Keyboard rescheduling:** no `KeyboardSensor` is registered.
- **Empty-account health score.**
- **Performance budget** for 200+ rules: Dashboard takes 4–11 s to load.

---

## 5. Limits of this pass

- **The in-memory fakes don't enforce everything real Firestore does.** They do not enforce composite indexes or security rules, and they cannot model "applied server-side, ack lost". The real double-count risk behind E2E-ROB-02 is likely larger than shown.
- **Still true: no `firestore.rules` exist in the repo.** E2E-ROB's malformed-data tests show why that matters: any document shape reaches the client.
- **Not tested:**
  - real Google sign-in;
  - image upload;
  - dirty-state handling when closing modals, beyond Escape;
  - read-fault paths.
- **CI doesn't run any of these suites yet.** `.github/workflows/deploy.yml` only builds, and a plain `npm run build` may fail type-checking on `remotion/` (unconfirmed).
- **Runtimes on a 4-core machine:**
  - `test:ui`: about 10 minutes;
  - `test:e2e`: about 21 minutes at 2 workers.
