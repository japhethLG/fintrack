"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils/cn";

// ============================================================================
// SWITCH ROOT
// ============================================================================

const SwitchRoot = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-900",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-primary data-[state=unchecked]:bg-gray-600",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform",
        "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitive.Root>
));
SwitchRoot.displayName = SwitchPrimitive.Root.displayName;

// ============================================================================
// COMPOSED SWITCH COMPONENT
// ============================================================================

export interface SwitchProps {
  /** Label text */
  label?: string;
  /** Description text below label */
  description?: string;
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
  /** ID for the switch */
  id?: string;
  /** Name attribute */
  name?: string;
  /** Value attribute */
  value?: string;
  /** Required field */
  required?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

export const Switch: React.FC<SwitchProps> = ({
  label,
  description,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  className,
  id,
  name,
  value,
  required,
  size = "md",
}) => {
  const switchId = id || (label ? `switch-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

  const sizeClasses = {
    sm: "h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3",
    md: "h-5 w-9 [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4",
    lg: "h-6 w-11 [&>span]:h-5 [&>span]:w-5 [&>span]:data-[state=checked]:translate-x-5",
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <SwitchRoot
        id={switchId}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        name={name}
        value={value}
        required={required}
        className={sizeClasses[size]}
      />
      {(label || description) && (
        <label
          htmlFor={switchId}
          className={cn(
            "flex flex-col cursor-pointer",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          {label && (
            <span className="text-sm font-medium text-white">
              {label}
              {required && <span className="text-danger ml-0.5">*</span>}
            </span>
          )}
          {description && <span className="text-xs text-gray-400">{description}</span>}
        </label>
      )}
    </div>
  );
};

// Export primitive for advanced usage
export { SwitchRoot };
