export type TransactionType = "income" | "expense" | "bill" | "loan";

export interface Transaction {
  id: string;
  name: string;
  amount: number;
  date: string; // ISO Date string
  type: TransactionType;
  category: string;
  status: "completed" | "pending" | "projected";
}

export interface IncomeRule {
  id: string;
  name: string;
  amount: number;
  frequency: "weekly" | "bi-weekly" | "monthly-dates" | "monthly-specific";
  specificDates?: number[]; // e.g., [5, 20]
  weekendAdjustment: "before" | "after" | "none";
}

export interface MonthlyStats {
  income: number;
  expenses: number;
  balance: number;
}

export interface ForecastData {
  date: string;
  balance: number;
}
