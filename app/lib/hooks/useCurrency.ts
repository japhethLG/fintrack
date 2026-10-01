"use client";

import { useCallback } from "react";
import { useFinancial } from "@/contexts/FinancialContext";
import {
  formatCompactCurrency as formatCompactCurrencyUtil,
  formatCurrency as formatCurrencyUtil,
  formatCurrencyWithSign as formatCurrencyWithSignUtil,
  getCurrencySymbol as getCurrencySymbolUtil,
  resolveCurrency,
  type FormatOptions,
} from "@/lib/utils/currency";

/**
 * Hook to access currency formatting functions with user's preferred currency.
 * A missing or unknown currency resolves to the default (PHP).
 */
export const useCurrency = () => {
  const { userProfile } = useFinancial();
  const currencyCode = resolveCurrency(userProfile?.preferences?.currency);

  const currencySymbol = getCurrencySymbolUtil(currencyCode);

  const formatCurrency = useCallback(
    (amount: number, options?: FormatOptions & { compact?: boolean }) => {
      return formatCurrencyUtil(amount, currencyCode, options);
    },
    [currencyCode]
  );

  const formatCurrencyWithSign = useCallback(
    (amount: number, options?: Omit<FormatOptions, "showSymbol">) => {
      return formatCurrencyWithSignUtil(amount, currencyCode, options);
    },
    [currencyCode]
  );

  const formatCompactCurrency = useCallback(
    (amount: number) => formatCompactCurrencyUtil(amount, currencyCode),
    [currencyCode]
  );

  return {
    currencyCode,
    currencySymbol,
    formatCurrency,
    formatCurrencyWithSign,
    formatCompactCurrency,
  };
};

export default useCurrency;
