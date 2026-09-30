# Cluster C9

Currency precision/format: withSign rounds away cents, ragged min-fraction-digits, -0 sign, float accumulation, parseFloat grouping separators

Source files implicated:
- app/lib/utils/currency.ts
- app/lib/logic/balanceCalculator/computedBalance.ts
- app/components/pages/settings/components/BalanceSection.tsx

## Member findings (from first-round analysts)

### [F29] (high/bug) formatCurrencyWithSign defaults to 0 decimal places, silently rounding away cents on real money amounts (including variance)
- File: app/lib/utils/currency.ts : 80-106
- Why wrong: formatCurrencyWithSign defaults maximumFractionDigits to 0, so Intl.NumberFormat rounds the amount to the nearest whole currency unit and never shows cents unless a caller explicitly overrides the option. Money values that legitimately carry cents are therefore displayed wrong. This is the function used to render the actual-vs-projected variance and per-day income totals, where cents are exactly the figures the user cares about. The default for a money formatter should preserve cents (2 fraction digits for non-JPY currencies).
- Scenario: In TransactionModal (app/components/modals/components/TransactionModal/index.tsx:369) the variance is shown via formatCurrencyWithSign(variance) with no options. If projectedAmount = 100.00 and the user enters actualAmount = 100.49, variance = 0.49. The UI renders '+₱0 variance from expected' (0.49 rounds to 0). With a 0.50 variance it renders '+₱1'. Likewise DayDetailSidebar (app/components/pages/calendar/components/DayDetailSidebar.tsx:62) shows formatCurrencyWithSign(income); a day with ₱1234.56 of income displays '+₱1,235'. Correct output should be '+₱0.49' and '+₱1,234.56'.
- Suggested fix: Default maximumFractionDigits (and the conventional minimumFractionDigits) to 2 for non-JPY currencies in formatCurrencyWithSign, matching formatCurrency. Better, derive decimals from the currency's ISO minor-unit (0 for JPY, 2 for most others) instead of a hard-coded 0, and let callers opt into compact/whole-number display explicitly.
- First-round verification: UNVERIFIED (verifier crashed)

### [F30] (medium/correctness) formatCurrency uses minimumFractionDigits=0, producing inconsistent/ragged money display (e.g. ₱1,234.5 and ₱1,234)
- File: app/lib/utils/currency.ts : 45-63
- Why wrong: With minimumFractionDigits=0 and maximumFractionDigits=2, money is rendered with a variable number of decimal places: a whole amount shows no decimals, an amount ending in .50 shows a single decimal, and only amounts with two non-zero decimal digits show full cents. Standard money presentation for a 2-minor-unit currency is a fixed 2 decimals. This makes amounts look like quantities rather than currency and produces a misleading column of ragged values (₱1,234, ₱1,234.5, ₱1,234.57).
- Scenario: formatCurrency(1234) -> '₱1,234' (no cents), formatCurrency(1234.5) -> '₱1,234.5' (one decimal), formatCurrency(1234.567) -> '₱1,234.57'. A list mixing these reads inconsistently. Expected for PHP/USD/EUR: '₱1,234.00', '₱1,234.50', '₱1,234.57'.
- Suggested fix: Default minimumFractionDigits to 2 for non-JPY currencies (0 for JPY), so money always shows the currency's standard minor-unit precision. Keep an explicit option for callers (e.g. compact KPI tiles) that genuinely want no decimals.
- First-round verification: UNVERIFIED (verifier crashed)

### [F31] (low/edge-case) Negative amounts that round to zero render a spurious minus sign ('-₱0')
- File: app/lib/utils/currency.ts : 63-74
- Why wrong: The sign is decided from the raw amount (amount < 0) while the magnitude is rounded independently by Intl.NumberFormat. When a small negative value rounds to 0 at the chosen precision, the sign branch still prepends '-', yielding a displayed '-₱0' / '-0'. A correct money formatter determines the sign from the already-rounded value so that a magnitude of zero is never shown as negative.
- Scenario: formatCurrency(-0.001) -> '-₱0'. formatCurrencyWithSign(-0.4) with its default 0 decimals -> magnitude rounds to 0 but sign branch gives '-₱0'. Float residue from balance math is a realistic source of tiny negatives: e.g. 0.30 - 0.20 - 0.10 = -2.78e-17, which would display as '-₱0'. Correct output is '₱0' (or '+₱0').
- Suggested fix: Round the amount to the target precision first, then derive the sign from the rounded value, treating an exact 0 (and -0) as non-negative. E.g. compute rounded = roundToCents(amount); use rounded < 0 for the sign and Math.abs(rounded) for the magnitude.
- First-round verification: UNVERIFIED (verifier crashed)

### [F32] (medium/logic-error) Money is stored and accumulated as IEEE-754 floats with no cent-rounding, so balances drift by sub-cent residue
- File: app/lib/logic/balanceCalculator/computedBalance.ts : 16-34
- Why wrong: All money in this app is stored as a JS number (float) — see UserProfile.currentBalance/initialBalance and Transaction.projectedAmount/actualAmount in types.ts — and parsed via parseFloat (e.g. BalanceSection.tsx:75/90, ManualTransactionForm/formHelpers.ts:78, TransactionModal index.tsx:86/111). computeBalanceFromTransactions then accumulates these floats with += / -= and the result is written back to the stored balance via syncComputedBalance -> updateUserBalance with no rounding to the minor unit. Repeated float addition introduces representation error, and because the unrounded result is persisted as the source-of-truth balance, the error is durable, not just a display artifact. The proper approach is to store money as integer cents, or at minimum round each accumulation step (or the final balance) to 2 decimals before persisting.
- Scenario: Ten completed income transactions of 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.20 sum to a stored balance of 1.0999999999999999 instead of 1.10 (verified in Node). Settings then shows a 'Balance mismatch detected' warning whenever |currentBalance - computedBalance| > 0.01 (BalanceSection.tsx:218) even though the data is consistent, and the persisted balance is no longer an exact cent value.
- Suggested fix: Represent money as integer cents end-to-end, or round to 2 decimals (currency minor units) at each accumulation and before persisting: balance = Math.round((balance + amount) * 100) / 100. Apply the same rounding in syncComputedBalance before updateUserBalance so the stored source-of-truth balance is always an exact cent value.
- First-round verification: UNVERIFIED (verifier crashed)

### [F33] (medium/edge-case) parseFloat used on user-entered money strings cannot handle grouping separators and silently truncates trailing garbage
- File: app/components/pages/settings/components/BalanceSection.tsx : 21-28, 75, 90
- Why wrong: User-entered balance strings are converted with parseFloat and stored directly as the account balance. parseFloat stops at the first character it cannot parse and ignores the rest, so it mis-parses any input containing a thousands separator or stray text instead of rejecting it. The same pattern feeds stored money in ManualTransactionForm/formHelpers.ts:78 and TransactionModal index.tsx:86/111. For currencies whose locale uses ',' as the decimal separator (this app maps EUR to de-DE), a user typing the decimal as they see it in the UI gets a wildly wrong stored value. The yup is-number test also passes because parseFloat returns a (wrong) finite number rather than NaN.
- Scenario: A user with a ₱1,234.56 balance types '1,234.56' into the Override Current Balance field. The yup test parseFloat('1,234.56') = 1, so validation passes, and updateUserBalance stores 1 — the balance becomes ₱1.00. For an EUR user typing '1234,56' (de-DE decimal comma), parseFloat returns 1234, storing €1234 instead of €1234.56. Correct behavior: normalize/validate the localized number and reject ambiguous input, or store 1234.56.
- Suggested fix: Strip grouping separators and normalize the decimal mark per the active locale before parsing, and use a strict numeric parse (e.g. Number(normalized) with a regex/Intl-based validator) that returns NaN for any leftover non-numeric characters, so malformed input is rejected rather than silently truncated.
- First-round verification: UNVERIFIED (verifier crashed)
