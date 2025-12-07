# FinTrack Technical Specification & Requirements

## 1. Executive Summary

FinTrack is a personal finance management application that provides users with:

- **Maximum flexibility** for income scheduling (salary, freelance, bi-weekly, semi-monthly, etc.)
- **Comprehensive expense tracking** including loans, credit cards, and installments
- **Interactive calendar** showing projected cash flow with daily balance calculations
- **Bill coverage analysis** to predict if upcoming bills can be paid
- **Actual vs projected tracking** for variance analysis
- **AI-powered insights** via Google Gemini integration
- **Full Firebase integration** for data persistence

## 2. Data Models

### 2.1 User Profile (`users` collection)

```typescript
interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  currentBalance: number;
  balanceLastUpdatedAt: string;
  preferences: {
    currency: string;
    dateFormat: string;
    startOfWeek: 0 | 1;
    theme: "dark" | "light";
    defaultWarningThreshold: number;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 2.2 Income Sources (`income_sources` collection)

```typescript
interface IncomeSource {
  id: string;
  userId: string;
  name: string;
  sourceType:
    | "salary"
    | "freelance"
    | "business"
    | "investment"
    | "rental"
    | "government"
    | "gift"
    | "other";
  amount: number;
  isVariableAmount: boolean;
  frequency:
    | "one-time"
    | "daily"
    | "weekly"
    | "bi-weekly"
    | "semi-monthly"
    | "monthly"
    | "quarterly"
    | "yearly";
  startDate: string;
  endDate?: string;
  scheduleConfig: {
    specificDays?: number[];
    dayOfWeek?: number;
    dayOfMonth?: number;
    intervalWeeks?: number;
    monthOfYear?: number;
  };
  weekendAdjustment: "before" | "after" | "none";
  category: string;
  notes?: string;
  color?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 2.3 Expense Rules (`expense_rules` collection)

```typescript
interface ExpenseRule {
  id: string;
  userId: string;
  name: string;
  expenseType: "fixed" | "variable" | "cash_loan" | "credit_card" | "installment" | "one-time";
  category: ExpenseCategory;
  amount: number;
  isVariableAmount: boolean;
  frequency: Frequency;
  startDate: string;
  endDate?: string;
  scheduleConfig: ScheduleConfig;
  weekendAdjustment: "before" | "after" | "none";
  loanConfig?: LoanConfig;
  creditConfig?: CreditConfig;
  installmentConfig?: InstallmentConfig;
  notes?: string;
  color?: string;
  isActive: boolean;
  isPriority: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 2.4 Transactions (`transactions` collection)

```typescript
interface Transaction {
  id: string;
  userId: string;
  sourceType: "income_source" | "expense_rule" | "manual";
  sourceId?: string;
  name: string;
  type: "income" | "expense";
  category: string;
  projectedAmount: number;
  actualAmount?: number;
  variance?: number;
  scheduledDate: string;
  actualDate?: string;
  status: "projected" | "pending" | "completed" | "skipped";
  paymentBreakdown?: PaymentBreakdown;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
}
```

### 2.5 Balance History (`balance_history` collection)

```typescript
interface BalanceSnapshot {
  id: string;
  userId: string;
  date: string;
  openingBalance: number;
  closingBalance: number;
  totalIncome: number;
  totalExpenses: number;
  projectedIncome: number;
  projectedExpenses: number;
  isReconciled: boolean;
  createdAt: Timestamp;
}
```

## 3. Core Features

### 3.1 Income Management

- **Source Types**: Salary, Freelance, Business, Investment, Rental, Government, Gift, Other
- **Flexible Scheduling**:
  - One-time, Daily, Weekly, Bi-weekly, Semi-monthly, Monthly, Quarterly, Yearly
  - Specific dates (e.g., 15th and 30th)
  - Weekend adjustment (pay Friday if weekend, pay Monday, or no adjustment)
- **Variable Amounts**: Mark income as variable for estimates
- **Multi-step Wizard**: Guided form for creating income sources
- **Schedule Preview**: Visual calendar showing upcoming occurrences

### 3.2 Expense Management

- **Expense Types**:
  - **Fixed**: Same amount every time (Netflix, gym)
  - **Variable**: Amount varies (utilities, groceries)
  - **Cash Loan**: Amortized with diminishing interest
  - **Credit Card**: Revolving credit with APR
  - **Installment**: BNPL / 0% plans
  - **One-time**: Single expense
- **Loan Features**:
  - Principal, interest rate, term configuration
  - Automatic EMI calculation
  - Amortization schedule with principal/interest breakdown
  - Progress tracking
- **Credit Card Features**:
  - Balance, APR, statement/due dates
  - Payment strategies: Minimum, Fixed, Full Balance
  - Payoff projection
- **Priority Bills**: Mark important bills (rent, utilities)

### 3.3 Calendar & Projections

- **Month View**: Grid with daily balance indicators
- **Color Coding**:
  - Green: Income
  - Red: Expense
  - Color-coded balance status (safe/warning/danger)
- **Day Details**: Click to view transactions and balance breakdown
- **Projection Engine**:
  - Generates future transactions from income sources and expense rules
  - Handles complex schedules (bi-weekly, semi-monthly, etc.)
  - Weekend adjustments
  - Loan amortization schedules
  - Credit card projections

### 3.4 Transaction Completion

- **Mark Complete Modal**:
  - Enter actual amount (pre-filled with projected)
  - Variance calculation and display
  - Optional date adjustment
  - Notes field
- **Skip Option**: Mark transactions as skipped with reason
- **Balance Updates**: Automatic balance recalculation on completion

### 3.5 Dashboard & Alerts

- **KPI Cards**:
  - Current Balance
  - Monthly Income
  - Monthly Expenses
  - Cash Runway
- **Cash Flow Chart**: 30-day projected balance visualization
- **Category Breakdown**: Pie chart of spending categories
- **Bill Coverage Widget**:
  - Next 14 days of bills
  - Coverage status per bill
  - Risk indicators for uncovered bills
  - Projected end balance
- **Upcoming Transactions**: Quick access to pending items
- **Overdue Alerts**: Highlight missed transactions

### 3.6 AI Forecast (Gemini)

- **Financial Health Analysis**
- **Spending Pattern Insights**
- **Risk Identification**
- **Actionable Recommendations**
- **Savings Opportunities**

## 4. Technical Architecture

### 4.1 Tech Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Charts**: Recharts
- **Database**: Firebase Firestore
- **Auth**: Firebase Auth
- **AI**: Google Gemini API

### 4.2 Project Structure

```
app/
├── (auth)/
│   ├── login/page.tsx
│   └── layout.tsx
├── (protected)/
│   ├── dashboard/page.tsx
│   ├── calendar/page.tsx
│   ├── income/page.tsx
│   ├── expenses/page.tsx
│   ├── transactions/page.tsx
│   ├── forecast/page.tsx
│   └── layout.tsx
├── components/
│   ├── common/           # Reusable UI components
│   ├── forms/            # Form components
│   │   ├── IncomeSourceForm.tsx
│   │   ├── ExpenseRuleForm.tsx
│   │   └── CompleteTransactionModal.tsx
│   ├── pages/            # Page components
│   │   ├── Dashboard.tsx
│   │   ├── CalendarView.tsx
│   │   ├── IncomeManager.tsx
│   │   ├── ExpenseManager.tsx
│   │   └── Forecast.tsx
│   └── widgets/          # Widget components
│       └── BillCoverageWidget.tsx
├── contexts/
│   ├── AuthContext.tsx
│   └── FinancialContext.tsx
└── lib/
    ├── firebase/
    │   ├── config.ts
    │   ├── auth.ts
    │   └── firestore.ts
    ├── logic/
    │   ├── amortization.ts
    │   ├── balanceCalculator.ts
    │   ├── projectionEngine.ts
    │   └── recurrence.ts
    ├── services/
    │   └── geminiService.ts
    ├── types.ts
    └── utils/
        ├── cn.ts
        └── mockData.ts
```

### 4.3 State Management

- **FinancialContext**: Central data provider
  - Real-time Firestore subscriptions
  - CRUD operations for all entities
  - Computed daily balances
  - Bill coverage reports
  - Alert management

### 4.4 Firebase Collections

```
/users/{userId}
/income_sources/{sourceId}
/expense_rules/{ruleId}
/transactions/{transactionId}
/balance_history/{snapshotId}
/alerts/{alertId}
```

## 5. Implementation Status

### Completed ✅

- [x] Core data models and types
- [x] Firebase Firestore CRUD operations
- [x] Financial Context with real-time subscriptions
- [x] Income source management with wizard form
- [x] Expense rule management (fixed, variable, loans, credit cards, installments)
- [x] Projection engine for transaction generation
- [x] Amortization calculator for loans
- [x] Credit card projection calculator
- [x] Daily balance calculator
- [x] Bill coverage report
- [x] Calendar view with balance indicators
- [x] Transaction completion modal
- [x] Dashboard with KPI cards and charts
- [x] Bill coverage widget
- [x] AI forecast integration with Gemini
- [x] Sidebar navigation update

### Future Enhancements

- [ ] Push notifications for upcoming bills
- [ ] Email reminders
- [ ] Export to CSV/PDF
- [ ] Multi-currency support
- [ ] Shared family finances
- [ ] Budget goals and tracking
- [ ] Receipt scanning (OCR)
- [ ] Bank account integration

## 6. Environment Variables

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_GEMINI_API_KEY=
```

## 7. Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## 8. Common Components

All UI components should be imported from `@/components/common`:

- `Button` - All interactive buttons
- `Card` - Content containers
- `Input` - Form inputs
- `Select` - Dropdown selects
- `Badge` - Status indicators
- `Icon` - Material icons
- `Alert` - Alert messages
- `Table` - Data tables
- `LoadingSpinner` - Loading states
- `PageHeader` - Page titles and actions

See `.cursorrules` for detailed component usage guidelines.
