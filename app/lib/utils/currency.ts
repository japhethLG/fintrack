// Currency symbols mapping
const CURRENCY_SYMBOLS: Record<string, string> = {
  PHP: "₱",
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "C$",
  AUD: "A$",
  JPY: "¥",
  INR: "₹",
};

// Currency locale mapping for proper number formatting
const CURRENCY_LOCALES: Record<string, string> = {
  PHP: "en-PH",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  CAD: "en-CA",
  AUD: "en-AU",
  JPY: "ja-JP",
  INR: "en-IN",
};

/**
 * Get the currency symbol for a given currency code
 */
export const getCurrencySymbol = (currencyCode: string = "USD"): string => {
  return CURRENCY_SYMBOLS[currencyCode] || "$";
};

/**
 * Format a number as currency with the specified currency code
 */
export const formatCurrency = (
  amount: number,
  currencyCode: string = "USD",
  options: {
    showSymbol?: boolean;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    compact?: boolean;
  } = {}
): string => {
  const {
    showSymbol = true,
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    compact = false,
  } = options;

  const symbol = CURRENCY_SYMBOLS[currencyCode] || "$";
  const locale = CURRENCY_LOCALES[currencyCode] || "en-US";

  // For JPY, typically no decimal places
  const minDecimals = currencyCode === "JPY" ? 0 : minimumFractionDigits;
  const maxDecimals = currencyCode === "JPY" ? 0 : maximumFractionDigits;

  const formattedNumber = new Intl.NumberFormat(locale, {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
    notation: compact ? "compact" : "standard",
  }).format(Math.abs(amount));

  if (!showSymbol) {
    return amount < 0 ? `-${formattedNumber}` : formattedNumber;
  }

  // Handle negative numbers
  if (amount < 0) {
    return `-${symbol}${formattedNumber}`;
  }

  return `${symbol}${formattedNumber}`;
};

/**
 * Format currency with sign (+ or -)
 */
export const formatCurrencyWithSign = (
  amount: number,
  currencyCode: string = "USD",
  options: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  } = {}
): string => {
  const { minimumFractionDigits = 0, maximumFractionDigits = 0 } = options;

  const symbol = CURRENCY_SYMBOLS[currencyCode] || "$";
  const locale = CURRENCY_LOCALES[currencyCode] || "en-US";

  const minDecimals = currencyCode === "JPY" ? 0 : minimumFractionDigits;
  const maxDecimals = currencyCode === "JPY" ? 0 : maximumFractionDigits;

  const formattedNumber = new Intl.NumberFormat(locale, {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  }).format(Math.abs(amount));

  if (amount >= 0) {
    return `+${symbol}${formattedNumber}`;
  }

  return `-${symbol}${formattedNumber}`;
};

export default {
  getCurrencySymbol,
  formatCurrency,
  formatCurrencyWithSign,
};


