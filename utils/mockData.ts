import { Transaction, IncomeRule } from '../types';

export const MOCK_INCOME_RULES: IncomeRule[] = [
  {
    id: '1',
    name: 'Tech Corp Salary',
    amount: 3200,
    frequency: 'monthly-dates',
    specificDates: [5, 20],
    weekendAdjustment: 'before',
  },
  {
    id: '2',
    name: 'Freelance Gig',
    amount: 800,
    frequency: 'bi-weekly',
    weekendAdjustment: 'none',
  }
];

// Helper to generate dates for the current month
const getDates = () => {
  const dates = [];
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  for (let i = 1; i <= daysInMonth; i++) {
    dates.push(new Date(year, month, i).toISOString().split('T')[0]);
  }
  return dates;
};

const currentMonthDates = getDates();

export const MOCK_TRANSACTIONS: Transaction[] = [
  { id: 't1', name: 'Grocery Store', amount: 150.50, date: currentMonthDates[2], type: 'expense', category: 'Groceries', status: 'completed' },
  { id: 't2', name: 'Tech Corp Salary', amount: 1600, date: currentMonthDates[4], type: 'income', category: 'Salary', status: 'completed' },
  { id: 't3', name: 'Electric Bill', amount: 120.00, date: currentMonthDates[8], type: 'bill', category: 'Utilities', status: 'pending' },
  { id: 't4', name: 'Gym Membership', amount: 45.00, date: currentMonthDates[0], type: 'expense', category: 'Health', status: 'completed' },
  { id: 't5', name: 'Car Loan', amount: 350.00, date: currentMonthDates[14], type: 'loan', category: 'Finance', status: 'pending' },
  { id: 't6', name: 'Netflix', amount: 15.99, date: currentMonthDates[10], type: 'bill', category: 'Entertainment', status: 'pending' },
  { id: 't7', name: 'Tech Corp Salary', amount: 1600, date: currentMonthDates[19], type: 'income', category: 'Salary', status: 'projected' },
  { id: 't8', name: 'Freelance Gig', amount: 800, date: currentMonthDates[13], type: 'income', category: 'Freelance', status: 'projected' },
  { id: 't9', name: 'Rent Payment', amount: 1200.00, date: currentMonthDates[0], type: 'bill', category: 'Housing', status: 'completed' },
  { id: 't10', name: 'Coffee Shop', amount: 6.50, date: currentMonthDates[3], type: 'expense', category: 'Dining', status: 'completed' },
  { id: 't11', name: 'Internet Bill', amount: 89.99, date: currentMonthDates[18], type: 'bill', category: 'Utilities', status: 'projected' },
  { id: 't12', name: 'Student Loan', amount: 200.00, date: currentMonthDates[25], type: 'loan', category: 'Finance', status: 'projected' },
];

export const CATEGORIES = ['Groceries', 'Utilities', 'Entertainment', 'Housing', 'Transport', 'Health', 'Dining', 'Finance', 'Salary', 'Freelance'];
