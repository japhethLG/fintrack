---
trigger: always_on
description: Governs when and how to update rule files as the codebase evolves. Apply after implementing new patterns, abstractions, or architectural changes that should be documented for consistency.
---

# Rule Maintenance & Updates

## Core Principle

These rules must evolve with the codebase. When implementing new patterns, abstractions, or architectural changes, update the relevant rule files to maintain consistency in future code generation.

## When to Update Rules

### 1. New Component Patterns

When creating a new reusable pattern:

```
Trigger: You create a new component pattern that could be reused
Action: Update `page-component-patterns.mdc` with:
  - The pattern description
  - Example code
  - When to use it
```

### 2. New Common Components

When adding to `components/common/`:

```
Trigger: You create a new common component
Action: Update `common-components.mdc`:
  - Add to "Available Common Components" list
  - Add usage example if non-obvious
```

### 3. New Form Patterns

When implementing new form functionality:

```
Trigger: New form validation pattern, new formElement, or new form structure
Action: Update `form-patterns.mdc` with:
  - New component usage
  - New validation patterns
  - New form structure patterns
```

### 4. New Types or Constants Patterns

When establishing new type conventions:

```
Trigger: New type structure, new constant organization
Action: Update `types-and-constants.mdc` with:
  - New type examples
  - New constant naming conventions
```

### 5. Folder Structure Changes

When the project structure evolves:

```
Trigger: New folders, new organization patterns
Action: Update `folder-structure.mdc` with:
  - Updated directory tree
  - New folder purposes
  - New naming conventions
```

### 6. Context/State Patterns

When adding new context patterns:

```
Trigger: New context, new state management approach
Action: Update `context-patterns.mdc` with:
  - New context structure
  - New patterns for data flow
```

## Rule Update Format

When updating rules, follow this format:

```markdown
### [Pattern Name]

**When to use:** Brief description of when this pattern applies

**Example:**
\`\`\`tsx
// Code example
\`\`\`

**Notes:**

- Important consideration 1
- Important consideration 2
```

## Creating New Rule Files

Create a new rule file when:

1. A distinct domain/concern emerges (e.g., `testing-patterns.mdc`, `api-patterns.mdc`)
2. Existing rules become too long (> 500 lines)
3. A new technology stack is introduced

### New Rule File Template

```markdown
---
alwaysApply: true
---

# [Domain] Patterns

## Core Principle

[One-sentence description of the guiding principle]

## [Section 1]

### Pattern Name

**When to use:** Description

**Example:**
\`\`\`tsx
// Code
\`\`\`

## [Section 2]

...
```

## Rule File Naming

| Domain              | Filename                      |
| ------------------- | ----------------------------- |
| UI Components       | `common-components.mdc`       |
| Page Structure      | `page-component-patterns.mdc` |
| Forms               | `form-patterns.mdc`           |
| Types/Constants     | `types-and-constants.mdc`     |
| Folder Organization | `folder-structure.mdc`        |
| State Management    | `context-patterns.mdc`        |
| Testing             | `testing-patterns.mdc`        |
| API Routes          | `api-patterns.mdc`            |
| Styling             | `styling-patterns.mdc`        |

## Checklist Before Implementing New Code

Before implementing significant new functionality:

- [ ] Check if existing patterns apply
- [ ] Identify if a new pattern is being established
- [ ] Plan rule updates if new patterns emerge

## Checklist After Implementing New Code

After implementing significant new functionality:

- [ ] Did you create a new reusable component? → Update `common-components.mdc`
- [ ] Did you create a new page structure? → Update `page-component-patterns.mdc`
- [ ] Did you create new form patterns? → Update `form-patterns.mdc`
- [ ] Did you add new types/constants? → Update `types-and-constants.mdc`
- [ ] Did you change folder structure? → Update `folder-structure.mdc`
- [ ] Did you add new context patterns? → Update `context-patterns.mdc`
- [ ] Did you establish an entirely new domain? → Create new rule file

## AI Instructions for Rule Updates

When the AI (you) implements new patterns:

1. **Recognize pattern establishment**: When implementing something that could be a template for future similar implementations, note it.

2. **Proactively suggest updates**: At the end of implementing significant features, suggest:

   ```
   "I've implemented [pattern]. This establishes a new pattern for [use case].
   Would you like me to update [rule-file.mdc] to document this pattern?"
   ```

3. **Update rules alongside code**: When asked to update rules, provide specific additions:

   ```
   "I'll add the following to [rule-file.mdc]:

   ### [Pattern Name]
   [Pattern documentation]"
   ```

4. **Maintain consistency**: When updating rules, ensure:
   - Format matches existing sections
   - Examples are complete and runnable
   - Cross-references to other rules are accurate

## Version Control for Rules

When updating rules:

1. Make atomic, focused updates
2. Update one pattern per commit when possible
3. Reference the feature that prompted the rule update

## Rule Priority

When rules conflict, priority order:

1. `common-components.mdc` - UI primitive usage
2. `form-patterns.mdc` - Form structure
3. `page-component-patterns.mdc` - Page/component structure
4. `folder-structure.mdc` - File organization
5. `types-and-constants.mdc` - Type definitions
6. `context-patterns.mdc` - State management

## Keeping Rules Current

Periodically review rules for:

- Outdated patterns that have been superseded
- Missing patterns that have become standard
- Conflicts between documented and actual patterns
- Opportunities to simplify or combine rules
