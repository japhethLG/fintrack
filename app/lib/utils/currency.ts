/**
 * THE currency formatter. Every amount shown to a user goes through this module (in components via
 * `useCurrency()`); nothing else in app/ hard-codes a symbol or builds its own number format
 * (guarded by tests/unit/currencyConvention.test.ts).
 *
 * Rules:
 *  - The default currency is PHP. A missing or unknown code resolves to PHP.
 *  - Decimals are the currency's own (2; 0 for JPY). Minimum == maximum digits, so there is never a
 *    ragged "1,234.5", and never 3 decimals. A caller may ask for FEWER decimals (whole-number cards).
 *  - The sign comes from the ROUNDED value: -0.004 prints "₱0.00", never "-₱0.00".
 *  - The minus sign sits before the symbol: "-₱2.7k", "-$20.00".
 *  - Non-finite input (NaN, Infinity, null) prints as zero; it never leaks "NaN" into the UI.
 */

export const DEFAULT_CURRENCY = "PHP";

interface CurrencyInfo {
  symbol: string;
  /** Locale used for digit grouping / decimal separator. */
  locale: string;
  /** Minor-unit digits of the currency. */
  decimals: number;
}

const CURRENCIES: Record<string, CurrencyInfo> = {
  PHP: { symbol: "₱", locale: "en-PH", decimals: 2 },
  USD: { symbol: "$", locale: "en-US", decimals: 2 },
  EUR: { symbol: "€", locale: "de-DE", decimals: 2 },
  GBP: { symbol: "£", locale: "en-GB", decimals: 2 },
  CAD: { symbol: "C$", locale: "en-CA", decimals: 2 },
  AUD: { symbol: "A$", locale: "en-AU", decimals: 2 },
  JPY: { symbol: "¥", locale: "ja-JP", decimals: 0 },
  INR: { symbol: "₹", locale: "en-IN", decimals: 2 },
};

/**
 * The currency to use for a stored code: the code itself when supported, else the default (PHP).
 * Handles undefined, null, "" and garbage from legacy profiles.
 */
export const resolveCurrency = (currencyCode?: string | null): string =>
  typeof currencyCode === "string" &&
  Object.prototype.hasOwnProperty.call(CURRENCIES, currencyCode)
    ? currencyCode
    : DEFAULT_CURRENCY;

const infoFor = (currencyCode?: string | null): CurrencyInfo => CURRENCIES[resolveCurrency(currencyCode)];

/** The currency symbol for a currency code (PHP's when missing or unknown). */
export const getCurrencySymbol = (currencyCode?: string | null): string => infoFor(currencyCode).symbol;

/** Minor-unit digits for a currency code (2; 0 for JPY). */
export const getCurrencyDecimals = (currencyCode?: string | null): number =>
  infoFor(currencyCode).decimals;

const finite = (amount: number): number => (Number.isFinite(amount) ? amount : 0);

/** Digits to print: what the caller asked for, never more than the currency has, min == max. */
const digitsFor = (
  info: CurrencyInfo,
  options: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): number => {
  const asked = options.maximumFractionDigits ?? options.minimumFractionDigits ?? info.decimals;
  return Math.max(0, Math.min(Math.trunc(asked), info.decimals));
};

/** The magnitude as text with exactly `digits` decimals, and whether it rounds to non-zero. */
const magnitude = (info: CurrencyInfo, amount: number, digits: number) => {
  const text = new Intl.NumberFormat(info.locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(finite(amount)));
  return { text, isZero: !/[1-9]/.test(text) };
};

export interface FormatOptions {
  showSymbol?: boolean;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

/**
 * Format a number as currency, e.g. `formatCurrency(-1234.5, "PHP")` -> "-₱1,234.50".
 */
export const formatCurrency = (
  amount: number,
  currencyCode?: string | null,
  options: FormatOptions & { compact?: boolean } = {}
): string => {
  const { showSymbol = true, compact = false } = options;
  if (compact) return formatCompactCurrency(amount, currencyCode, { showSymbol });

  const info = infoFor(currencyCode);
  const { text, isZero } = magnitude(info, amount, digitsFor(info, options));
  const sign = finite(amount) < 0 && !isZero ? "-" : "";
  return `${sign}${showSymbol ? info.symbol : ""}${text}`;
};

/**
 * Format with an explicit sign, e.g. "+₱1,234.56" / "-₱20.00". Cents are kept (UI-BAL-38/39).
 * A value that rounds to zero is "+": the sign follows the rounded figure.
 */
export const formatCurrencyWithSign = (
  amount: number,
  currencyCode?: string | null,
  options: Omit<FormatOptions, "showSymbol"> = {}
): string => {
  const info = infoFor(currencyCode);
  const { text, isZero } = magnitude(info, amount, digitsFor(info, options));
  const negative = finite(amount) < 0 && !isZero;
  return `${negative ? "-" : "+"}${info.symbol}${text}`;
};

const COMPACT_UNITS: Array<{ value: number; suffix: string }> = [
  { value: 1e12, suffix: "T" },
  { value: 1e9, suffix: "B" },
  { value: 1e6, suffix: "M" },
  { value: 1e3, suffix: "k" },
];

/**
 * Compact form for chart axis ticks: "₱10M", "-₱2.7k", "₱999", "₱12.50".
 * One decimal at most above 1,000; below that the figure prints in full.
 */
export const formatCompactCurrency = (
  amount: number,
  currencyCode?: string | null,
  options: { showSymbol?: boolean } = {}
): string => {
  const { showSymbol = true } = options;
  const info = infoFor(currencyCode);
  const value = finite(amount);
  const abs = Math.abs(value);
  const symbol = showSymbol ? info.symbol : "";

  // Below 1,000: whole figures print without decimals, fractional ones with the currency's own.
  if (abs < 1000) {
    const factor = 10 ** info.decimals;
    const digits = Number.isInteger(Math.round(abs * factor) / factor) ? 0 : info.decimals;
    const { text, isZero } = magnitude(info, value, digits);
    return `${value < 0 && !isZero ? "-" : ""}${symbol}${text}`;
  }

  // Pick the largest unit that leaves at least 1 before rounding; a value that rounds up to 1000 of
  // its unit (999.95k) moves to the next unit (1M).
  let index = COMPACT_UNITS.findIndex((u) => abs >= u.value);
  if (index === -1) index = COMPACT_UNITS.length - 1;
  let scaled = Math.round((abs / COMPACT_UNITS[index].value) * 10) / 10;
  if (scaled >= 1000 && index > 0) {
    index -= 1;
    scaled = Math.round((abs / COMPACT_UNITS[index].value) * 10) / 10;
  }
  const text = new Intl.NumberFormat(info.locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(scaled);
  return `${value < 0 ? "-" : ""}${symbol}${text}${COMPACT_UNITS[index].suffix}`;
};

export default {
  DEFAULT_CURRENCY,
  resolveCurrency,
  getCurrencySymbol,
  getCurrencyDecimals,
  formatCurrency,
  formatCurrencyWithSign,
  formatCompactCurrency,
};
