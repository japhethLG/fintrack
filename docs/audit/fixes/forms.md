# Fix log: income-source and expense-rule forms, editing, schedule preview, validation

**Stream:** INCOME SOURCE AND EXPENSE RULE FORMS, EDITING, SCHEDULE PREVIEW, VALIDATION
**Base:** `claude/financial-projections-engine-g5fgkv` (3026029, after the engine/dates and debt streams)
**Not touched by design:** `transactionActions.ts`, `app/lib/firebase/**`, `AuthContext`, settings, modals, the Manager
summary cards' totals, `occurrenceCalculator.ts` (no change needed), `.github/`, Firestore rules, `.env*`.

Every expected value in the new tests is hand-derived from the 2026 calendar (Jan 1 Thu, Feb 1 Sun, Mar 1 Sun, Apr 1 Wed,
May 1 Fri), never computed with app code. No test was deleted or loosened; changed expectations are listed in section 6.

IDs are the test-file IDs (`tests/ui/rules/*`). The task brief numbers a few of the edit tests one lower than the test
files do (the files have UI-RULE-60/61 for deactivated rules, 62 for the quarterly edit that the engine stream had already
fixed, 63 for the legacy weekly edit, 64/65 for the end date, 66 for notes).

---

## 1. What changed, by area

### One shared schedule module: `app/lib/logic/ruleSchedule.ts`

| Function | What it does |
| --- | --- |
| `buildScheduleConfig` | The ONE builder both wizards use, for every frequency. Only the keys a frequency reads are written; every number is a number. |
| `validateSchedule` | end date before start, semi-monthly with no days, day of month outside 1-31, blank start date |
| `getSchedulePreview` | the Schedule Preview: calls `calculateOccurrencesDetailed` itself |
| `describeSchedule` | the detail cards' "Every Friday / On the 15th of each month" text (missing values are read the way the engine reads them: from the start date) |
| `ordinal`, `toWholeNumber`, `startDateParts`, `cleanSpecificDays` | helpers |

`buildScheduleConfig` output by frequency:

| frequency | persisted `scheduleConfig` |
| --- | --- |
| one-time, daily | `{}` (no stray `dayOfMonth`, UI-RULE-22) |
| weekly | `{ dayOfWeek }` |
| bi-weekly | `{ dayOfWeek, intervalWeeks }` (2 unless a stored interval is carried through an edit) |
| semi-monthly | `{ specificDays }` (sorted, unique, 1-31) |
| monthly | `{ dayOfMonth }` |
| quarterly, yearly | `{ dayOfMonth, monthOfYear }` (the expense form used to write `{}` here) |

The expense form now saves the EFFECTIVE frequency (`getEffectiveFrequency`): "one-time" for a one-time expense, "monthly" for a
loan, card or installment plan, whatever the `frequency` field last held. That is what removed the stray `dayOfMonth` on
one-time rules (the config used to be built from the still-"monthly" form value).

### The hidden-defaults DECISION (resolved)

`dayOfMonth`, `dayOfWeek` (and the loan/installment Day of Month, and the month of a yearly rule) default to the ENTERED START
DATE, never today.

- **Create:** the form's `dayOfMonth` / `dayOfWeek` start as the start date's day / weekday. A separate picker (`useFollowStartDate`,
  `app/lib/hooks`) keeps the value in step with the start date until the user changes it: "changed" means the field no longer
  holds the value the hook last derived. From then on the field is the user's and the start date never overwrites it. (Typing the
  same number the hook derived is indistinguishable and keeps following; that is the one, harmless, edge.)
- **Quarterly / yearly:** no picker; the day and month come from the start date at save time.
- **Edit:** a value the stored rule HAS is explicit (it never follows the start date); a value it lacks (a legacy rule) is derived
  from the start date, which is exactly how the engine reads a rule without it. So an amount-only edit of a legacy weekly rule
  keeps its effective weekday and writes it down explicitly.
- Tests: the `it.todo("DECISION: hidden defaults ...")` became the describe blocks "hidden schedule values default from the start
  date (decision)" in `income.forms` and `expense.forms`.

### Schedule Preview uses the real engine (`SchedulePreview.tsx`)

The 100-line re-implementation (manual stepping, `setMonth`, `new Date(str)`) is gone. The component receives the `scheduleConfig`
the form will SAVE (`buildScheduleConfig(values)`), so the preview is the saved rule by construction.

- Window: `[start - 2 days, end + 2 days]`, or `[start - 2 days, start + 3 months]` without an end date. The 2 days are the maximum weekend
  shift: a "pay before" first payment can land ahead of the start date (Sun Mar 1 -> Fri Feb 27) and a "pay after" last one past the end
  date (Sat Feb 21 -> Mon Feb 23); both are what gets generated (D4), so both are shown.
- The horizon stays 3 months (an end date replaces it). It is now stated on the card ("The first 3 months from the start date ...").
- Cards: 8 are drawn, the rest counted in "+N more occurrences" where N is the real count. The old preview stopped at 12, so it
  printed "+4 more" when 5 existed.
- A loan or installment plan previews at most as many dates as it has payments (`maxOccurrences`: the term / the count).
- Daily + weekend adjustment: the engine ignores adjustment for daily rules (engine-dates section 4), so the preview has no duplicate
  cards (UI-RULE-13). The weekend control stays visible for daily rules (existing tests drive it); a line under it says it has no
  effect for daily schedules.

### Debt schedule: Day of Month plumbing (`projectionEngine/dateUtils.ts`, `loanProjections.ts`, `installmentProjections.ts`)

`monthlyPaymentDate(anchor, dayOfMonth, i)`: with a usable Day of Month the i-th payment falls on that day of each month, clamped per
month from the FIXED day (Jan 31, Feb 28, Mar 31), first payment in the start month or, if that day has passed, the next month
(start Feb 10, day 5: Mar 5). Without one it is `addMonths(anchor, i)` exactly as before, so a rule with no `dayOfMonth`, or one equal to
the start day, is unchanged. The credit-card generator already worked this way (due day). Tests: `tests/unit/projectionEngine/monthlyPaymentDate.test.ts`.
Fixes UI-RULE-35 (preview and projection agreed), 36 ("On the 10th", not today's 15th), 53.

### Validation that blocks save

One list, `collectExpenseIssues` / `collectIncomeIssues`: the schedule's problems (`validateSchedule`) plus the field-level ones (the yup
schema, run with `validateSync`). While the list is non-empty, **Continue on the Schedule step and the final Create / Save are
disabled** and a `role="alert"` box lists the reasons. `handleSubmit` re-checks, so nothing saves around the button. Enter inside an
input no longer saves from an early step (the `<form>` only submits on the last step).

| Rule | Message | IDs |
| --- | --- | --- |
| loan term not a whole number >= 1 | Term must be a whole number of months, at least 1 | 39 |
| negative loan rate / card APR | Interest rate cannot be negative | 40 |
| negative loan current balance | Current balance cannot be negative | |
| installment count not a whole number >= 1 | Number of installments must be a whole number, at least 1 | 54, 55 |
| installment count > 120 | Number of installments cannot exceed 120 (pre-existing, still blocks Continue) | |
| card minimum % > 100 (or < 0) | Percentage cannot exceed 100% | 49 |
| card due date / statement date outside 1-31, due date blank | Day must be between 1 and 31 / Due date is required | 50 |
| card fixed strategy with no amount | Enter a fixed payment amount greater than 0 | |
| end date before start date | The end date must be on or after the start date. | 15, 29 |
| semi-monthly with no days | Add at least one day of the month for a semi-monthly schedule. | 05, 25 |
| day of month not a whole number 1-31 | Day of month must be a whole number from 1 to 31. | |

- **Soft vs hard.** The wizard lets the user look ahead: the loan term, rate, balance, the installment count lower bound and the fixed
  payment show their message INLINE on the Details step (yup) but do not disable that step's Continue; they block from the Schedule step
  on (the existing tests walk the wizard through these bad values to the schedule step on purpose, UI-RULE-40 asserts the step is
  reached). Everything else blocks the step it is on (the pre-existing 121-installments and card-percentage behaviour).
- **Ticked "Set End Date" with no date** is not an error: it saves no `endDate` (UI-RULE-14).
- **Blank optional card fields** (42, 44, 45) are coerced to the placeholder defaults, not persisted as NaN: credit limit 0 (none given;
  the detail card already shows "-" and no utilisation), minimum % 2, floor 25, statement day 5. The due date is REQUIRED (the payment
  day depends on it). `resolveCreditInputs` is the single place the numbers are read, used by the saved document, the Review step and the
  amount.
- `dayOfMonth` is persisted as a number (06, 19), and chips read 1st / 2nd / 3rd / 11th / 22nd (04, 24; `ordinal`).

### Edit wizard: preserving data

Two layers, both tested.

1. **The form** carries what it does not manage through hidden values: `isActive`, `loanPaymentsMade`, `installmentsPaid`, `monthOfYear`,
   `intervalWeeks`. The payload builder (`buildExpenseRulePayload` / `buildIncomePayload`, used by create and edit) writes them back. The
   loan's headline payment is computed over the REMAINING term (`term - paymentsMade`, `calculateLoanPlan`'s new optional
   `loanPaymentsMade`): the projections amortize the balance over the remaining term, so renaming a loan that is 5 payments in now re-derives
   the same EMI instead of a smaller one over the full term.
2. **The action** (`sourceActions.ts`, `buildExpenseRuleUpdate` / `buildIncomeSourceUpdate`), because a top-level key in an update REPLACES
   the nested object and the Firestore layer drops `undefined`:
   - `endDate` / `notes` present-but-`undefined` become `deleteField()` (un-ticking "Set End Date" and clearing Notes remove the stored value:
     64, 65, 66; this is the fix site `entityCrud.test` names);
   - `isActive` is stripped: only Activate / Deactivate changes activation (60, 61);
   - `loanConfig` / `installmentConfig` / `creditConfig` are merged over the stored rule, `paymentsMade` / `installmentsPaid` ALWAYS come from
     the stored rule (56, 57, 58, 59), a stale `fixedPaymentAmount` is removed when the strategy changes, and changing the type in the wizard
     removes the previous type's config;
   - keys the form never sends (`color`, `occurrenceOverrides`) are untouched because the update only writes the keys it is given.

Also: `expenseRuleToFormValues` / `incomeSourceToFormValues` (moved out of the managers) leave a missing `dayOfWeek` / `dayOfMonth` undefined
instead of `0` / `1`; that default sent legacy weekly rules to Sundays (63) and re-saved the wrong day. A stored credit limit of 0 or a legacy
NaN shows as blank.

### Dates

- Expense form default start date and loan start date: `getTodayKey()` (local), not `toISOString()` (30; income was fixed by the engine stream).
- Loan amortisation preview date (38), Review step and detail card dates (17, 18): already `parseDate`-based from the engine stream; still green
  in New York and Manila.
- `tests/unit/dateConvention.test.ts`: the 6 `ExpenseRuleForm` allow-list entries are removed (the stale-entry check enforces it). One entry remains
  (`payoffCalculator`, a harmless Date clone, not in this stream).
- Deleting a rule keeps completed history (unchanged; `rules.edit` "deleting a rule" tests).

---

## 2. Defects fixed

| ID | Cause | Fix |
| --- | --- | --- |
| UI-RULE-01, 02, 23 | preview stepped from the start date and ignored Day of Week | engine-based preview on the saved config |
| UI-RULE-03, 26 | preview used `new Date(y, m, 30)` (Feb 30 -> Mar 2) | engine clamps |
| UI-RULE-07, 27/70 (earlier), 08, 28, 09 | quarterly/yearly preview stepped with `setMonth` (Jan 31 + 3 months = May 1); the expense form wrote `{}` for quarterly | engine preview; shared builder writes `{dayOfMonth, monthOfYear}` |
| UI-RULE-04, 24 | chips printed `{day}th` | `ordinal()`, in its own element |
| UI-RULE-05, 25 | semi-monthly with no days saved | validation |
| UI-RULE-06, 19 | form input strings persisted as `"31"` | `toWholeNumber` in the shared builder |
| UI-RULE-13 | daily + adjustment: duplicate cards | engine ignores adjustment for daily |
| UI-RULE-14 | ticked end date, no date -> `endDate: ""` | payload writes `undefined` |
| UI-RULE-15, 29 | end before start saved | validation |
| UI-RULE-20, 21 | hidden day defaults = today | default from the start date |
| UI-RULE-22 | config built from the stale `monthly` frequency for a one-time rule | effective frequency |
| UI-RULE-30 | `toISOString()` default start date | `getTodayKey()` |
| UI-RULE-35, 36, 53 | loan / installment ignored Day of Month; detail said "On the 15th" | `monthlyPaymentDate` + default from the start date |
| UI-RULE-39, 40, 54, 55 | term 0, negative rate, count 0 / negative saved (Infinity) | validation |
| UI-RULE-42, 44 (43, 45 stay green) | blank optional card fields persisted NaN | documented defaults |
| UI-RULE-49, 50 | card % > 100 / due date 32 showed an error but saved | validation blocks |
| UI-RULE-56, 57, 58, 59 | edit reset `paymentsMade` / `installmentsPaid` to 0 | hidden values + action merge |
| UI-RULE-60, 61 | edit reactivated a deactivated rule | hidden `isActive` + action strips it |
| UI-RULE-63 | legacy weekly rule without `dayOfWeek` edited to Sunday | derive from the start date |
| UI-RULE-64, 65, 66 | un-ticked end date / cleared note kept | `deleteField()` in the action |

Known-defect counts (grep of `knownDefect(` markers): UI `tests/ui/rules` 47 -> 3 (UI-RULE-67, 68, 69: Manager summary cards, owned by the display
stream); UI overall 175 -> 131; `it.fails` unit / integration / timezone unchanged (24 / 42 / 3); E2E unchanged (29): no E2E marker belongs to this
stream.

---

## 3. Suite state

| | Before | After |
| --- | --- | --- |
| `npm test` | 1,762 | 1,857 |
| `npm run test:tz` | 74 | 74 |
| `test:ui` (full, UTC) | 640 pass, 27 todo | 675 pass, 26 todo (28 files) |
| `tests/ui/rules` under UTC / America/New_York / Asia/Manila | 47 known defects | 216 pass, 5 todo in each zone, 3 known defects |
| `tsc --noEmit` (app, tests, e2e) | clean | clean |

New tests: `tests/unit/ruleSchedule.test.ts` (43), `tests/unit/ruleForms.helpers.test.ts` (25), `tests/unit/projectionEngine/monthlyPaymentDate.test.ts` (15),
`tests/integration/ruleEdit.actions.test.ts` (12), and in `tests/ui/rules`: "preview == persisted rule's projections == hand-listed dates" for every
frequency driven through the real expense wizard (weekly, bi-weekly, semi-monthly with weekend adjustment, monthly 31st, quarterly, yearly, one-time, weekly
'after' past the end date, monthly 'before' ahead of the start), the income wizard's per-frequency block (already there, now including the preview),
the hidden-default blocks, validation messages, blank card fields, edit preservation (EMI, interval, legacy monthly day, weekend/notes).

---

## 4. Loan/installment Day of Month: behaviour change to know about

Loans and installment plans saved by the OLD form carry `scheduleConfig.dayOfMonth` = the day the rule was CREATED (the hidden default), which the
engine ignored: payments fell on the start date's day. They now fall on the stored `dayOfMonth`. For a rule created on the 15th with a first payment
on the 10th, the payments move from the 10th to the 15th. (The wizard's Schedule Preview and the detail card showed the stored day all along, so the
number the user saw is the one they will now get.) Decision D1 (is there live production data?) is still unanswered; if there is, a one-off migration
can set `dayOfMonth` = the start date's day for loans and installments whose `dayOfMonth` differs from it. Nothing was migrated.

## 5. Decisions taken (please confirm)

- **Soft validation on the Details step** (section 1): inline message, Continue enabled, blocked from the Schedule step. Forced by existing tests that
  walk the wizard through the bad values; if you prefer to block Continue immediately, the four "reaches the schedule step" drivers need changing.
- **Card defaults** 0 / 2 / 25 / 5, due date required.
- **Preview horizon** kept at 3 months, now stated on the card.
- **Daily rules** keep the weekend control (inert) with an explanatory line, instead of hiding it.

## 6. Passing tests that were rewritten

Nothing was deleted and no assertion was loosened.

| Test | Change and justification |
| --- | --- |
| `income.forms` "monthly day 15 with 'Pay on Friday'", "... 'Pay on Monday'", "monthly with an end date: inclusive", "... one day before a payday" | They left Day of Month untouched and relied on the old default of TODAY's date (the 15th). User decision: the default is the start date. Expected values unchanged; the 15th is now typed explicitly (`dayOfMonth: "15"`). |
| `expense.forms` "'Pay on Friday' ... 'after'", "an end date stops the series inclusively" | Same reason, same fix. |
| `expense.forms` UI-RULE-21 precondition `scheduleConfig` `{dayOfWeek: 4}` -> `{dayOfWeek: 1}` | The precondition pinned the old default (today's weekday, Thursday = 4). Start Mon Feb 2 -> 1. The assertions after it (preview and engine start Feb 2) are unchanged. |
| `expense.forms` "quarterly: the form persists an empty scheduleConfig" -> `{dayOfMonth: 5, monthOfYear: 0}` | Brief item 1: ONE shared `buildScheduleConfig` handles every frequency; Mon Jan 5 -> day 5, January (0). The engine result (Jan 5, Apr 5) is pinned by the tests beside it. |
| `expense.forms` "yearly: hypothesis REFUTED - {} config ..." -> `{dayOfMonth: 5, monthOfYear: 2}` | Same: Thu Mar 5 -> day 5, March (2). The preview and engine assertions are unchanged. |
| `expense.forms` "yearly expense created in America/New_York ... (config is {})" | Title/comment only: the config names the month now; the engine assertion (Mar 1) is unchanged. |
| `expense.forms` "weekly preview honours the 3-month horizon" `more` 4 -> 5 | Fridays Feb 6 .. May 1 (horizon May 6) are 13 dates; 13 - 8 cards = 5. The old "+4" was 12 - 8 because the preview stopped counting at an arbitrary cap of 12 (the cap/count mismatch the brief lists). |
| `rules.e2e` UI-RULE-70 precondition `scheduleConfig` `{}` -> `{dayOfMonth: 5, monthOfYear: 0}` | It pinned the persisted CAUSE of the old bug. The behavioural assertion (January shows -$300) is unchanged. |
| `driver.tsx` chip removal: `within(chip)` -> `within(chip.parentElement)` | Test helper, not an assertion. UI-RULE-04/24 require the chip's own text to be exactly "1st"; the remove icon's ligature text ("close") inside the same element made that impossible, so the ordinal is now its own `<span>` and the icon its sibling. |
| `e2e/specs/journeys/support.ts` `removeSpecificDay` | Same structure change (find the ordinal's own element, then its chip). Not run (Playwright). |
| `dateConvention.test.ts` | 6 allow-list entries removed (the file's own stale-entry check demands it). |

## 7. Leftovers and risks

- **Not run:** Playwright (by instruction). The e2e wizard helpers were read for the hidden-default and chip changes; `removeSpecificDay` was updated.
- **Legacy loan/installment `dayOfMonth`** (section 4).
- **Display stream:** UI-RULE-67/68/69 (Monthly Recurring / Active counts / annual projection) are untouched.
- **Preview horizon for an edit of a loan in progress** shows the rule's payments from the start date (not only the remaining ones); it previews the
  schedule, not the payoff progress.
- **`tsc`** reports nothing for `app`, `tests`, `e2e`.
- The expense Review step's "Est. Min Payment" label is kept for every card strategy (tests read it); its figure is now what will be saved.
