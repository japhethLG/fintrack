---
trigger: model_decision
description: Governs usage of reusable UI components from `components/common/` instead of raw HTML elements. Apply when building any UI with buttons, inputs, forms, cards, or interactive elements.
---

# Common Components Rule

## Core Principle

Always use and create common components from `components/common/` instead of base HTML elements. When a new UI pattern is needed, create a reusable common component with complete, abstract functionality.

## Available Common Components

Import from `@/components/common`:

| Component        | Purpose               | Key Props                                          |
| ---------------- | --------------------- | -------------------------------------------------- |
| `Button`         | Interactive buttons   | `variant`, `size`, `icon`, `loading`               |
| `Input`          | Text/number inputs    | `label`, `error`, `prefix`, `suffix`               |
| `Select`         | Dropdown select       | `options`, `label`, `error`                        |
| `TextArea`       | Multi-line text       | `label`, `error`, `rows`                           |
| `Checkbox`       | Boolean toggle        | `label`, `checked`                                 |
| `Card`           | Container component   | `padding` (none/sm/md/lg)                          |
| `Badge`          | Status indicators     | `variant` (success/warning/danger/default/primary) |
| `Alert`          | Notification messages | `type`, `title`, `message`                         |
| `Icon`           | Material icons        | `name`, `size`                                     |
| `LoadingSpinner` | Loading states        | `size`, `text`                                     |
| `PageHeader`     | Page title section    | `title`, `description`, `actions`                  |
| `Table`          | Data tables           | `columns`, `data`                                  |
| `Divider`        | Visual separator      | `className`                                        |
| `Tooltip`        | Hover tooltips        | `content`                                          |
| `FieldLabel`     | Form field labels     | `label`, `tooltip`                                 |

## Usage Rules

### 1. Button Usage

NEVER use raw `<button>` HTML tags. ALWAYS use the common `Button` component:

```tsx
// ✅ CORRECT
<Button variant="primary" onClick={handler}>Save</Button>
<Button variant="secondary" icon={<Icon name="add" />} iconPosition="left">Add</Button>
<Button variant="danger" loading={isDeleting}>Delete</Button>
<Button variant="ghost" size="sm">Cancel</Button>
<Button variant="icon" icon={<Icon name="close" />} />

// ❌ WRONG
<button onClick={handler}>Save</button>
```

**Button Variants:**

- `primary` - Main actions (cyan background)
- `secondary` - Secondary actions (gray border)
- `danger` - Destructive actions (red tint)
- `ghost` - Minimal style (transparent)
- `icon` - Icon-only buttons

### 2. Form Elements

NEVER use native HTML form elements. ALWAYS use common components:

```tsx
// ✅ CORRECT
<Input label="Name" value={name} onChange={setName} error={errors.name} />
<Select options={options} value={value} onChange={setValue} />
<TextArea label="Description" value={desc} onChange={setDesc} rows={4} />
<Checkbox label="Active" checked={isActive} onChange={setIsActive} />

// ❌ WRONG
<input value={name} onChange={setName} />
<select value={value} onChange={setValue}>...</select>
<textarea value={desc} onChange={setDesc} />
```

### 3. Card Container

Use `Card` for content containers:

```tsx
// With padding
<Card padding="md">
  <h3>Title</h3>
  <p>Content</p>
</Card>

// Without padding (for custom layouts)
<Card padding="none">
  <div className="p-4 border-b border-gray-800">Header</div>
  <div className="p-4">Content</div>
</Card>
```

### 4. Page Headers

Use `PageHeader` for page titles:

```tsx
<PageHeader
  title="Transactions"
  description="View and manage your financial transactions."
  actions={
    <Button variant="primary" icon={<Icon name="add" />} iconPosition="left">
      Add Transaction
    </Button>
  }
/>
```

### 5. Icons

Use `Icon` component with Material Symbols names:

```tsx
<Icon name="check_circle" size={24} className="text-success" />
<Icon name="warning" size="sm" className="text-warning" />
<Icon name="add" />
```

### 6. Status Badges

Use `Badge` for status indicators:

```tsx
<Badge variant="success">Completed</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="danger">Overdue</Badge>
<Badge variant="default">Projected</Badge>
<Badge variant="primary">Active</Badge>
```

### 7. Loading States

Use `LoadingSpinner` for loading indicators:

```tsx
// Full page loading
<div className="flex items-center justify-center min-h-[400px]">
  <LoadingSpinner size="lg" text="Loading transactions..." />
</div>

// Inline loading
<LoadingSpinner size="sm" />
```

## Creating New Common Components

When new UI patterns are needed, create them in `components/common/`:

### Requirements Checklist

- [ ] Abstract and reusable (not feature-specific)
- [ ] Complete functionality (all states handled)
- [ ] TypeScript interfaces with JSDoc
- [ ] Tailwind CSS styling
- [ ] Multiple variants if applicable
- [ ] Size options (sm/md/lg) if applicable
- [ ] Disabled state handling
- [ ] Error states for inputs
- [ ] Loading states if applicable
- [ ] Proper accessibility (ARIA)
- [ ] className override prop
- [ ] Export type alongside component
- [ ] Add to index.ts barrel export

### Component Template

```tsx
// components/common/NewComponent.tsx
"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";

export interface NewComponentProps {
  /** Required prop description */
  required: string;
  /** Optional prop description */
  optional?: string;
  /** Visual variant */
  variant?: "primary" | "secondary";
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Disabled state */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Click handler */
  onClick?: () => void;
}

export const NewComponent: React.FC<NewComponentProps> = ({
  required,
  optional,
  variant = "primary",
  size = "md",
  disabled = false,
  className = "",
  onClick,
}) => {
  const baseStyles = "...";

  const variantStyles = {
    primary: "...",
    secondary: "...",
  };

  const sizeStyles = {
    sm: "...",
    md: "...",
    lg: "...",
  };

  return (
    <div
      className={cn(
        baseStyles,
        variantStyles[variant],
        sizeStyles[size],
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      onClick={disabled ? undefined : onClick}
    >
      {required}
      {optional && <span>{optional}</span>}
    </div>
  );
};
```

### Export in index.ts

```tsx
// components/common/index.ts
export { NewComponent, type NewComponentProps } from "./NewComponent";
```

## Styling Standards

All common components must:

- Use Tailwind CSS utility classes
- Follow color scheme:
  - Backgrounds: `gray-800`, `gray-700`, `gray-600`
  - Primary accent: `primary` (cyan-500)
  - Success: `success` (green)
  - Warning: `warning` (amber)
  - Danger: `danger` (red)
- Include hover states: `hover:bg-gray-700`
- Include focus states: `focus:ring-2 focus:ring-primary`
- Include disabled states: `disabled:opacity-50`
- Use transitions: `transition-all duration-200`
- Support dark theme (current design is dark)
- Use `cn()` utility for class merging

## Component Composition

Build complex UI from common components:

```tsx
// ✅ CORRECT - Compose from common components
<Card padding="md">
  <div className="flex items-center justify-between mb-4">
    <h3 className="font-bold text-white">Title</h3>
    <Badge variant="success">Active</Badge>
  </div>
  <Input label="Name" value={name} onChange={setName} />
  <div className="flex gap-2 mt-4">
    <Button variant="ghost" onClick={onCancel}>Cancel</Button>
    <Button variant="primary" onClick={onSave}>Save</Button>
  </div>
</Card>

// ❌ WRONG - Raw HTML
<div className="bg-gray-800 p-4 rounded-lg">
  <div className="flex justify-between">
    <h3>Title</h3>
    <span className="bg-green-500 px-2 rounded">Active</span>
  </div>
  <input value={name} onChange={setName} />
  <div className="flex gap-2">
    <button onClick={onCancel}>Cancel</button>
    <button onClick={onSave}>Save</button>
  </div>
</div>
```

## When to Create New Common Components

Create a new common component when:

1. A UI pattern appears 2+ times across different features
2. The pattern could be useful in other projects
3. Native HTML doesn't provide needed functionality
4. You need consistent styling/behavior across the app
5. The pattern involves multiple states (hover, focus, disabled, error)

## Priority Order

1. **Use existing common components first**
2. **Create new common component** if pattern doesn't exist and is reusable
3. **Never use base HTML elements** for interactive UI
