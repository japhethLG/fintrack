---
name: Transaction Modal Improvements
overview: Enhance the CompleteTransactionModal to support a "Projected" status option (revert), allow changing scheduled dates, and simplify the UI with a dropdown status selector and unified Save button.
todos:
  - id: backend-revert
    content: Add revertToProjectedAction with balance reversal in transactionActions.ts
    status: pending
  - id: context-types
    content: Update FinancialContext types and useFinancialActions hook
    status: pending
  - id: form-helpers
    content: Update formHelpers.ts with new mode type and scheduledDate field
    status: pending
  - id: modal-ui
    content: Redesign modal with Select dropdown, scheduled date input, and Save button
    status: pending
  - id: update-consumers
    content: Add new handlers to Dashboard, CalendarView, TransactionsManager
    status: pending
---

# Transaction Modal Improvements

## Current State

The [`CompleteTransactionModal`](app/components/pages/transactions/components/CompleteTransactionModal/index.tsx) uses toggle buttons for Complete/Skip modes. It lacks:

- Option to revert completed/skipped transactions back to "Projected" status
- Ability to change the scheduled date (despite calendar drag-and-drop support)

## Changes

### 1. Backend: Add Revert-to-Projected Action

Add `revertToProjectedAction` in [`transactionActions.ts`](app/contexts/FinancialContext/actions/transactionActions.ts):

- Fetch the stored transaction and its source (income source or expense rule)
- If status was "completed", reverse the balance adjustment
- **Preserve data via occurrence override**:
- `scheduledDate` - if different from what source would generate
- `amount` - if `projectedAmount` differs from source amount
- `notes` - if present on the stored transaction
- Delete the stored transaction (projection engine regenerates it with override applied)

Update [`types.ts`](app/contexts/FinancialContext/types.ts) and [`useFinancialActions.ts`](app/contexts/FinancialContext/hooks/useFinancialActions.ts) to expose `revertToProjected(id: string)`.

### 2. Modal UI Redesign

Update [`CompleteTransactionModal`](app/components/pages/transactions/components/CompleteTransactionModal/index.tsx):

- **Status Selection**: Replace toggle buttons with a `Select` dropdown:
- Options: "Projected", "Completed", "Skipped"
- Default: current transaction status

- **Scheduled Date Field**: Add editable date input for rescheduling (always visible, updates via `rescheduleTransaction`)

- **Conditional Fields**:
- "Completed" mode: Show actual amount, actual date, variance indicator
- "Skipped" mode: Show skip warning message
- "Projected" mode: Show revert confirmation message

- **Single Save Button**: Replace mode-specific buttons with one "Save" button that:
- Calls `onComplete` for "completed" status
- Calls `onSkip` for "skipped" status
- Calls `onRevertToProjected` for "projected" status
- Calls `onReschedule` if scheduled date changed

### 3. Update Form Helpers

In [`formHelpers.ts`](app/components/pages/transactions/components/CompleteTransactionModal/formHelpers.ts):

- Change mode type: `"projected" | "complete" | "skip"`
- Add `scheduledDate` field
- Update validation schema

### 4. Update Modal Consumers

Add handlers in these files:

- [`Dashboard.tsx`](app/components/pages/dashboard/Dashboard.tsx)
- [`CalendarView.tsx`](app/components/pages/calendar/CalendarView.tsx)
- [`TransactionsManager.tsx`](app/components/pages/transactions/TransactionsManager.tsx)

Pass new props: `onRevertToProjected`, `onReschedule`