"use client";

import { useCallback } from "react";
import { useFinancial } from "@/contexts/FinancialContext";
import {
  formatCurrency as formatCurrencyUtil,
  formatCurrencyWithSign as formatCurrencyWithSignUtil,
  getCurrencySymbol as getCurrencySymbolUtil,
} from "@/lib/utils/currency";

/**
 * Hook to access currency formatting functions with user's preferred currency
 */
export const useCurrency = () => {
  const { userProfile } = useFinancial();
  const currencyCode = userProfile?.preferences?.currency || "USD";

  const currencySymbol = getCurrencySymbolUtil(currencyCode);

  const formatCurrency = useCallback(
    (
      amount: number,
      options?: {
        showSymbol?: boolean;
        minimumFractionDigits?: number;
        maximumFractionDigits?: number;
        compact?: boolean;
      }
    ) => {
      return formatCurrencyUtil(amount, currencyCode, options);
    },
    [currencyCode]
  );

  const formatCurrencyWithSign = useCallback(
    (
      amount: number,
      options?: {
        minimumFractionDigits?: number;
        maximumFractionDigits?: number;
      }
    ) => {
      return formatCurrencyWithSignUtil(amount, currencyCode, options);
    },
    [currencyCode]
  );

  return {
    currencyCode,
    currencySymbol,
    formatCurrency,
    formatCurrencyWithSign,
  };
};

export default useCurrency;


