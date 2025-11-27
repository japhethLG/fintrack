import { Transaction, ForecastData } from "@/lib/types";

export const calculateForecast = (
  currentBalance: number,
  allTransactions: Transaction[],
  startDate: Date,
  daysToForecast: number = 90
): ForecastData[] => {
  const forecast: ForecastData[] = [];
  let runningBalance = currentBalance;

  // 1. Group transactions by date
  // Consider only 'pending' and 'projected' for future balance calculation?
  // Or if 'allTransactions' includes past, we should start balance from now.
  // Assumption: currentBalance is the ACTUAL balance TODAY.
  // We only care about transactions from TODAY onwards.

  const todayStr = startDate.toISOString().split("T")[0];
  const relevantTransactions = allTransactions.filter(
    (t) => t.scheduledDate >= todayStr && (t.status === "pending" || t.status === "projected")
  );

  const transactionsByDate: Record<string, Transaction[]> = {};
  relevantTransactions.forEach((t) => {
    if (!transactionsByDate[t.scheduledDate]) {
      transactionsByDate[t.scheduledDate] = [];
    }
    transactionsByDate[t.scheduledDate].push(t);
  });

  const currentDate = new Date(startDate);

  for (let i = 0; i < daysToForecast; i++) {
    const dateStr = currentDate.toISOString().split("T")[0];
    const daysTransactions = transactionsByDate[dateStr] || [];

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

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return forecast;
};
