import { describe, expect, it } from "vitest";
import {
  DEFAULT_CURRENCY,
  formatCompactCurrency,
  formatCurrency,
  formatCurrencyWithSign,
  getCurrencyDecimals,
  getCurrencySymbol,
  resolveCurrency,
} from "@/lib/utils/currency";

/**
 * The one currency formatter. Every expected string is derived by hand from the rules:
 *   - default currency PHP (missing / invalid code -> PHP);
 *   - decimals = the currency's own (2; 0 for JPY), minimum == maximum, never 3 (UI-DISP-10/11, UI-BAL-31);
 *   - signed amounts keep their cents (UI-BAL-38/39, UI-DISP-21/22);
 *   - the sign comes from the ROUNDED value: no "-₱0.00" (UI-BAL-34, UI-DISP-22);
 *   - compact axis ticks: k / M / B / T, one decimal at most, sign first (UI-DISP-17/18).
 */

describe("the default currency is PHP", () => {
  it("is exported as PHP", () => {
    expect(DEFAULT_CURRENCY).toBe("PHP");
  });

  it.each([undefined, null, "", "XYZ", "usd ", 42 as unknown as string])(
    "resolves %j to PHP",
    (code) => {
      expect(resolveCurrency(code)).toBe("PHP");
      expect(getCurrencySymbol(code)).toBe("₱");
      expect(formatCurrency(5, code)).toBe("₱5.00");
    }
  );

  it("keeps every supported code", () => {
    for (const code of ["PHP", "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR"]) {
      expect(resolveCurrency(code)).toBe(code);
    }
  });

  it("has the symbols the Settings picker implies", () => {
    expect(["PHP", "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR"].map(getCurrencySymbol)).toEqual([
      "₱",
      "$",
      "€",
      "£",
      "C$",
      "A$",
      "¥",
      "₹",
    ]);
  });
});

describe("formatCurrency", () => {
  it("prints cents with minimum == maximum digits (no 1,234.5)", () => {
    expect(formatCurrency(1234.56, "PHP")).toBe("₱1,234.56");
    expect(formatCurrency(1234.5, "PHP")).toBe("₱1,234.50"); // UI-BAL-31, E2E-JRN-21: 8,662.5 -> 8,662.50
    expect(formatCurrency(8662.5, "PHP")).toBe("₱8,662.50");
    expect(formatCurrency(138.4, "USD")).toBe("$138.40"); // UI-DISP-11
    expect(formatCurrency(1000, "USD")).toBe("$1,000.00");
  });

  it("never prints 3 decimals", () => {
    expect(formatCurrency(564.882, "PHP")).toBe("₱564.88"); // UI-DISP-10
    expect(formatCurrency(564.8817, "USD", { maximumFractionDigits: 3 })).toBe("$564.88");
    expect(formatCurrency(1.999, "USD")).toBe("$2.00");
  });

  it("honours an explicit smaller precision, with min == max", () => {
    expect(formatCurrency(1234.56, "PHP", { maximumFractionDigits: 0 })).toBe("₱1,235");
    expect(formatCurrency(1234.5, "PHP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe("₱1,234.50");
    // the old default pair (min 0, max 2) must not reintroduce ragged decimals
    expect(formatCurrency(1234.5, "PHP", { minimumFractionDigits: 0, maximumFractionDigits: 2 })).toBe("₱1,234.50");
  });

  it("keeps the minus sign, before the symbol", () => {
    expect(formatCurrency(-20, "USD")).toBe("-$20.00");
    expect(formatCurrency(-1234.56, "PHP")).toBe("-₱1,234.56");
    expect(formatCurrency(-500, "PHP", { maximumFractionDigits: 0 })).toBe("-₱500"); // UI-BAL-37 calendar cell
  });

  it("takes the sign from the rounded value (no negative zero)", () => {
    expect(formatCurrency(-0.004, "PHP")).toBe("₱0.00"); // rounds to 0.00
    expect(formatCurrency(-0, "PHP")).toBe("₱0.00");
    expect(formatCurrency(-0.4, "PHP", { maximumFractionDigits: 0 })).toBe("₱0"); // rounds to 0
    expect(formatCurrency(-0.5, "PHP", { maximumFractionDigits: 0 })).toBe("-₱1"); // half rounds away from zero
    expect(formatCurrency(-0.4, "PHP")).toBe("-₱0.40");
  });

  it("can drop the symbol", () => {
    expect(formatCurrency(1234.5, "PHP", { showSymbol: false })).toBe("1,234.50");
    expect(formatCurrency(-1234.5, "PHP", { showSymbol: false })).toBe("-1,234.50");
    expect(formatCurrency(-0.001, "PHP", { showSymbol: false })).toBe("0.00");
  });

  it("uses zero decimals for JPY whatever the caller asks", () => {
    expect(getCurrencyDecimals("JPY")).toBe(0);
    expect(getCurrencyDecimals("PHP")).toBe(2);
    expect(formatCurrency(1234.56, "JPY")).toBe("¥1,235");
    expect(formatCurrency(1234.56, "JPY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe("¥1,235");
  });

  it("is deterministic per currency: one table of symbol + locale", () => {
    // 1,234,567.5 on every supported currency (Settings and Dashboard share this: UI-BAL-28/29/30)
    expect(formatCurrency(1_234_567.5, "PHP")).toBe("₱1,234,567.50");
    expect(formatCurrency(1_234_567.5, "USD")).toBe("$1,234,567.50");
    expect(formatCurrency(1_234_567.5, "EUR")).toBe("€1.234.567,50"); // de-DE grouping
    expect(formatCurrency(1_234_567.5, "GBP")).toBe("£1,234,567.50");
    expect(formatCurrency(1_234_567.5, "CAD")).toBe("C$1,234,567.50");
    expect(formatCurrency(1_234_567.5, "AUD")).toBe("A$1,234,567.50");
    expect(formatCurrency(1_234_567.5, "JPY")).toBe("¥1,234,568");
    expect(formatCurrency(1_234_567.5, "INR")).toBe("₹12,34,567.50"); // lakh grouping: 12,34,567
  });

  it("never prints NaN or Infinity", () => {
    expect(formatCurrency(NaN, "PHP")).toBe("₱0.00");
    expect(formatCurrency(Infinity, "PHP")).toBe("₱0.00");
    expect(formatCurrency(undefined as unknown as number, "PHP")).toBe("₱0.00");
    expect(formatCurrency(null as unknown as number, "PHP")).toBe("₱0.00");
  });
});

describe("formatCurrencyWithSign", () => {
  it("keeps the cents on signed amounts", () => {
    expect(formatCurrencyWithSign(1234.56, "PHP")).toBe("+₱1,234.56"); // UI-BAL-38 / UI-DISP-21
    expect(formatCurrencyWithSign(0.49, "USD")).toBe("+$0.49"); // UI-BAL-39
    expect(formatCurrencyWithSign(-1234.56, "PHP")).toBe("-₱1,234.56");
    expect(formatCurrencyWithSign(8662.5, "PHP")).toBe("+₱8,662.50");
  });

  it("takes the sign from the rounded value", () => {
    expect(formatCurrencyWithSign(-0.4, "PHP")).toBe("-₱0.40"); // UI-DISP-22: was "-₱0"
    expect(formatCurrencyWithSign(-0.004, "PHP")).toBe("+₱0.00"); // rounds to zero, never "-₱0.00"
    expect(formatCurrencyWithSign(0, "PHP")).toBe("+₱0.00");
    expect(formatCurrencyWithSign(-0.4, "PHP", { maximumFractionDigits: 0 })).toBe("+₱0");
  });

  it("uses the currency's own decimals", () => {
    expect(formatCurrencyWithSign(1234.56, "JPY")).toBe("+¥1,235");
    expect(formatCurrencyWithSign(-2.5, "EUR")).toBe("-€2,50");
  });

  it("defaults to PHP and never prints NaN", () => {
    expect(formatCurrencyWithSign(5)).toBe("+₱5.00");
    expect(formatCurrencyWithSign(NaN, "USD")).toBe("+$0.00");
  });
});

describe("formatCompactCurrency (chart axis ticks)", () => {
  it("scales to k, M, B and T instead of printing thousands of thousands", () => {
    expect(formatCompactCurrency(10_000_000, "PHP")).toBe("₱10M"); // UI-DISP-18: was "$10000000k"
    expect(formatCompactCurrency(2_500_000, "PHP")).toBe("₱2.5M");
    expect(formatCompactCurrency(123_456_789, "PHP")).toBe("₱123.5M");
    expect(formatCompactCurrency(9_876_543_210, "USD")).toBe("$9.9B");
    expect(formatCompactCurrency(1_500_000_000_000, "USD")).toBe("$1.5T");
    expect(formatCompactCurrency(10_000, "PHP")).toBe("₱10k");
    expect(formatCompactCurrency(1000, "PHP")).toBe("₱1k");
    expect(formatCompactCurrency(2500, "PHP")).toBe("₱2.5k");
  });

  it("puts the sign before the symbol", () => {
    expect(formatCompactCurrency(-2700, "USD")).toBe("-$2.7k"); // UI-DISP-17: was "$-2.7k"
    expect(formatCompactCurrency(-10_000_000, "PHP")).toBe("-₱10M");
  });

  it("rolls a rounded-up value into the next unit", () => {
    expect(formatCompactCurrency(999_950, "PHP")).toBe("₱1M"); // 999.95k rounds to 1000.0k
    expect(formatCompactCurrency(999_940, "PHP")).toBe("₱999.9k");
  });

  it("prints small values in full with the currency's decimals", () => {
    expect(formatCompactCurrency(0, "PHP")).toBe("₱0");
    expect(formatCompactCurrency(500, "PHP")).toBe("₱500");
    expect(formatCompactCurrency(999, "PHP")).toBe("₱999");
    expect(formatCompactCurrency(12.5, "PHP")).toBe("₱12.50");
    expect(formatCompactCurrency(-0.001, "PHP")).toBe("₱0");
  });

  it("works for JPY and an unknown currency, and never prints NaN", () => {
    expect(formatCompactCurrency(2500, "JPY")).toBe("¥2.5k");
    expect(formatCompactCurrency(2500, "ZZZ")).toBe("₱2.5k");
    expect(formatCompactCurrency(NaN, "PHP")).toBe("₱0");
  });
});
