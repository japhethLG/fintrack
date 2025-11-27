"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "@radix-ui/react-icons";

import { cn } from "@/lib/utils/cn";

// ============================================================================
// CHECKBOX PRIMITIVE
// ============================================================================

const CheckboxRoot = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    hasError?: boolean;
  }
>(({ className, hasError, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-5 w-5 shrink-0 rounded border bg-dark-800 transition-colors duration-200",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-900",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-white",
      hasError ? "border-danger" : "border-gray-700",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
      <CheckIcon className="h-3.5 w-3.5" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
CheckboxRoot.displayName = CheckboxPrimitive.Root.displayName;

// ============================================================================
// COMPOSED CHECKBOX COMPONENT
// ============================================================================

export interface CheckboxProps {
  /** Label text */
  label?: string;
  /** Description text below label */
  description?: string;
  /** Error message */
  error?: string;
  /** Checked state */
  checked?: boolean;
  /** Default checked state (uncontrolled) */
  defaultChecked?: boolean;
  /** Change handler */
  onCheckedChange?: (checked: boolean) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Additional class names */
  className?: string;
  /** ID for the checkbox */
  id?: string;
  /** Name attribute */
  name?: string;
  /** Value attribute */
  value?: string;
  /** Required field */
  required?: boolean;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  label,
  description,
  error,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  className,
  id,
  name,
  value,
  required,
}) => {
  const checkboxId =
    id || (label ? `checkbox-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

  return (
    <div className={cn("w-full", className)}>
      <label
        htmlFor={checkboxId}
        className={cn(
          "flex items-start gap-3 cursor-pointer",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <CheckboxRoot
          id={checkboxId}
          checked={checked}
          defaultChecked={defaultChecked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          name={name}
          value={value}
          required={required}
          hasError={!!error}
          className="mt-0.5"
        />
        {(label || description) && (
          <div className="flex flex-col">
            {label && (
              <span className="text-sm font-medium text-white">
                {label}
                {required && <span className="text-danger ml-0.5">*</span>}
              </span>
            )}
            {description && <span className="text-xs text-gray-400">{description}</span>}
          </div>
        )}
      </label>
      {error && (
        <p className="mt-1 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

// Export primitive for advanced usage
export { CheckboxRoot };
