---
trigger: model_decision
description: Governs project organization, file naming conventions, and import patterns for the Next.js App Router structure. Apply when creating new features, components, or reorganizing code.
---

# Folder Structure & Organization Rules

## Core Principle

Follow the established Next.js App Router structure with clear separation of concerns. Each folder has a specific purpose and naming convention.

## Project Structure Overview

```
app/
├── (auth)/                    # Auth route group (unprotected)
│   ├── layout.tsx
│   └── login/
│       └── page.tsx
├── (protected)/               # Protected route group
│   ├── layout.tsx
│   └── [feature]/
│       └── page.tsx
├── api/                       # API routes
│   └── [endpoint]/
│       └── route.ts
├── components/                # All React components
│   ├── common/                # Reusable UI primitives
│   ├── formElements/          # Form-specific components
│   ├── pages/                 # Page-specific component modules
│   └── widgets/               # Standalone reusable widgets
├── contexts/                  # React Context providers
├── lib/                       # Utilities, services, and logic
│   ├── constants.ts           # Global constants
│   ├── types.ts               # Global TypeScript types
│   ├── firebase/              # Firebase-specific code
│   ├── logic/                 # Business logic functions
│   ├── services/              # External service integrations
│   └── utils/                 # Utility functions
├── globals.css                # Global styles
├── layout.tsx                 # Root layout
├── page.tsx                   # Root page
└── providers.tsx              # Provider composition
```

## Route Groups

### Auth Routes `(auth)/`

Unprotected routes for authentication flows:

```tsx
// (auth)/layout.tsx - Auth-specific layout (no sidebar)
// (auth)/login/page.tsx - Login page
```

### Protected Routes `(protected)/`

Routes requiring authentication:

```tsx
// (protected)/layout.tsx - Contains ProtectedRoute wrapper and Sidebar
// (protected)/[feature]/page.tsx - Feature pages
```

**Page Pattern:**

```tsx
// (protected)/expenses/page.tsx
"use client";

import { ExpenseManager } from "@/components/pages/expenses";

export default function ExpensesPage() {
  return <ExpenseManager />;
}
```

## Components Organization

### 1. Common Components `components/common/`

Reusable UI primitives. Each component is a single file with named export:

```
components/common/
├── Button.tsx          # Button component
├── Card.tsx            # Card container
├── Input.tsx           # Input field
├── Select.tsx          # Select dropdown
├── index.ts            # Barrel exports
└── ...
```

**Export Pattern:**

```tsx
// components/common/index.ts
export { Button, type ButtonProps } from "./Button";
export { Card, type CardProps } from "./Card";
```

### 2. Form Elements `components/formElements/`

React Hook Form integrated components. Each in its own folder with `index.tsx`:

```
components/formElements/
├── Form/
│   └── index.tsx
│   ├── FormInput/
│   │   └── index.tsx
│   └── FormSelect/
│       └── index.tsx
└── index.ts
```

**Export Pattern:**

```tsx
// components/formElements/index.ts
export { default as Form } from "./Form";
export { default as FormInput } from "./FormInput";
```

### 3. Page Components `components/pages/`

Feature-specific components organized by page:

```
components/pages/
└── [feature]/
    ├── [FeatureName].tsx       # Main manager component
    ├── components/             # Sub-components
    │   ├── [SubComponent].tsx
    │   └── [ComplexComponent]/
    │       ├── index.tsx
    │       ├── formHelpers.ts
    │       └── components/
    │           └── ...
    ├── constants.ts            # Feature-specific constants
    ├── types.ts                # Feature-specific types (if needed)
    └── index.ts                # Barrel exports
```

**Example - Expenses:**

```
components/pages/expenses/
├── ExpenseManager.tsx          # Main component
├── components/
│   ├── ExpenseRuleCard.tsx
│   ├── ExpenseRuleDetail.tsx
│   └── ExpenseRuleForm/        # Complex form with sub-components
│       ├── index.tsx
│       ├── formHelpers.ts
│       ├── constants.ts
│       ├── components/
│       │   ├── StandardDetailsForm.tsx
│       │   ├── LoanDetailsForm.tsx
│       │   └── ...
│       └── steps/              # Multi-step form steps
│           ├── DetailsStep.tsx
│           ├── ScheduleStep.tsx
│           └── ...
├── constants.ts
└── index.ts
```

### 4. Widgets `components/widgets/`

Standalone reusable widgets that can be placed on multiple pages:

```
components/widgets/
├── BillCoverageWidget.tsx
└── index.ts
```

## Lib Organization

### Types `lib/types.ts`

All global TypeScript interfaces and types in one file:

```tsx
// Organized with section comments
// ============================================================================
// USER PROFILE
// ============================================================================

export interface UserProfile { ... }

// ============================================================================
// TRANSACTIONS
// ============================================================================

export type TransactionType = "income" | "expense";
export interface Transaction { ... }
```

### Constants `lib/constants.ts`

Global application constants.

### Firebase `lib/firebase/`

Firebase-related code:

```
lib/firebase/
├── config.ts       # Firebase configuration
├── auth.ts         # Authentication functions
└── firestore.ts    # Firestore CRUD operations
```

### Logic `lib/logic/`

Pure business logic functions:

```
lib/logic/
├── amortization.ts        # Loan calculation logic
├── balanceCalculator.ts   # Balance computation
├── forecasting.ts         # Prediction logic
└── projectionEngine.ts    # Transaction projection
```

### Services `lib/services/`

External service integrations:

```
lib/services/
└── geminiService.ts    # AI service integration
```

### Utils `lib/utils/`

Small utility functions:

```
lib/utils/
└── cn.ts    # className utility (clsx + tailwind-merge)
```

## Naming Conventions

### Files

| Type              | Convention | Example               |
| ----------------- | ---------- | --------------------- |
| Page components   | PascalCase | `ExpenseManager.tsx`  |
| Common components | PascalCase | `Button.tsx`          |
| Form elements     | PascalCase | `FormInput/index.tsx` |
| Helpers           | camelCase  | `formHelpers.ts`      |
| Constants         | camelCase  | `constants.ts`        |
| Types             | camelCase  | `types.ts`            |
| Utils             | camelCase  | `cn.ts`               |

### Folders

| Type              | Convention           | Example            |
| ----------------- | -------------------- | ------------------ |
| Route groups      | kebab-case in parens | `(protected)`      |
| Routes            | kebab-case           | `analyze-budget`   |
| Component folders | PascalCase           | `ExpenseRuleForm/` |
| Utility folders   | camelCase            | `formElements/`    |

### Exports

- **Named exports** for components in `common/`
- **Default exports** for main components in `pages/` and `formElements/`
- **Barrel exports** via `index.ts` files

## Import Patterns

Use path aliases:

```tsx
// ✅ CORRECT
import { Button, Card } from "@/components/common";
import { Form, FormInput } from "@/components/formElements";
import { useFinancial } from "@/contexts/FinancialContext";
import { Transaction } from "@/lib/types";
import { cn } from "@/lib/utils/cn";

// ❌ WRONG
import { Button } from "../../../common/Button";
```

## Creating New Features

When adding a new feature (e.g., "budgets"):

1. Create page route: `(protected)/budgets/page.tsx`
2. Create component module: `components/pages/budgets/`
3. Add main component: `BudgetManager.tsx`
4. Add sub-components: `components/`
5. Add constants: `constants.ts`
6. Add types if feature-specific: `types.ts`
7. Create barrel export: `index.ts`
8. Add global types to `lib/types.ts`
