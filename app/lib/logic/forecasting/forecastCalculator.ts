/**
 * Balance forecast calculations
 */

import { ForecastData, Transaction } from "@/lib/types";
import { dateFromDayNumber, dayNumberOfDate, formatDate } from "@/lib/utils/dateUtils";

/**
 * Calculate future balance forecast based on projected transactions
 * @param currentBalance - Current account balance
 * @param allTransactions - All transactions to consider
 * @param startDate - Start date for forecast (its LOCAL calendar day; time of day is ignored)
 * @param daysToForecast - Number of days to forecast (default: 90)
 * @returns Array of daily forecast data points
 */
export const calculateForecast = (
  currentBalance: number,
  allTransactions: Transaction[],
  startDate: Date,
  daysToForecast: number = 90
): ForecastData[] => {
  const forecast: ForecastData[] = [];
  let runningBalance = currentBalance;

  // Only care about transactions from TODAY onwards
  // Assumption: currentBalance is the ACTUAL balance TODAY
  // (Local calendar day, like every stored scheduledDate: never the UTC day.)
  const todayStr = formatDate(startDate);
  const relevantTransactions = allTransactions.filter(
    (t) => t.scheduledDate >= todayStr && t.status === "projected"
  );

  // Group transactions by date
  const transactionsByDate: Record<string, Transaction[]> = {};
  relevantTransactions.forEach((t) => {
    if (!transactionsByDate[t.scheduledDate]) {
      transactionsByDate[t.scheduledDate] = [];
    }
    transactionsByDate[t.scheduledDate].push(t);
  });

  // Iterate days by index, not by stepping a wall-clock instant (DST-safe).
  const startDay = dayNumberOfDate(startDate);

  for (let i = 0; i < daysToForecast; i++) {
    const dateStr = formatDate(dateFromDayNumber(startDay + i));
    const daysTransactions = transactionsByDate[dateStr] || [];

    // Process transactions for the day
    daysTransactions.forEach((t) => {
      if (t.type === "income") {
        runningBalance += t.projectedAmount;
      } else {
        runningBalance -= t.projectedAmount;
      }
    });

    forecast.push({
      date: dateStr,
      balance: runningBalance,
    });
  }

  return forecast;
};
