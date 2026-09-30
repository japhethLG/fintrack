# Fix log: debt calculators and debt projection generators

Stream: loans, credit cards, installments. Scope: `app/lib/logic/amortization/**`,
`app/lib/logic/creditCardCalculator/**`, `projectionEngine/{loan,credit,installment}Projections.ts`, plus
math-only edits to the loan form (`LoanDetailsForm`, `formHelpers`, `ReviewStep`, `constants` descriptions,
and a 3-line change in `ExpenseRuleForm/index.tsx`) and the credit summary in `ExpenseRuleDetail`.

Contract kept: `loanConfig.currentBalance/paymentsMade`, `installmentConfig.installmentsPaid` and the card
`currentBalance` are still INPUTS. Nothing here writes them.

## 1. Defects fixed

| ID | Cause | Fix | Proving tests |
| --- | --- | --- | --- |
| DBT-4 amortization dates | `setMonth(getMonth()+1)` overflowed Jan 31 to Mar 3 and locked the day (3 sites: `loanAmortization`, `payoffCalculator` x2) | `addMonths(anchor, offset + i)` from the fixed anchor | `loans.amortization`, `loans.test`, `creditCards.compounding` (dates) |
| Amortization final payment | Last period left float residue; `remainingBalance` unrounded | Last term period pays the balance (true-up); `remainingBalance` emitted to the cent | `loans.amortization` |
| Negative amortization (loan and card) | `principal = max(0, ...)` discarded unpaid interest | Shortfall capitalises (negative principal); identity `remaining = opening + interest - paid` holds | `loans.amortization`, `creditCards.compounding`, `loans.test` |
| DBT-2/3/8, UI-LIFE-10..17 (math half) | Anchor never advanced; `paymentNumber` counted the filtered index; PMT re-derived from an unreduced balance | Schedule from `currentBalance` over `term - paymentsMade`, dated `startDate + paymentsMade` months; numbers attached before window filtering; amortized loans pay the stored `monthlyPayment` | `loans.projections`, `loans.test`, `lifecycle.test`; UI-LIFE-11/12/16/17, UI-DISP-38, E2E-JRN-15/15b |
| Loan past term, balance owed | `paymentsMade >= term` returned `[]` | One payment of balance + a month of interest, dated payment k+1; `getLoanStatus()` exported (`active`, `paid_off`, `past_term_balance_owed`, `invalid`). Balance 0 is paid off whatever the counter says | `loans.projections` |
| Loan weekend adjustment (UI-RULE-37) | Ignored | Applied; occurrence id keeps the logical month; window filters on the emitted date | `loans.projections` |
| Loan term 0 (UI-RULE-39 math half) | `Infinity` payment | `calculateLoanPaymentAmount` returns 0, schedule `[]`, form plan `null`. Validation itself is the forms stream | `loans.amortization`, `loanForm.plan` |
| UI-RULE-31/32/33 | Headline EMI from the principal, preview from the balance, interest from `payment x term - principal` | One `calculateLoanPlan` feeds headline, preview, total interest (sum of the interest column) and the saved `amount`/`monthlyPayment` | `loanForm.plan`; UI-RULE-31/32/33 |
| UI-RULE-38 | Preview used `new Date("YYYY-MM-DD")` (UTC) | `parseDate` | UI-RULE-38 |
| DBT-7, UI-RULE-46/47 | First payment `setDate(dueDate)` overflowed; later dates chained from the clamped value | First payment and every bill are `dueDate` clamped to that month | `creditCards.projections` |
| Card date filter | Filtered on the schedule date, then moved the date | Filter on the emitted date | `creditCards.projections` |
| Card weekend adjustment (UI-RULE-48) | Ignored | Applied, id from the logical month | `creditCards.projections` |
| DBT-13, UI-RULE-41 full_balance | Interest charged first, leaving a second bill | Single payment of the statement balance, no interest (see 3) | `creditCards.compounding`, `creditCards.projections`, UI-RULE-41 |
| DBT-12, UI-DISP-44 settled card | Empty schedule read as "never" | Summary: 0 months, 0 to pay, dated today, not a trap; detail card guards 0/0 | `creditCards.compounding`, UI-DISP-44 |
| DBT-17 totalPayments | Hard-coded 0 | Length of the payoff schedule; 0 (unknown) for a card that never pays off | `creditCards.projections` |
| NaN guards (UI-RULE-45; 42-44 partly) | `parseFloat("")` reached the maths | Blank/NaN percent, floor, APR, balance are read as 0; zero-payment bills are not emitted; `calculatePaymentForMonths(months < 1)` is 0 | `creditCards.compounding`, `creditCards.projections`, `loanForm.plan` |
| D3 (DBT-9/10/11) | See 3 | See 3 | `creditCards.compounding`, `creditCardSummary` |
| DBT-5, UI-RULE-52 installment drift | Cursor chained `addMonths` off the clamped value | `startDate + i` months from the anchor | `installments`, `installments+generator` |
| DBT-20 one-time ids | `one-time` id is `<id>_once` | Identity uses `monthly` for one-time plans; ids use the LOGICAL date so weekend shifts cannot collide | `installments` |
| UI-RULE-51 rounding | Fractions of a cent | Bills are whole cents; the last absorbs the residual (1000/7 = 6 x 142.86 + 142.84 = 1000.00); form amount rounded to the cent | `installments`, `loanForm.plan`, UI-RULE-51 |
| UI-RULE-54 math half | Count 0 gave `Infinity` | Count < 1 or NaN: no plan, form amount 0 | `installments`, `loanForm.plan` |

## 2. D2: calculation types

Research: in the Philippines the same quoted rate means very different costs by method. Flat / add-on
interest is charged on the original principal for the whole term (total interest = principal x rate x
years; payment = (principal + interest) / months), and is much dearer in effective terms than diminishing
balance, where interest is charged only on the balance still owed. BSP Circular 730 (Truth in Lending)
requires interest on the outstanding balance and effective-rate disclosure. The form's own labels (kept, now
shown under the select): Amortized "fixed EMI, decreasing interest"; Reducing Balance "interest on remaining
balance"; Flat Rate "interest on original principal".

**Finding:** "interest on the remaining balance with a level payment" IS amortization, so a
`reducing_balance` defined that way is indistinguishable from `amortized`. To make the three options
meaningfully different I defined `reducing_balance` as the equal-principal variant (constant amortization):
equal principal every month plus interest on the balance, so the payment falls. This is also how
"diminishing balance" is commonly taught. Product may still prefer to alias it to `amortized` and hide it.

Worked example, 12,000 at 12% a year (1% a month) over 24 months:

| Type | Monthly payment | Interest each month | Total interest |
| --- | --- | --- | --- |
| `amortized` | 564.88 level (PMT) | 120.00, then falling (balance x 1%) | 24 x 564.8817 - 12,000 = 1,557.16 |
| `flat_rate` | (12,000 + 2,880) / 24 = 620.00 level | 12,000 x 1% = 120.00 every month | 12,000 x 12% x 2 = 2,880.00 |
| `reducing_balance` | 620.00, 615.00, 610.00 ... 505.00 | 120, 115, 110 ... 5 | 1% x 500 x (24+...+1) = 1,500.00 |

Rules: only `amortized` honours the stored `monthlyPayment` (legacy flat/reducing rules stored an amortized
PMT because the type was ignored); flat and reducing derive their payment from their formula. Flat interest
is charged on `principalAmount` (the original principal) even after part is repaid. The form and engine call
the same functions, so the headline figure always equals the first preview row. For `reducing_balance` the
headline is the first (largest) payment.

## 3. D3: the minimum-payment trap. Verdict: a real bug, fixed

Analysis, on hand-derived numbers (`tests/unit/creditCards.compounding.test.ts`): 5,000 at 24% (2% a month)
paying 50. Correct books: 5,000 + 100.00 - 50 = 5,050.00, then 5,101.00, 5,153.02. The old loop clamped
`principal` at 0, so the balance stayed 5,000 while `cumulativeInterest` kept charging 100 a month: after 13
rows it reported 1,300 interest, 650 paid and an unchanged balance, breaking
`remaining = opening + interest - paid` (the module's own identity, pinned for solvent schedules). The
review's sub-claim that the identity holds "with payment exactly equal to interest" is true (a flat balance is
consistent) but does not cover payment below interest.

Two further effects, both proven wrong by arithmetic rather than by convention:
- The `month > 12` bail-out truncated non-terminating cards at 13 rows, so the calendar stopped billing a
  card that still owed money (DBT-10), and the scenario baseline was a 13-month slice (DBT-9).
- Existing tests that "documented" the truncation were themselves wrong: a payment of 100.005 against 100 of
  interest is NOT "83,000 years", because progress compounds; it pays off in
  ln(20001)/ln(1.02) = 500.1, i.e. 501 payments. Doubling the trap card's payment to 200 retires it in
  ln 2 / ln 1.02 = 35.003, i.e. 36 payments, and was wrongly said not to reach zero.

Fix: unpaid interest capitalises (negative principal, balance grows); no bail-out (horizon 600 months, so a
trapped card bills for as long as the window asks); scenario savings against a baseline that never reaches 0
are `Infinity` (both `interestSavings` and `timeSavingsMonths`), matching the summary's own `Infinity`;
finite scenario costs are unchanged; the detail card shows "Ends the endless interest" instead of
`$∞`/"Never". Conservation identity preserved and tested on every row.

**full_balance, deviation from the brief.** The brief said `full_balance` "pays balance + accrued
interest". Three passing tests and UI-RULE-41 assert the opposite (one bill equal to the balance; first bill
5,000.00 and exactly one row; `getEffectivePayment` = balance). Paying the statement balance in full by the
due date is the card's grace period: no interest is charged. I implemented that: one payment of the balance,
interest 0, nothing left. If product wants "balance + a month of interest" instead, change
`calculateFullBalancePayoff` and the UI-RULE-41 expectation together.

## 4. Passing tests rewritten (each has a derivation in its comment)

| Test | Why the old expectation was wrong |
| --- | --- |
| `loans.test` DEFECT 3 (the `:612` conflict) | Mixed two conventions. Rewritten to the absolute one: payment on `rule.startDate` is #1 with nothing paid; with 3 paid the first projected payment (Apr 1) is #4. The old number changed with the viewport (June printed #6 or #1). |
| `loans.test` negative amortization: "clamps principal to zero", "leaves the balance untouched" | Encoded the discarded-interest bug; now -50.00/-50.50 principal, 10,050.00/10,100.50 balance, balloon at maturity 10,684.13. |
| `creditCards.test` trap block (5 tests) and declining "bails out after month 12" | Encoded the clamp and the truncation (13 rows, flat 5,000, interest 100 every month, 1,300). Now negative principal, growing balance, 1,384.02 after 13 rows, 600-row horizon. The declining case (payment exactly = interest) keeps its flat balance but runs 600 rows. |
| `creditCardSummary`: full_balance routing and "needs a SECOND month" | Modelled the interest-only second bill. Now one month, 5,000.00, 0 interest. |
| `creditCardSummary`: "half a cent ... never pays off" | Wrong arithmetic (see 3). Now 501 months, still flagged as a trap. |
| `creditCardSummary`: "omits the two-year scenario ..." | Claimed doubling to 200 does not retire 5,000 at 24% (false; 36 payments). Now `["Double Payment", "Pay Off in 1 Year"]`. |
| `creditCardSummary`: degenerate full-balance card | The single 10,000 "Double Payment" existed only because of the second-month defect (the old comment said so). Now no scenarios. |
| `creditCardSummary`: "no NaN or Infinity in any scenario field for a trapped card" | Now no NaN; only the two savings fields are `Infinity`, as D3 requires. |
| `installments+generator`: "drifts off the month end" | Encoded the drift. Now Mar 31, Apr 30, May 31, Jun 30. |
| `lifecycle.test` four "OBSERVED DRIFT" tests | Asserted 5 rows, 1236.24, numbers 3..6. Now 6 rows ending Jun 1, level 1035.29 (first four rows; see 6), numbers 2..6. |
| `expense.debt` "Flat Rate is persisted but the EMI is still the amortised PMT" (+ the `it.todo` DECISION) | D2 decided. Now 620.00 / 2,880.00 for flat and 620.00 -> 505.00 / 1,500.00 for reducing, through the wizard. |

Fixtures (not expectations): `tests/helpers/builders.ts` and `tests/ui/display/households.ts` stored
`monthlyPayment` 565.0 / 564.88, which nothing read until the engine honoured the stored payment. Both are now
the exact PMT 564.8816666791 (what the form persists). The households value matters: a pre-rounded amount hid
UI-DISP-10 (3-decimal row amounts), which is unrelated to this stream and still open.

## 5. Known-defect status

| | Before | After |
| --- | --- | --- |
| `it.fails` (unit, integration) | 126 | 97 |
| `knownDefect(` UI | 220 | 200 |
| `knownDefect("` E2E (not run) | 35 | 33 |
| `npm test` | 1,566 | 1,713 |
| `npm run test:tz` | 74 | 74 |
| `test:ui` | 637 pass, 30 todo | 638 pass, 29 todo |

Converted (markers removed): unit loans 7, credit 7, summary 5, installments 3, lifecycle 3; UI-RULE-31, 32,
33, 34, 37, 38, 41, 43, 45, 46, 47, 48, 51, 52; UI-LIFE-11, 12, 16, 17; UI-DISP-38, 44; E2E-JRN-15, 15b.
Flip check on the remaining unit/integration defects in touched files: every one fails on an assertion.

## 6. Leftovers and risks

- **Needs the write path (other stream):** completing a loan/card payment must reduce
  `loanConfig.currentBalance` by the PRINCIPAL actually paid, add 1 to `paymentsMade` (and reverse both on
  revert/skip), reduce the card `currentBalance`, and store `paymentBreakdown` and the step payment as
  `projectedAmount`. Still red for that reason: UI-LIFE-10/10b/13/14/15/18/19/20/21, UI-DISP-39,
  E2E-JRN-16/17, lifecycle "reduces the outstanding balance" and "remaining payments keep their original
  amount".
- **Stale-balance behaviour (until then):** with `currentBalance` unreduced, payments stay level (M) but the
  LAST payment absorbs the unreduced principal (6,000 loan after 1 payment: last bill 2,060.33, not 1,035.29).
  When the write path lands, remove `.fails` from lifecycle "the remaining payments keep their original
  amount".
- **Loan with every payment counted and a stale balance** now shows a phantom final bill until the write path
  reduces the balance. That is deliberate ("do not vanish while owed").
- **Forms stream:** validation (term 0, negative rate, percent > 100, due date 32, count 0/negative:
  UI-RULE-39/40/49/50/54/55) and persisting NaN (UI-RULE-42/44; needs `ExpenseRuleForm/index.tsx`) are
  untouched; Day-of-Month ignored (UI-RULE-35/36/53). I edited `index.tsx` by 3 lines (the loan amount now
  comes from `calculateLoanPlan`); expect a trivial merge there.
- **Not done:** DBT-15 (interest split of interest-bearing installments) and bi-weekly installments: the
  installment UI is monthly-only and the interest semantics (flat surcharge vs annual rate) is still an open
  DECISION; both `it.fails` stay. DBT-21 (`firstPaymentDate` never read) stays: the form keeps it equal to
  `rule.startDate` and reading it would break every fixture that sets only `startDate`. DBT-18 (`endDate` on
  loan/card) not applied.
- **Other streams:** I use `parseDate/addMonths/formatDate`, `adjustForWeekend` and
  `generateOccurrenceId(ruleId, freq, LOGICAL date, ...)`. If the occurrence-id change moves to a different
  signature, three call sites change (loan, card, installment projections). Windows are compared as `Date`s
  exactly as before.
- **Semantics to confirm:** `reducing_balance` = equal principal (section 2); `full_balance` = grace period
  (section 3); `Infinity` savings for endless baselines; flat interest basis is the original principal.
