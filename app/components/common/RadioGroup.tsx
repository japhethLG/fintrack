"use client";

import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

// ============================================================================
// RADIO GROUP ROOT
// ============================================================================

const RadioGroupRoot = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return <RadioGroupPrimitive.Root className={cn("grid gap-2", className)} {...props} ref={ref} />;
});
RadioGroupRoot.displayName = RadioGroupPrimitive.Root.displayName;

// ============================================================================
// RADIO GROUP ITEM (Circle style)
// ============================================================================

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "aspect-square h-4 w-4 rounded-full border border-gray-600 text-primary",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-900",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:border-primary",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
});
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

// ============================================================================
// RADIO BUTTON ITEM (Button style)
// ============================================================================

const radioButtonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap border px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      position: {
        first: "rounded-l-lg border-r-0",
        middle: "rounded-none border-r-0",
        last: "rounded-r-lg",
        single: "rounded-lg",
      },
    },
    defaultVariants: {
      position: "single",
    },
  }
);

interface RadioButtonItemProps
  extends React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>,
    VariantProps<typeof radioButtonVariants> {}

const RadioButtonItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  RadioButtonItemProps
>(({ className, position, children, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        radioButtonVariants({ position }),
        "border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-white",
        "data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-white",
        className
      )}
      {...props}
    >
      {children}
    </RadioGroupPrimitive.Item>
  );
});
RadioButtonItem.displayName = "RadioButtonItem";

// ============================================================================
// COMPOSED RADIO GROUP COMPONENT
// ============================================================================

export interface RadioOption {
  /** Option value */
  value: string;
  /** Option label */
  label: React.ReactNode;
  /** Disabled state */
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Label text */
  label?: string;
  /** Description text */
  description?: string;
  /** Error message */
  error?: string;
  /** Available options */
  options: RadioOption[];
  /** Current value */
  value?: string;
  /** Default value (uncontrolled) */
  defaultValue?: string;
  /** Change handler */
  onValueChange?: (value: string) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Display variant: default (circle) or button */
  variant?: "default" | "button";
  /** Orientation */
  orientation?: "horizontal" | "vertical";
  /** Additional class names */
  className?: string;
  /** ID for the radio group */
  id?: string;
  /** Name attribute */
  name?: string;
  /** Required field */
  required?: boolean;
}

export const RadioGroup: React.FC<RadioGroupProps> = ({
  label,
  description,
  error,
  options,
  value,
  defaultValue,
  onValueChange,
  disabled,
  variant = "default",
  orientation = "vertical",
  className,
  id,
  name,
  required,
}) => {
  const groupId = id || (label ? `radio-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

  const getButtonPosition = (
    index: number,
    total: number
  ): "first" | "middle" | "last" | "single" => {
    if (total === 1) return "single";
    if (index === 0) return "first";
    if (index === total - 1) return "last";
    return "middle";
  };

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <div className="flex items-center gap-1 mb-2">
          <span className="text-sm font-medium text-gray-400">
            {label}
            {required && <span className="text-danger ml-0.5">*</span>}
          </span>
        </div>
      )}
      {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}

      <RadioGroupRoot
        id={groupId}
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
        name={name}
        required={required}
        orientation={orientation}
        className={cn(
          variant === "button" && "flex gap-0",
          variant === "default" && orientation === "horizontal" && "flex flex-row gap-4",
          variant === "default" && orientation === "vertical" && "flex flex-col gap-2"
        )}
      >
        {options.map((option, index) =>
          variant === "button" ? (
            <RadioButtonItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              position={getButtonPosition(index, options.length)}
            >
              {option.label}
            </RadioButtonItem>
          ) : (
            <div key={option.value} className="flex items-center gap-2">
              <RadioGroupItem
                value={option.value}
                id={`${groupId}-${option.value}`}
                disabled={option.disabled}
              />
              <label
                htmlFor={`${groupId}-${option.value}`}
                className={cn(
                  "text-sm text-white cursor-pointer",
                  option.disabled && "opacity-50 cursor-not-allowed"
                )}
              >
                {option.label}
              </label>
            </div>
          )
        )}
      </RadioGroupRoot>

      {error && (
        <p className="mt-1 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

// Export primitives for advanced usage
export { RadioGroupRoot, RadioGroupItem, RadioButtonItem };
