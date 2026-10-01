# Fix log: currency presentation and robustness

**Stream:** CURRENCY PRESENTATION AND ROBUSTNESS (Phase 3, with the numbers stream in a parallel worktree).
**Base:** `32736d5` on `claude/financial-projections-engine-g5fgkv`.
Every expected value in a new or rewritten test is derived by hand in a comment next to it. No test touches a real
backend (`tests/ui` mocks Firebase; the E2E build aliases it to in-browser fakes).

User decisions applied (not re-asked):

- **Every hard-coded currency symbol is removed. The default currency is PHP**: new profiles, profiles with a missing or
  invalid currency, and the formatter fallback.
- Firestore rules are untouched.

---

## 1. The formatter (`app/lib/utils/currency.ts`)

One module renders every amount; components reach it through `useCurrency()`. A table maps each supported code to a
symbol, a locale (digit grouping and decimal separator) and its minor-unit digits.

| Rule | Example | IDs |
| --- | --- | --- |
| Missing, empty, non-string or unsupported code resolves to **PHP** | `formatCurrency(5, "XYZ")` is `₱5.00` | default |
| Digits are the currency's own (2; **0 for JPY**), minimum == maximum, never 3 | `₱8,662.50`, `$138.40`, `₱564.88`; JPY `¥1,235` | UI-BAL-31, UI-DISP-10/11, E2E-JRN-21 |
| A caller may ask for FEWER digits (whole-number cards, calendar cells); never more than the currency has | `formatCurrency(1234.56, "PHP", { maximumFractionDigits: 0 })` is `₱1,235` | |
| **Signed amounts keep their cents** | `+₱1,234.56` (was `+₱1,235`) | UI-BAL-38/39, UI-DISP-21/22 |
| The **sign comes from the rounded value**: no negative zero | `-0.004` prints `₱0.00`; `-0.4` with 0 digits prints `₱0`; `-0.4` prints `-₱0.40` | UI-BAL-34, UI-DISP-22 |
| Minus before the symbol; a negative balance keeps it in calendar cells | `-$20`, `-₱500` | UI-BAL-37, UI-DISP-13, E2E-JRN-20 |
| Compact axis ticks: `k`, `M`, `B`, `T`, one decimal at most, sign first, a value that rounds up to 1000 moves to the next unit | `₱10M`, `-₱2.7k`, `₱1M` for 999,950 | UI-DISP-17/18 |
| NaN, Infinity, null and undefined print as zero (never "NaN") | `formatCurrency(NaN)` is `₱0.00` | E2E-ROB-10 |
| Settings and Dashboard share the formatter, so EUR / CAD / INR agree | `€1.234.567,50`, `C$1,234,567.50`, `₹12,34,567.50` | UI-BAL-28/29/30 |

Locale: there is no locale preference in the profile, so the locale follows the currency (EUR uses de-DE grouping,
INR lakh grouping, as the Dashboard already did). The symbol is always a prefix.

Call sites changed to the formatter: calendar day cells (`DayCell`), transaction rows in the day / range panel
(`TransactionItem`, was a hard-coded `$` plus 3-decimal `toLocaleString`), `WeekDayCell`, `MonthSummary`,
`PeriodBalanceSummary`, `CashFlowChart` and `IncomeExpenseChart` (axis ticks), KPI cards, `TransactionRow` (variance
was `₱-20.00`), the Overdue modal, the transaction modal, `QuickTransaction`, Settings (`BalanceSection` had its own
`Intl.NumberFormat("en-PH")`; its inputs and the threshold input had a literal peso sign), the Danger Zone copy, the
Selective Reset modal copy, the income form preview, the landing-page mock card and the AI prompt defaults.
`-{formatCurrency(x)}` in 7 places is now `formatCurrency(-x)`, and `{isIncome ? "+" : "-"}{formatCurrency(x)}` in 5 is
`formatCurrencyWithSign(±x)`, so a zero never prints `-₱0.00`. The KPI "Total Expenses" is a plain `formatCurrency(-x)`
(zero prints `₱0.00`, not `+₱0.00`).

### The regression guard

`tests/unit/currencyConvention.test.ts` (patterned on `dateConvention.test.ts`; it has a self-test) parses `app/**/*.{ts,tsx}`
with the TypeScript AST and fails on

1. a currency symbol in a string literal, template chunk or JSX text (so `${x}` is never a false positive);
2. `new Intl.NumberFormat` outside `currency.ts`;
3. `.toLocaleString(` outside `currency.ts`;
4. the literal `"USD"` outside `currency.ts`.

`currency.ts` is excluded wholesale (it IS the table). The allow-list has one entry, with its reason: the Settings
currency picker lists `USD - US Dollar` (data, not a fallback). A stale entry fails the test.

Unit tests of the formatter: `tests/unit/currency.test.ts` (27).

## 2. Default currency PHP

`createUserProfile` already wrote `PHP`. The fallbacks that were `"USD"` are gone: `useCurrency` (`resolveCurrency`), the
formatter, the AI prompt defaults. The Settings picker shows `PHP` for a profile whose stored code is missing, empty,
unsupported or lower-case (`resolveCurrency` in `PreferencesSection`). Nothing is rewritten in storage (a read-side
default); saving Preferences stores the picked code.
Tests: `tests/ui/balance/currency-default.test.tsx` (brand-new user; missing, empty, unsupported, lower-case codes: pesos on
Settings and Dashboard, input prefixes).

## 3. Ingestion guards (E2E-ROB-09 / ROB-10)

`app/lib/utils/sanitizeData.ts`, applied in `useFinancialSubscriptions` to the income-source, expense-rule and
stored-transaction snapshots. **Policy:**

- Nothing is dropped silently and **nothing is written back**: the stored document is untouched.
- A numeric **string** (`"1250.50"`) is a legacy way of storing a number: coerced, not reported.
- Any other unusable money field (null, undefined, NaN, Infinity, `"abc"`, `""`, an object) becomes **0**. A bad optional
  `actualAmount`, `variance` or occurrence-override `amount` is removed. Nested loan / card / installment numbers are
  repaired the same way; a field that is simply absent (legacy documents) is not an issue.
- A rule or source with a bad number is set **inactive** in memory, so it projects nothing and cannot feed a zero into a
  schedule. It stays visible under Income / Expenses so the user can fix or delete it.
- Every repaired record is reported as a `DataIssue`; `FinancialContext.dataIssues` exposes them and the protected
  layout renders a **non-blocking warning**: "N item(s) have invalid data", the first three names, "A missing or unreadable
  amount is shown as 0 and the item is switched off ... correct the amount, then switch it back on."

Root causes also fixed: the Calendar crash was `.toLocaleString()` on a null amount in `TransactionItem` (now the
formatter, which is NaN-safe); NaN on five screens came from `NaN` flowing through sums and `toFixed`.
No negative or zero `intervalWeeks` freeze: already fixed in Phase 1; its tests are kept
(`occurrencePipeline.test.ts` "terminates quickly and uses the default 2-week interval for a non-positive or non-numeric intervalWeeks" and E2E-ROB-08).
Tests: `tests/unit/sanitizeData.test.ts` (19), `tests/ui/display/ingestion.test.tsx` (null, text and NaN amounts on the
Dashboard, Calendar and Forecast: no crash, no NaN/undefined/null anywhere, notice present, stored document untouched,
zero writes; a hostile stored transaction keeps the ledger finite). The UI test fails without the sanitiser (NaN on the
Dashboard, `expected null to be 0`).

## 4. Error surfacing (E2E-ROB-04)

Audit of every mutation entry point in `app/components`:

| Entry point | Before | Now |
| --- | --- | --- |
| Expense / Income manager: delete, deactivate / activate | `await` with no catch: unhandled rejection, "Yes, Delete" stayed | caught; an error Alert on the page; the confirmation resolves either way; the record is untouched |
| Calendar drag-and-drop reschedule | unhandled rejection | caught; error Alert |
| Create / edit rule or source | caught inside the forms (forms stream) | unchanged |
| Transaction modal, manual-transaction form / delete | caught, shown in the dialog | unchanged |
| Settings: balance override / initial / recalculate, preferences, profile, reset, delete account | caught, shown | unchanged |
| `logout()` (sidebar, mobile nav, landing) | `await`, no catch | **left**: Firebase `signOut` clears local state and does not need the network; a rejection is not realistically reachable |

Tests: `tests/ui/rules/mutation-errors.test.tsx` (6; fault injected in the emulator), and the E2E-ROB-04 specs.

## 5. Delete Account (safety-critical)

**Sequence** (`AuthContext.deleteAccount`):

1. **(a) Reauthenticate.** Email users type their password in the confirmation (`ConfirmModal.requirePassword`; the button
   stays disabled until it is filled) and `reauthenticateUser` runs. Google users get `reauthenticateWithPopup`
   (`isGoogleOnlyUser`); the popup call is the first thing the click handler does, so it stays user-initiated.
   `requires-recent-login` can no longer strike midway.
2. **(b) Delete the data and the profile** (`deleteAccountData`, one atomic batch while the user is still authenticated, so
   real security rules that require a signed-in caller allow it).
3. **(c) Delete the auth user.**

**Failure points** (each has a test in `tests/ui/balance/delete-account.test.tsx`):

| Fails at | Result |
| --- | --- |
| (a) wrong password, popup closed, `requires-recent-login`, no password typed | nothing deleted, still signed in, "Incorrect password. Nothing was deleted." (or the popup / identity message) |
| (b) data batch rejected | nothing deleted, login kept, "Your account was not deleted: your data could not be removed (...). Nothing was changed. Please try again." |
| (c) login deletion refused after (b) | data is gone; `signOut`; local state cleared; the message "Your data was deleted, but we could not remove your sign-in (...). You have been signed out. Sign in again and use Delete Account to finish, or contact support." is stored in `sessionStorage` (`flashNotice`) and shown once on the login page |

The order itself is proven by observing the world at the instant of each auth call (`__beforeCall`): at
`reauthenticateWithCredential` everything still exists; at `deleteUser` the data and profile are already gone; the auth call
log reads `[reauthenticateWithCredential, deleteUser]`; the bystander's data is untouched.

Fakes (`e2e/fakes`, `tests/ui/harness/authFake.ts`) were made more faithful to real Firebase, nothing else:
`reauthenticateWithPopup` (rejects through `rejectReauth`, `auth/user-mismatch` for a different Google account),
`providerData` on the signed-in user (`password` or `google.com`, like the SDK), and a test-only `__beforeCall` hook in the
vitest auth fake. The password check of `reauthenticateWithCredential` already existed in the E2E fake.

## 6. Accessibility (UI-OBS-06)

`BaseModal` renders a screen-reader `Dialog.Description` for every modal (and a `Dialog.Title` when none is shown); the
mobile navigation drawer, the other `Dialog.Content` in the app, got a `DrawerDescription`. The harness's
`KNOWN_APP_WARNINGS` is now empty, so a new Radix warning fails strict-console mode.

## 7. AI prompt (E2E-ROB-12)

The prompt text moved to a pure module (`app/lib/services/analysisPrompt.ts`; `geminiService` re-exports `AnalysisContext`).
"Upcoming (next 30 days)" now lists projected rows dated **today .. today + 30 days, nearest first** (15 max). Still-projected
rows dated before today are in their own section, "Overdue (past due, still unpaid)", oldest first. An overdue-only list sends
no "Upcoming" heading. Tests: `tests/unit/geminiPrompt.test.ts` (4; the Gemini SDK is replaced and the real prompt captured,
today frozen at 2026-03-10). The E2E stub now runs the real builder and records `prompt`, so ROB-12 asserts the text the AI
would receive (the previous version re-implemented the selection inside the test, which could not observe the fix).

---

## 8. Defects fixed (IDs)

UI: UI-OBS-02, UI-OBS-06, UI-BAL-17, 18, 19, 28, 29, 30, 31, 32, 33, 37, 38, 39, UI-DISP-10, 11, 12, 13, 17, 18, 21, 22
(`knownDefect` -> plain `it`; only the marker was removed). UI-BAL-34 was already a plain test (Phase 2) and still passes.
UI-BAL-23 was a plain test; it is rewritten (see below).
E2E (markers removed after the specs were seen passing under Playwright): E2E-JRN-19, 20, 21, E2E-ROB-04 (delete and
deactivate), 09, 10, 12.

## 9. Passing tests rewritten (each changed expectation has a derivation)

| Test | Old expectation | Why it was wrong / the new value |
| --- | --- | --- |
| `reset-and-delete` "requires the account's own email ..." | button enabled after the email | An email user must also type the password (new confirmation); the password step is added, nothing loosened. |
| `reset-and-delete` UI-BAL-23 | a refused `deleteUser` ... the data is already gone | Pinned the login-first order the user decision replaces. Now: a refused identity check (`requires-recent-login`) deletes nothing (data, profile, login); the other failure points are in `delete-account.test.tsx`. |
| `ledger-ui` "when the login is deleted but the data batch is then rejected ..." | "Your sign-in was deleted, but your stored data could not be removed" | Old order. Now the batch is rejected before the login is touched: "Your account was not deleted ... Nothing was changed", `deleteUser` never called, still signed in. |
| `calendar.test` week view change badge | `+$1,195` | A signed amount keeps its cents: 2,000 - 804.8817 = 1,195.1183 -> **1,195.12**. |
| `crossScreen` calendar tiles | Expenses -2,931, Net 2,189 | The tiles print cents like the Dashboard: 2,930.8317 -> **-2,930.83**; net 2,189.1683 -> **2,189.17**. |
| `crossScreen` Upcoming Activity net | 570 | 2,000 - 1,429.8817 = 570.1183 -> **570.12**. |
| `mutation.test` (6 assertions) | whole-dollar tiles/nets: 660, -2,936, 2,184, 970, -3,011, -2,681, -2,680, 2,589 | cents: 660.1183 -> **660.12**; 2,935.8317 -> **-2,935.83**; 2,184.1683 -> **2,184.17**; 970.1183 -> **970.12**; 3,010.8317 -> **-3,010.83**; 2,680.8317 -> **-2,680.83**; April 2,679.8817 -> **-2,679.88**; 2,589.1683 -> **2,589.17**. |
| `forecast.test` | raw `-$200`, `+$5,120`, `+$2,189` | Default digits are 2, signed keep cents: **`-$200.00`**, **`+$5,120.00`**, **`+$2,189.17`** (2,189.1683). |
| E2E calendar tile pins (`dragdrop`, `menus-modals`, `weekend`, `navigation`, `timezones`) | `+$200`, `-$280`, `+$110`, `+$2,000`, `-$500`, `+$0`, `-$0` | The same rule: `+$200.00` etc.; zero expenses prints `$0.00` (was the negative-zero style `-$0`). `-$50 variance` is `-$50.00 variance`. |
| E2E `onboarding` / `timezones` | `getByText("+₱4,000.00")`, `"+$2,000.00"` unique; `"was $3,000"`, `"was $500"` exact | Period Comparison now prints the same signed amount with cents, so the figure appears in two or three widgets (`.first()`); its `was ...` lines use the default 2 digits (`was $3,000.00`, `was $500.00`). Same values, new format. |
| `harness/consoleCapture` | tolerated the Radix Description warning | fixed (UI-OBS-06); strict mode no longer tolerates it. |
| E2E-ROB-12 | re-implemented the prompt selection in the test | see section 7. |

No test was deleted or loosened.

## 10. Known-defect counts

| | Base 32736d5 | After |
| --- | --- | --- |
| `knownDefect(` UI (includes the helper definition) | 63 | 41 |
| `knownDefect(` E2E | 13 | 5 |
| `it.fails` unit / integration | unchanged (39) | unchanged |

## 11. Suite results

| Suite | Base | After |
| --- | --- | --- |
| `npm test` | 1,904 | **1,962** (+ currency 27, convention 8, sanitiser 19, prompt 4) |
| `npm run test:tz` | 74 | 74 |
| `vitest.config.ui.ts` (full) | 684 pass, 25 todo | **709 pass, 25 todo, 0 fail** (+25: default-PHP 5, ingestion 5, delete-account 9, mutation errors 6) |
| Playwright, 3 projects, 1 worker | 513 pass, 9 skipped | **513 pass, 9 skipped, 0 fail** (UTC 171, Manila + New York 342) |
| `tsc --noEmit` filtered to `app|tests|e2e` | empty | empty |

## 12. Leftovers and risks

- The calendar **Opening / Closing** figures and the month **Monthly Recurring / Total Debt** summary cards still print whole
  numbers (explicit `maximumFractionDigits: 0`); only signed amounts were made cent-exact. Decide whether balances in dense
  cards should round.
- `Total Expenses`, calendar `Expenses` and similar print `₱0.00` for zero (no sign); a zero-amount expense ROW prints
  `+₱0.00` (the sign of zero is `+`).
- The sanitiser deactivates a repaired rule **in memory** only. If the user edits it, the form loads the repaired values;
  saving a valid amount does not reactivate it (the notice says to switch it back on).
- The "N items have invalid data" notice is rendered by the protected layout, so it covers the real app but not a page
  mounted without the layout.
- `logout()` has no catch (not reachable in practice, see section 4).
- Calendar reschedule error surfacing has no automated test (dnd-kit pointer drags are covered by Playwright specs that
  do not inject faults).
- The LandingHero mock card shows pesos for logged-out visitors (default currency).
- `deleteAccount` for a Google user depends on a popup; a blocked popup is reported ("Google sign-in was cancelled or
  blocked. Nothing was deleted."). Real popup flows are not tested (no real backend).
