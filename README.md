# FinTrack - AI-Powered Personal Finance Management

<div align="center">

<img width="1200" height="auto" alt="Q&A Guru Banner" src="./docs/images/banner.png" />

**A comprehensive personal finance management application with AI-powered insights, flexible scheduling, and real-time cash flow projections.**

[![Next.js](https://img.shields.io/badge/Next.js-15.0-black?style=flat&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Firebase](https://img.shields.io/badge/Firebase-12.6-orange?style=flat&logo=firebase)](https://firebase.google.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?style=flat&logo=tailwind-css)](https://tailwindcss.com/)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [Core Modules](#-core-modules)
- [Project Structure](#-project-structure)
- [Configuration](#-configuration)
- [Usage Guide](#-usage-guide)
- [AI Integration](#-ai-integration)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🎯 Overview

**FinTrack** is a modern, full-featured personal finance management application designed to give you complete control over your financial life. Built with Next.js 15 and powered by Google's Gemini AI, FinTrack provides intelligent insights, flexible income/expense scheduling, and real-time cash flow projections.

### Why FinTrack?

- 💡 **AI-Powered Insights** - Get personalized financial advice from Google Gemini
- 📊 **Real-Time Projections** - See your financial future with daily balance calculations
- 🎯 **Flexible Scheduling** - Support for complex income patterns (bi-weekly, semi-monthly, etc.)
- 💳 **Comprehensive Expense Tracking** - Manage loans, credit cards, installments, and recurring bills
- 📅 **Interactive Calendar** - Visual representation of your cash flow with color-coded indicators
- 🔔 **Smart Alerts** - Bill coverage analysis and overdue transaction notifications
- 📈 **Financial Health Score** - Track your financial wellness with actionable metrics

---

## ✨ Key Features

### 💰 Income Management

- **Multiple Source Types**: Salary, Freelance, Business, Investment, Rental, Government, Gift
- **Flexible Scheduling**: One-time, Daily, Weekly, Bi-weekly, Semi-monthly, Monthly, Quarterly, Yearly
- **Variable Income Support**: Mark income as variable for estimation
- **Weekend Adjustments**: Automatically adjust payment dates for weekends
- **Multi-step Wizard**: Guided form for creating income sources with schedule preview

### 💸 Expense Management

- **6 Expense Types**:
  - **Fixed**: Regular bills (Netflix, gym membership)
  - **Variable**: Fluctuating costs (utilities, groceries)
  - **Cash Loan**: Amortized loans with diminishing interest
  - **Credit Card**: Revolving credit with APR tracking
  - **Installment**: Buy-now-pay-later / 0% financing plans
  - **One-Time**: Single expenses
- **Loan Features**:
  - Automatic EMI calculation
  - Amortization schedule with principal/interest breakdown
  - Progress tracking and payoff projections
- **Credit Card Features**:
  - Balance, APR, statement/due date tracking
  - Payment strategies: Minimum, Fixed, Full Balance
  - Payoff timeline projections
- **Priority Bills**: Mark critical expenses (rent, utilities)

### 📅 Financial Calendar

- **Month View**: Interactive grid showing daily transactions
- **Color-Coded Indicators**:
  - 🟢 Green: Income transactions
  - 🔴 Red: Expense transactions
  - Balance status colors (safe/warning/danger)
- **Day Details**: Click any day to view transaction breakdown and balance
- **Projection Engine**: Automatically generates future transactions from rules
- **Weekend Handling**: Smart date adjustments for scheduled payments

### 📊 Dashboard & Analytics

- **KPI Cards**:
  - Current Balance
  - Monthly Income
  - Monthly Expenses
  - Cash Runway (days until balance hits zero)
- **Cash Flow Chart**: 30-day projected balance visualization
- **Category Breakdown**: Pie chart of spending by category
- **Income vs Expense**: Comparative bar charts
- **Period Comparison**: Compare current vs previous periods
- **Financial Health Score**: Weighted score based on:
  - Cash runway (30%)
  - Savings rate (30%)
  - Bill payment rate (20%)
  - Balance trend (20%)

### 💳 Transaction Management

- **Mark Complete**: Record actual amounts with variance tracking
- **Skip Transactions**: Mark as skipped with optional notes
- **Partial Payments**: Pay portion now, schedule remainder
- **Automatic Balance Updates**: Real-time balance recalculation
- **Variance Analysis**: Track projected vs actual spending
- **Filter & Sort**: By status, type, date, amount

### 🤖 AI-Powered Forecast

- **Financial Health Analysis**: Comprehensive assessment of your finances
- **Spending Pattern Insights**: Identify trends and anomalies
- **Risk Identification**: Spot potential financial issues early
- **Actionable Recommendations**: Personalized advice for improvement
- **Savings Opportunities**: Find ways to optimize spending
- **Monthly Projections**: AI-generated forecasts for upcoming months

### 🔔 Alerts & Notifications

- **Bill Coverage Widget**: Next 14 days of bills with coverage status
- **Overdue Alerts**: Highlight missed transactions
- **Low Balance Warnings**: Alerts when balance drops below threshold
- **Upcoming Bills**: Quick view of pending payments
- **Risk Indicators**: Visual warnings for uncovered bills

### ⚙️ Settings & Customization

- **Profile Management**: Update display name and email
- **Current Balance**: Set and track your starting balance
- **Preferences**:
  - Currency selection
  - Date format
  - Start of week (Sunday/Monday)
  - Theme (Dark/Light)
  - Warning threshold for low balance
- **Danger Zone**: Clear all data or delete account

---

## 🛠️ Tech Stack

### Frontend

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **Language**: [TypeScript 5.8](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS 3.4](https://tailwindcss.com/)
- **UI Components**: Custom component library + [Radix UI](https://www.radix-ui.com/)
- **Forms**: [React Hook Form](https://react-hook-form.com/) + [Yup](https://github.com/jquense/yup)
- **Charts**: [Recharts 3.4](https://recharts.org/)
- **Icons**: [Material Symbols](https://fonts.google.com/icons)
- **Date Handling**: [Day.js](https://day.js.org/)

### Backend & Services

- **Database**: [Firebase Firestore](https://firebase.google.com/docs/firestore)
- **Authentication**: [Firebase Auth](https://firebase.google.com/docs/auth)
- **AI**: [Google Gemini API](https://ai.google.dev/)
- **Real-time Updates**: Firestore real-time subscriptions

### Development Tools

- **Linting**: ESLint 9 + Prettier
- **Package Manager**: npm
- **Build Tool**: Next.js built-in

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18.x or higher
- **npm** or **yarn**
- **Firebase Project** ([Create one here](https://console.firebase.google.com/))
- **Google Gemini API Key** ([Get one here](https://ai.google.dev/))

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/fintrack.git
   cd fintrack
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   Create a `.env.local` file in the root directory:

   ```env
   # Firebase Configuration
   NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

   # Google Gemini API
   GEMINI_API_KEY=your_gemini_api_key
   ```

4. **Set up Firebase**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Create a new project or select existing
   - Enable **Firestore Database**
   - Enable **Authentication** (Email/Password)
   - Copy configuration values to `.env.local`

5. **Run the development server**

   ```bash
   npm run dev
   ```

6. **Open your browser**

   Navigate to [http://localhost:3000](http://localhost:3000)

### Build for Production

```bash
npm run build
npm start
```

---

## 📦 Core Modules

### 1. Dashboard (`/dashboard`)

Central hub showing financial overview, KPIs, charts, and quick actions.

**Components:**

- KPI Cards (Balance, Income, Expenses, Runway)
- Cash Flow Chart (30-day projection)
- Category Pie Chart
- Income vs Expense Bar Chart
- Period Comparison
- Financial Health Score
- Upcoming Activity Widget
- Recurring Summary Widget
- Overdue Alerts

### 2. Financial Calendar (`/calendar`)

Interactive month view with daily balance calculations and transaction details.

**Features:**

- Month navigation
- Day cells with balance indicators
- Color-coded transactions
- Day detail sidebar
- Month summary statistics
- Transaction filtering

### 3. Income Manager (`/income`)

Manage all income sources with flexible scheduling options.

**Features:**

- Create/Edit/Delete income sources
- Multi-step wizard form
- Schedule preview
- Upcoming payments widget
- Active/Inactive toggle
- Variable amount support

### 4. Expense Manager (`/expenses`)

Comprehensive expense tracking with support for loans, credit cards, and installments.

**Features:**

- 6 expense types
- Multi-step wizard form
- Loan amortization calculator
- Credit card payoff projections
- Installment tracking
- Priority bill marking
- Upcoming bills widget

### 5. Transactions (`/transactions`)

View, filter, and manage all transactions (projected and actual).

**Features:**

- Complete/Skip/Partial payment
- Variance tracking
- Filter by status, type, date
- Sort by date, amount
- Bulk actions
- Transaction details

### 6. AI Forecast (`/forecast`)

AI-powered financial analysis and recommendations using Google Gemini.

**Features:**

- Financial health analysis
- Spending pattern insights
- Risk identification
- Actionable recommendations
- Monthly projections
- Metrics grid
- AI analysis panel

### 7. Settings (`/settings`)

Manage profile, preferences, and account settings.

**Features:**

- Profile management
- Current balance setting
- Preferences (currency, date format, theme)
- Warning threshold configuration
- Data management (clear all data)
- Account deletion

---

## 📁 Project Structure

```
fintrack/
├── app/
│   ├── (auth)/                      # Authentication routes
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── layout.tsx
│   ├── (protected)/                 # Protected routes
│   │   ├── dashboard/page.tsx
│   │   ├── calendar/page.tsx
│   │   ├── income/page.tsx
│   │   ├── expenses/page.tsx
│   │   ├── transactions/page.tsx
│   │   ├── forecast/page.tsx
│   │   ├── settings/page.tsx
│   │   └── layout.tsx
│   ├── api/                         # API routes
│   │   └── analyze-budget/route.ts
│   ├── components/
│   │   ├── common/                  # Reusable UI components
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Select.tsx
│   │   │   ├── Icon.tsx
│   │   │   └── ... (25+ components)
│   │   ├── formElements/            # React Hook Form components
│   │   │   ├── Form/
│   │   │   ├── FormInput/
│   │   │   ├── FormSelect/
│   │   │   └── ... (10 components)
│   │   ├── pages/                   # Page-specific components
│   │   │   ├── dashboard/
│   │   │   ├── calendar/
│   │   │   ├── expenses/
│   │   │   ├── income/
│   │   │   ├── transactions/
│   │   │   ├── forecast/
│   │   │   └── settings/
│   │   ├── widgets/                 # Reusable widgets
│   │   │   └── BillCoverageWidget.tsx
│   │   ├── ProtectedRoute.tsx
│   │   └── Sidebar.tsx
│   ├── contexts/
│   │   ├── AuthContext.tsx          # Authentication state
│   │   └── FinancialContext.tsx     # Financial data & operations
│   ├── lib/
│   │   ├── firebase/
│   │   │   ├── config.ts            # Firebase configuration
│   │   │   ├── auth.ts              # Auth functions
│   │   │   └── firestore.ts         # CRUD operations
│   │   ├── logic/
│   │   │   ├── amortization.ts      # Loan calculations
│   │   │   ├── balanceCalculator.ts # Daily balance logic
│   │   │   ├── projectionEngine.ts  # Transaction generation
│   │   │   ├── forecasting.ts       # Prediction algorithms
│   │   │   └── healthScore.ts       # Financial health scoring
│   │   ├── services/
│   │   │   └── geminiService.ts     # AI integration
│   │   ├── utils/
│   │   │   ├── cn.ts                # Class name utility
│   │   │   ├── currency.ts          # Currency formatting
│   │   │   └── dateUtils.ts         # Date utilities
│   │   ├── hooks/
│   │   │   └── useCurrency.ts       # Currency hook
│   │   ├── types.ts                 # TypeScript types
│   │   └── constants.ts             # Global constants
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx
│   ├── providers.tsx
│   └── icon.tsx
├── public/
│   └── favicon.svg
├── .env.local                       # Environment variables
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

---

## ⚙️ Configuration

### Firebase Collections

FinTrack uses the following Firestore collections:

```
/users/{userId}                      # User profiles
/income_sources/{sourceId}           # Income sources
/expense_rules/{ruleId}              # Expense rules
/transactions/{transactionId}        # All transactions
/balance_history/{snapshotId}        # Historical balances
/alerts/{alertId}                    # User alerts
```

### Environment Variables

| Variable                                   | Description             | Required |
| ------------------------------------------ | ----------------------- | -------- |
| `NEXT_PUBLIC_FIREBASE_API_KEY`             | Firebase API key        | ✅       |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`         | Firebase auth domain    | ✅       |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`          | Firebase project ID     | ✅       |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`      | Firebase storage bucket | ✅       |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase sender ID      | ✅       |
| `NEXT_PUBLIC_FIREBASE_APP_ID`              | Firebase app ID         | ✅       |
| `GEMINI_API_KEY`                           | Google Gemini API key   | ✅       |

---

## 📖 Usage Guide

### Creating an Income Source

1. Navigate to **Income Manager** (`/income`)
2. Click **"Add Income Source"**
3. Follow the multi-step wizard:
   - **Type**: Select income type (Salary, Freelance, etc.)
   - **Details**: Enter name, amount, category
   - **Schedule**: Choose frequency and specific dates
   - **Review**: Preview schedule and confirm

### Creating an Expense Rule

1. Navigate to **Expense Manager** (`/expenses`)
2. Click **"Add Expense Rule"**
3. Follow the multi-step wizard:
   - **Type**: Select expense type (Fixed, Loan, Credit Card, etc.)
   - **Details**: Enter name, amount, category
   - **Schedule**: Set frequency and payment dates
   - **Special Config**: (For loans/credit cards) Enter loan details
   - **Review**: Confirm and create

### Completing a Transaction

1. Go to **Transactions** or **Dashboard**
2. Find the transaction you want to complete
3. Click **"Mark Complete"**
4. Enter actual amount (pre-filled with projected)
5. Optionally adjust date or add notes
6. Click **"Complete Transaction"**
7. Balance automatically updates

### Viewing Cash Flow

1. Navigate to **Financial Calendar** (`/calendar`)
2. View month grid with daily balances
3. Click any day to see:
   - Opening balance
   - All transactions
   - Closing balance
   - Balance status (safe/warning/danger)

### Getting AI Insights

1. Navigate to **AI Forecast** (`/forecast`)
2. View current metrics and monthly overview
3. Click **"Analyze with AI"**
4. Wait for Gemini to generate analysis
5. Review insights, recommendations, and warnings

---

## 🤖 AI Integration

FinTrack uses **Google Gemini 1.5 Flash** for intelligent financial analysis.

### What the AI Analyzes

- **Income Patterns**: Regularity, variability, growth trends
- **Expense Patterns**: Category breakdown, recurring vs one-time
- **Cash Flow**: Runway, projected shortfalls, surplus periods
- **Bill Coverage**: Ability to pay upcoming bills
- **Variance**: Projected vs actual spending differences
- **Financial Health**: Overall wellness score and trends

### AI-Generated Insights

- 📊 **Summary**: High-level overview of financial situation
- 💡 **Insights**: Key observations about spending and income
- ✅ **Recommendations**: Actionable steps to improve finances
- ⚠️ **Warnings**: Potential risks and issues to address
- 💰 **Opportunities**: Ways to save money or increase income

### API Endpoint

```typescript
POST /api/analyze-budget
Content-Type: application/json

{
  "transactions": [...],
  "incomeSources": [...],
  "expenseRules": [...],
  "currentBalance": 5000,
  "billCoverage": {...},
  "varianceReport": {...}
}
```

---

## 🎨 Design System

FinTrack uses a custom design system built on Tailwind CSS:

### Color Palette

- **Primary**: Cyan (`#06b6d4`) - Actions, links, highlights
- **Success**: Green (`#22c55e`) - Positive states, income
- **Warning**: Amber (`#eab308`) - Caution, low balance
- **Danger**: Red (`#ef4444`) - Errors, expenses, critical
- **Background**: Dark grays (`#101622`, `#151c2c`, `#1f2937`)

### Common Components

All UI built from reusable components in `components/common/`:

- `Button` - 5 variants (primary, secondary, ghost, danger, icon)
- `Card` - Container with padding options
- `Input` - Text/number inputs with labels
- `Select` - Dropdown with options
- `Badge` - Status indicators
- `Icon` - Material Symbols icons
- `LoadingSpinner` - Loading states
- `PageHeader` - Page titles with actions
- And 20+ more...

---

## 🧪 Development

### Available Scripts

```bash
# Development
npm run dev              # Start dev server

# Production
npm run build            # Build for production
npm start                # Start production server

# Code Quality
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint issues
npm run format           # Format with Prettier
npm run format:check     # Check formatting
```

### Code Style

- **TypeScript**: Strict mode enabled
- **ESLint**: Next.js recommended + Prettier
- **Prettier**: 2-space indentation, semicolons
- **Naming**:
  - Components: PascalCase
  - Files: PascalCase for components, camelCase for utilities
  - Functions: camelCase
  - Constants: SCREAMING_SNAKE_CASE

---

## 🔐 Security

- **Authentication**: Firebase Auth with email/password
- **Authorization**: User-scoped data queries
- **Environment Variables**: Sensitive keys in `.env.local`
- **Firestore Rules**: User can only access their own data
- **API Routes**: Server-side API key handling

---

## 🚧 Future Enhancements

- [ ] Push notifications for upcoming bills
- [ ] Email reminders
- [ ] Export to CSV/PDF
- [ ] Multi-currency support
- [ ] Shared family finances
- [ ] Budget goals and tracking
- [ ] Receipt scanning (OCR)
- [ ] Bank account integration (Plaid)
- [ ] Mobile app (React Native)
- [ ] Recurring transaction templates
- [ ] Investment tracking
- [ ] Tax estimation

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow existing code style and patterns
- Write TypeScript with proper types
- Use common components from `components/common/`
- Test thoroughly before submitting
- Update documentation as needed

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Next.js Team** - Amazing React framework
- **Firebase Team** - Excellent backend services
- **Google AI** - Gemini API for intelligent insights
- **Vercel** - Hosting and deployment
- **Radix UI** - Accessible component primitives
- **Tailwind CSS** - Utility-first CSS framework

---

## 🌟 Show Your Support

If you find FinTrack useful, please consider:

- ⭐ Starring the repository
- 🐦 Sharing on social media
- 🤝 Contributing to the project
- 💰 Sponsoring development

---

<div align="center">

**Built with ❤️ using Next.js, TypeScript, and Google Gemini AI**

[Website]() • [Documentation]() • [Demo]()

</div>
