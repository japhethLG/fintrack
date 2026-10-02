# FinTrack: manual exploratory test

**Date:** 2026-10-01 · **Build:** `claude/financial-projections-engine-g5fgkv` @ `bf2248d` · **Tester:** Claude, driving Chromium by hand through Playwright (no spec files)

## How this was tested

- **The app:** the real app, built with `FINTRACK_E2E=1`, so Firebase, Gemini and ImgBB are in-memory fakes. The running dev server was **not** used: it loads `.env.local` and would have written to the real Firebase project, which has live user data. Org policy also forbids connecting to databases. The build check confirmed no real backend code was in the bundle. Browser DNS was blocked for everything except localhost.
- **The browser:** headless Chromium in **Asia/Manila**, with the clock at real time (2026-10-01), and later moved to 2026-10-20 to test overdue items. Desktop was 1440 px wide; phone checks used 390 px.
- **The method:** one step at a time. After each action I read a screenshot and the page text, and checked the stored data. Every number marked "verified" was worked out by hand.
- **The journey:**
  1. Google sign-up.
  2. Starting balance of ₱25,000.
  3. Semi-monthly salary of ₱20,000 on the 15th and 30th.
  4. Rent of ₱12,000 on the 5th.
  5. Weekly groceries of ₱2,500 on Saturdays.
  6. A ₱100,000 loan at 12% over 24 months.
  7. A credit card with a ₱30,000 balance at 36% APR.
  8. A ₱25,000 phone over 12 installments.
  9. Then: complete, skip, re-complete, revert and drag on the calendar; manual transactions; settings; currency; reset; a second email user; delete account; the phone layout; overdue items.

## Summary

The core money flows are right. Every balance, total and schedule I checked by hand matched, across the Dashboard, Calendar, Forecast, Income and Expense pages, and the Transactions page. Most of the original defects are confirmed fixed in the browser, including:
- the balance on complete, revert, re-complete and manual add/flip/delete;
- loan progress surviving a rename;
- the card minimum-payment trap and its payoff scenarios;
- all three loan calculation types;
- currency switching;
- a zero low-balance threshold;
- the selective reset counts;
- the delete-account order.

**New issues found by hand:** 1 high, 10 medium, 8 low, plus cosmetic and UX notes. Part 1 covered the main journey; Part 2 (at the end) covers every income type, every expense type and their calendar actions.

## Fix status (2026-10-01)

Every issue below is fixed on `claude/financial-projections-engine-g5fgkv`. Each fix has a regression test that was checked to fail on the old code; a few tests are guards for behaviour that already worked. The issue descriptions further down are kept as found.

| Issue | Fix |
| --- | --- |
| H1 | Loan, card and installment schedules are windowed on the date a payment is shown, so a dragged payment keeps its interest/principal split (and is no longer lost when dragged across months). |
| M1 | An edit keeps the stored monthly payment unless a loan term changes (principal, balance, rate, term, calculation type). |
| M2 | Week view's top tiles summarise the week on show. |
| M3 | The wizards save only from their Create/Save button; Enter never submits them. |
| M4 | Phone widths print compact amounts (full amount in the tooltip); no cell content overflows. |
| M5 | The overdue dialog shows "Overdue Bills" and "Income Not Yet Recorded" separately, with no combined total. |
| M6 | A note explains that the calendar's today figure is projected (after unpaid overdue bills), unlike the current balance. |
| M7 | One "First Payment Date" drives the loan; the wizard no longer shows a second, different date. |
| M8 | The income Category follows the chosen type. |
| M9 | Plans record which payments are paid; the remaining schedule fills the earliest unpaid months. |
| M10 | The day panel's totals count what moved the balance that day; early payments are marked "Paid early" on their scheduled day. |
| L1 | Installment Remaining is exact (₱25,000.00, not ₱24,999.96). |
| L2, L3 | Debt projections, breakdowns and stored debt balances are whole cents, and schedules still sum exactly to the balance. |
| L4 | Every "next N days" window is exactly N days, today included. |
| L5 | Date Format and Start of Week are honoured across the app, including the calendar. |
| L6 | Total Debt is "what you still owe": loan principal + card balance + remaining installments, with a note that loan interest is not included. |
| L7 | Right-click "Add Income/Expense" opens the wizard on the clicked day. |
| L8 | The Pay Full Balance preview shows only the payments that happen, and the one-time expense preview appears. The one-time income and daily-with-end-date previews could not be reproduced as broken; tests pin them. An edit part-way through previews the payments still to make. |

**UX and cosmetic notes, all fixed:**
- validation messages for zero or negative amounts;
- review steps show the semi-monthly days and the installment total, count and last payment;
- end dates replace "Ongoing" for fixed-term plans;
- one wording throughout ("Pay on Friday if weekend", "Semi-monthly");
- the card wizard warns about the minimum-payment trap;
- the preview notes weekend moves;
- human category labels everywhere, and the reset dialog has no internal type names;
- zero amounts are neutral, and the empty chart's axis is readable;
- the page header stacks on phones;
- the landing page's "See How It Works" scrolls to How It Works;
- no Recharts width warning;
- sign-up has a confirm password and a 6-character minimum, and the E2E fake enforces it;
- Google-only users aren't offered a password change;
- the Delete Account dialog stays open on a wrong password;
- the AI prompt flags the card trap;
- paying early defaults Actual Date to today;
- the sidebar signs sit inline with their amounts;
- screen-reader drag announcements use names, not IDs.

**Decided 2026-10-02:**
- **Weekend defaults stay different.** Income starts on "Pay on Friday if weekend" and bills on "No adjustment". Each wizard now explains its default under the field.
- **Debt payments can't be skipped.** Loan, credit card and installment payments are owed, so the transaction dialog offers no Skip for them. Instead, the user drags the payment to the day they'll pay, or leaves it unpaid, and it shows as overdue.
  - Why: a skip used to hide money still owed. A 6-payment loan showed 5 payments after one skip, and the leftover never reappeared.
  - The write path also refuses a debt skip.
  - A one-time migration at login turns existing skipped debt payments back into unpaid ones.

---

## Issues

### High

**H1. Dragging a loan or credit-card payment to another day breaks the debt balance.**

Part 2 widened this: it affects **every loan type and credit cards**, not just amortized loans. All four cases below lost their breakdown and took the whole payment off the debt:

| Dragged payment | Debt after completing | Should be |
| --- | --- | --- |
| Amortized loan | ₱95,292.65 | ₱96,292.65 |
| Flat-rate loan | ₱49,500 | ₱50,000 |
| Reducing-balance loan | ₱15,800 | ₱16,000 |
| Fixed-payment card | ₱11,300 | ₱11,566 |

Installments are unaffected.

- **Steps:**
  1. Drag the Car Loan from 15 to 16 Oct on the calendar.
  2. Mark it complete at ₱4,707.35.
- **Expected:** `loanConfig.currentBalance` goes from 100,000 to 96,292.65. That's the principal (₱3,707.35); the ₱1,000 is interest.
- **Actual:** it goes to **95,292.65**. The whole payment comes off the principal.
- **Cause:** the stored transaction has no `paymentBreakdown`. A payment that wasn't dragged (November's) stores the breakdown and reduces the balance correctly: interest ₱952.93, principal ₱3,754.42, payment #2 of 24.
- **Knock-on effects:**
  - Every later interest figure is computed from the wrong balance.
  - Editing the loan then re-prices its monthly payment from the wrong balance (see M1).
- **Likely area:** the projection-with-override path loses `paymentBreakdown` before the ledger sees it.
- **Status: FIXED (2026-10-01).**
  - **Real cause:** the loan, card and installment generators decided which payments fell in the date range by the *original* due date, ignoring the drag. Completing a dragged payment regenerates it on its new day, found nothing, and fell back to the rule amount with no breakdown.
  - **Same cause, second symptom:** a debt payment dragged into another month disappeared from both months. Installments had this too.
  - **Fix:** the three generators now filter on the date the row is shown (the drag's date when there is one), as plain recurring rules already did.
  - **Regression tests:** `tests/integration/lifecycle.test.ts` ("a dragged payment keeps its breakdown", "card and installment ...") and `e2e/specs/calendar/dragdrop.spec.ts` ("debt payments keep their breakdown when dragged"). 4 of the 5 integration tests fail on the old code.
  - **Not repaired:** a debt balance that was already over-reduced by this bug before the fix.

### Medium

**M1. A name-only edit changes a loan's monthly payment.**

Renaming the loan re-derived the monthly payment from the current balance over the remaining term: ₱4,707.35 became ₱4,655.97. With a correct balance, the result would be about the same as before. With H1's drifted balance, the loan is silently re-priced. Editing only the name shouldn't touch the payment.

**M2. In week view, the top tiles show the month's totals.**

For the week of 27 Dec – 2 Jan, the four tiles show January's Income ₱40,000, Expenses ₱32,190.68 and "0 / 11" transactions. The Weekly Balance Overview directly below correctly shows +₱15,416.67 for the week. The page contradicts itself.

**M3. Pressing Enter in the wizard's date field creates the expense.**

On the Schedule step, Enter in "First Payment Date" submitted the wizard and **created** the Groceries expense, skipping review. It didn't happen for Rent (a monthly rule), so it's inconsistent.

- **Correction:** variable and fixed expenses have no review step; Schedule is their last step. The browser submits a form on Enter when it has a single text field. A weekly rule's last step has only the date (the selects are native), so it submitted. Rent's step also has "Day of Month", so it didn't.
- **Status: FIXED (2026-10-01).** Both wizards now save only from their Create/Save button; Enter in a field never submits (`Form`'s new `submitOnEnter={false}`, handled in the capture phase because the date picker stops Enter's propagation). Other forms such as login keep Enter-to-submit. Regression test: `e2e/specs/robustness/wizard-enter.spec.ts`.

**M4. On a phone, the calendar grid is unreadable.**

At 390 px, each day's balance (for example "₱16,835…") overflows its cell into the neighbouring days.

**M5. "Total Overdue" adds unpaid bills and missed income together.**

The overdue dialog shows **₱33,000**: a ₱13,000 unpaid bill plus a ₱20,000 unrecorded payday. It should show them separately, or as a net figure. This was a parked DECISION; seen in practice, it's misleading.

**M6. The calendar's balance for today differs from the dashboard's, with no explanation.**

With rent overdue, the 20 Oct cell shows **₱2,935.80** (after the overdue rent and today's bill), while the Dashboard shows Current Balance **₱16,835.80**. Both follow the agreed rule (overdue items count as owed, but don't change the actual balance). But nothing on the cell says "after overdue". This also corrects `fix-phase-summary.md`, which says the calendar's today balance equals the Dashboard's; that's only true when nothing is overdue.

**M7. The loan wizard shows two different first-payment dates.**

The Loan Details step previews payment #1 on the **Loan Start Date** (1 Oct). The real first payment is the **First Payment Date** chosen on the next step (15 Oct). Two date fields for one loan confuse users. This ties to the open question of which of the two dates is authoritative.

### Low

- **L1. The installment "Remaining" figure loses the rounding remainder.**
  - The plan shows Total ₱25,000.00 but Remaining ₱24,999.96 with 0 of 12 paid.
  - "Remaining" is calculated as ₱2,083.33 × 12.
  - It feeds Total Debt on both the Expenses and Forecast pages: ₱154,999.96 instead of ₱155,000.
- **L2. Debt fields are stored unrounded:** `currentBalance` 91,538.2265; `principalPaid` 3,754.420722…. Cents rounding wasn't applied to debt fields. **FIXED (2026-10-01):** the ledger stores debt balances in whole cents, and recorded breakdowns are whole cents (see L3).
- **L3. Projected loan amounts aren't rounded to cents.** For example, ₱4707.347222326467 appears in the AI prompt. **FIXED (2026-10-01):** loan and card projections are computed against a running balance in cents. Each payment and its interest are rounded, and the last payment absorbs the remainder, so the schedule still sums exactly to the balance (₱4,707.35, not ₱4,707.347…).
- **L4. "Next 30 days" means two different things.** The AI prompt includes 31 days (it covers 31 Oct). The Expense Manager excludes 31 Oct.
- **L5. Two preferences do nothing (still open):**
  - "Start of week = Monday": the calendar still starts on Sunday.
  - "Date format = DD/MM/YYYY": dates still show "10/3/2026".

### UX notes

- **Validation without explanation:** the wizard's Continue button is disabled for a negative or zero amount, but no message says why.
- **Preview hides weekend shifts:** the schedule preview shows a weekend-shifted payment, such as "Oct 30" for the 1 Nov payday, with no hint that it's the November payment.
- **No early trap warning:** the card wizard doesn't warn about the minimum-payment trap. Only the card's detail view does.
- **Future actual dates:** paying early records a future actual date unless the user changes it, because "Actual Date" defaults to the scheduled date.
- **Sign-up form:** one password field, no confirmation, and no client-side minimum length. The app relies on Firebase's `auth/weak-password`. (Test infrastructure: the e2e fake accepted "123", so it should enforce Firebase's 6-character minimum.)
- **Google users:** offered "Password: Change", which doesn't apply to them.
- **Delete Account dialog:** it closes on a wrong password, so you have to reopen it and retype everything.
- **AI prompt:** doesn't mention the card trap the app has already detected.
- **Different weekend defaults:** income defaults to "Pay on Friday" and expenses to "No adjustment".

### Cosmetic

- **Raw category codes:** "Debt_payment" and "debt_payment" in Upcoming Bills, the category chart legend, dialogs and Top Spending. The calendar list shows lowercase codes.
- **Raw type names:** the reset dialog shows internal names, such as "Type: all" and "Type: income_sources".
- **Calendar range panel:** the "+" and "−" signs sit on a separate line above the amounts.
- **Inconsistent wording:**
  - "Pay Before" (review step) vs "Pay Friday If Weekend" (detail card);
  - "Semi Monthly" vs "Semi-monthly".
- **Review steps:**
  - The semi-monthly review omits the chosen days.
  - The installment review omits the total and the number of payments.
- **Installment end date:** a 12-payment plan shows "End Date: Ongoing".
- **Transactions on a phone:** the "Add Transaction" button covers the subtitle.
- **Zero values:** "₱0.00" expenses render in red. The empty chart's y-axis reads ₱0 to ₱4.
- **Landing page:** the "See How It Works" button scrolls to Features, not How It Works.
- **Screen readers:** the drag-and-drop text exposes internal IDs ("Draggable item proj_…").
- **Console:** Recharts logs "width(-1)" warnings on first render.

---

## Verified working

Numbers are hand-checked.

| Area | What I checked |
| --- | --- |
| Sign-in and sign-out | Google sign-up; email sign-up and login; a wrong password shows a clear error; logout; a signed-out deep link redirects to `/login`; a second user sees none of the first user's data |
| Empty account | "Not enough data yet" health card, ₱0.00 everywhere, PHP by default |
| Income wizard | Semi-monthly 15th/30th with "before"; preview correct (15 Nov falls on a Sunday, so it's paid Fri 13 Nov); ₱40,000 for October, ₱480,000 per year |
| Expense wizard | Day of month follows the first-payment date. Groceries ₱24,500 = rent + 5 October Saturdays. Next 30 days ₱27,607.35, with 31 Oct correctly excluded. |
| Loans | ₱100,000 at 12% over 24 months: monthly payment ₱4,707.35, interest ₱12,976.33. Flat rate ₱24,000 interest; reducing balance ₱12,500. November's payment breakdown is exact. |
| Credit card | Minimum ₱900. Detail shows "Never (payment too low)". Scenarios: 2 years ₱1,771.43, 1 year ₱3,013.87, Double Payment ₱1,800 (about 23.4 months). |
| Installments | ₱25,000 over 12 = ₱2,083.33; month-end dates kept (31 Oct, 30 Nov, 31 Dec, 31 Jan) |
| Calendar | October income ₱40,000, expenses ₱32,190.68, closing ₱32,809.32, every daily balance correct. November chains on from October. January matches. |
| Transaction actions | Early completion moves the actual balance once. A negative actual amount is rejected. Skip, re-complete (variance ₱500, same row) and revert all correct. A drag lands on the cell under the pointer. |
| Manual transactions | Add as completed (+₱5,000), change the type (−₱10,000 swing), delete (back to the start) — each balance step correct |
| Dashboard and Forecast | Agree with the Calendar. Next 14 days ₱14,500. Budgeted equals actual. Total Debt includes installments (but see L1). |
| Settings | Override balance (the starting balance absorbs it); a zero threshold is kept; USD shows "$" on every page with no stray "₱"; Selective Reset counts and confirmation work |
| Delete Account | A wrong password deletes nothing. The right password signs you out and removes the login and profile; the other user's data is untouched. |
| Overdue | The actual balance doesn't count overdue items; overdue badges and days-overdue are shown; the projected closing is correct |
| Phone layout | No page scrolls sideways; the menu works |

## Not covered

- Real Firebase or Google (not allowed).
- Profile-image upload (ImgBB).
- Offline behaviour.
- Real Gemini output.
- Light theme.
- Sessions in two browsers at once (covered by the robustness specs).

## Suggested next fixes

1. H1 (and M1 with it).
2. M2, M3, M5, M6.
3. M4 and M7.
4. The low and cosmetic items, which are mostly quick label and formatting fixes.

---

# Part 2: every income type and every expense type, with their calendar actions

A fresh email account (`types@test.com`), starting balance ₱50,000, clock at 2026-10-01 in Asia/Manila. Every rule was created through the real wizard. Every preview, saved document, calendar day and total below was checked against hand-listed dates and sums.

## Coverage

### Income: all 8 types, each on a different frequency

| Type | Rule | Frequency | Checked |
| --- | --- | --- | --- |
| Salary | Acme Salary ₱30,000 | Monthly on the 25th | 25 Oct is a Sunday, so paid Fri 23 Oct; 25 Nov; 25 Dec |
| Freelance | Logo Project ₱8,000, **variable** | One-time, 12 Oct | Shown as "₱8,000~ (estimate)"; completed at ₱9,500 with a ₱1,500 variance |
| Business | Sari-sari Store ₱3,000 | Weekly | Weekday followed the start date (Monday); 5 Mondays in November |
| Investment | Stock Dividends ₱1,500 | Quarterly | 15 Oct, then 15 Jan |
| Rental | Condo ₱6,000 | Semi-monthly, 1st and 16th, "pay Monday" | 1 Nov (Sun) paid Mon 2 Nov; 16 Jan (Sat) paid Mon 18 Jan |
| Government | SSS Pension ₱2,500 | Bi-weekly | Every other Thursday from 8 Oct (3, 17, 31 Dec) |
| Gift | Birthday ₱5,000 | Yearly | 20 Dec (Sun) paid Fri 18 Dec |
| Other | Tips ₱200 | Daily, ending 31 Oct | 31 October occurrences, then none |

**Income totals, all matching hand sums:**
- October recurring ₱66,700, one-time ₱8,000, next 12 months ₱742,200.
- Next 30 days ₱74,500.
- Calendar months: October ₱74,700, November ₱62,000, December ₱66,500, January ₱60,500.
- Every daily balance chained correctly.

**Income calendar actions:**
- **Complete:** rent and tips; then the variable freelance payment at a different amount, with the variance saved.
- **Skip:** a store payment and one day's tips; no money moved.
- **Drag:** the pension 8 → 9 Oct and the gift 18 → 24 Dec. Each drop landed on the cell under the pointer and saved one override.
- **Complete after drag, then revert:** the pension stayed on 9 Oct after the revert (the bi-weekly "revert loses the date" bug is fixed).
- **Short completion and revert:** the dividend completed ₱50 short (variance −₱50), then reverted.
- **Day panel:** lists the day's items.
- **Right-click on a day:** Add Transaction, Add Income, Add Expense.
- **"View Income Source" link:** opens the source.

**Income lifecycle:**
- Editing the store amount from ₱3,000 to ₱3,500 updated future Mondays only.
- Deactivating tips removed the remaining tips.
- Deleting the completed freelance source kept its completed row and the balance.
- Reactivating works.

### Expenses: all 6 types and every expense frequency

| Type | Rule | Frequency | Checked |
| --- | --- | --- | --- |
| Fixed | Car Insurance ₱4,500 | Quarterly | Saved with day 10 (the old "moves to the 1st" bug is fixed); 10 Nov, then 10 Feb |
| Fixed | Domain ₱900 | Yearly | January saved as month 0; 5 Jan |
| Fixed | Gym ₱750 | Bi-weekly | Every other Friday from 2 Oct |
| Fixed | Internet ₱1,300 | Semi-monthly, 10th and 25th | Dates sorted correctly |
| Variable | Electricity ₱2,200 | Monthly on the 18th | Completed at ₱2,650: variance +₱450 |
| One-time | Car Repair ₱7,500 | 22 Oct | 2-step wizard; completed at ₱8,100, reverted, deleted |
| Loan (flat rate) | Motorcycle ₱60,000, 10%, 12 months | Monthly on the 28th | ₱5,500 a month (₱5,000 principal + ₱500 interest); total interest ₱6,000 |
| Loan (reducing) | Personal ₱24,000, 12%, 6 months | Monthly on the 10th | ₱4,240, then ₱4,200, ₱4,160, ₱4,120 (falling as designed); total interest ₱840 |
| Card (fixed amount) | Metrobank ₱15,000 at 24%, ₱2,000 a month | Due on the 25th | First payment: ₱300 interest, so balance → ₱13,300 |
| Card (full balance) | Amex ₱8,000 at 30% | Due on the 12th | One ₱8,000 payment in October, nothing after; completing it set the balance to 0 |
| Installment (with interest) | Laptop ₱36,000 / 6, "5%" | Monthly on the 20th | ₱6,300 a month (₱37,800 total); installments paid counter goes up |

**Expense totals, all matching hand sums:**
- October recurring ₱33,090, one-time ₱7,500.
- Calendar months: October ₱40,590, November ₱28,800, December ₱24,260, January ₱25,120.

**Expense calendar actions:**
- **Complete:** each of the 11 rules, with the balance and debt counters exactly as predicted: running balance 65,700 → 64,950 → 62,300 → … → 36,260.
- **Revert:**
  - a loan payment (balance and payments made restored);
  - the full-balance card (₱8,000 owed again, still no later bills);
  - the one-time repair.
- **Skip:**
  - internet;
  - a flat-loan payment (balance unchanged, and the remaining 9 × ₱5,500 still equal what's owed).
- **Drag from the grid:** installment and flat loan.
- **Drag from the day panel:** reducing loan and card, which works for items hidden behind "+N more".
- **Edit:** switching the card from Fixed Amount to Minimum gave ₱500 (the floor) and kept 2 payments made.
- **Delete:** the one-time rule.

## New issues found in part 2

| ID | Severity | Issue |
| --- | --- | --- |
| H1 (widened) | High | See H1 above: dragging any loan type or credit-card payment drops its breakdown and over-reduces the debt |
| M8 | Medium | **Income category ignores the chosen type.** The "Select Income Type" choice is saved as `sourceType`, but the Category dropdown stays "Salary". Freelance, Business, Investment, Government, Gift and Other were all saved with category Salary. The dashboard's income breakdown shows only "Salary" and "Rental" for ₱68,700 of income, and lists label tips and pension as "Salary". Step 1's Continue is also enabled before any type is picked, silently meaning Salary. **FIXED (2026-10-01):** the Category now follows the chosen type unless the user picked a different one; tests in `tests/ui/rules/income.forms.test.tsx`. Sources saved before the fix keep "Salary" until edited. |
| M9 | Medium | **Reverting an earlier loan payment while a later one is completed makes the earlier one vanish.** I reverted the reducing loan's 10 Oct payment while 12 Nov was completed. The October occurrence then disappeared from the calendar and upcoming lists, so it can't be paid or seen again. The schedule positions itself from the payments-made count and assumes payments happen in order. The ₱19,800 balance is still spread over December to March, so no money is lost, but the owed payment isn't visible. **FIXED (2026-10-01):** each loan, card and installment plan now records which payments are paid (`paidOccurrenceIds`), kept by the ledger in the same transaction as the counter. The remaining payments fill the earliest unpaid months, so an out-of-order revert or an early payment no longer hides a month. Plans saved before the fix behave as before until their next payment. Tests: `tests/integration/lifecycle.test.ts` ("payments out of order", installment and card cases). |
| M10 | Medium | **The day panel's income doesn't match its opening-to-closing change for a payment completed early.** 12 Oct shows "Income +₱12,700" but only moves from ₱70,000 to ₱73,200, because the ₱9,500 freelance completed early counts on its scheduled day while its money moved on the day it was completed. |
| L6 | Low | **Total Debt mixes two bases.** Loans count principal only (the flat loan will really cost ₱66,000), while installments count the total with interest (₱37,800). Total ₱144,800. |
| L7 | Low | **Right-click "Add Income" or "Add Expense" just navigates to the manager page.** It doesn't open the wizard or pre-fill the clicked date. "Add Transaction" does pre-fill it. |
| L8 | Low | **Some schedule previews are empty or wrong.** The **one-time** preview is always empty, for income and expenses. The **daily** preview goes blank once an end date is set. The **Pay Full Balance** card's preview shows three monthly dates, although only one payment will happen. |
| UX | — | **The installment "Interest Rate" is ambiguous.** "5%" is applied as a flat 5% surcharge on the total (₱1,800), not an annual rate (which would be about ₱900 over 6 months). This is the parked decision, and the label doesn't say which. |
| UX | — | **Wrong card review label.** It says "Est. Min Payment" for the Fixed Amount (₱2,000) and Pay Full Balance (₱8,000) strategies. |
| UX | — | **Deactivate has no confirmation.** It applies immediately. |
| UX | — | **Duplicate tags on income detail cards.** They show the type and the category, e.g. "Salary · Salary". |
