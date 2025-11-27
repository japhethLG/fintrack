"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils/cn";

// ============================================================================
// TOOLTIP PRIMITIVES
// ============================================================================

const TooltipProvider = TooltipPrimitive.Provider;
const TooltipRoot = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-100 shadow-lg max-w-xs",
      "animate-in fade-in-0 zoom-in-95",
      "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
      "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
      "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

// ============================================================================
// COMPOSED TOOLTIP COMPONENT
// ============================================================================

export interface TooltipProps {
  /** Tooltip content */
  content: React.ReactNode;
  /** Trigger element */
  children: React.ReactNode;
  /** Position of the tooltip */
  position?: "top" | "bottom" | "left" | "right";
  /** Delay in ms before showing */
  delay?: number;
  /** Additional class names for content */
  className?: string;
  /** Whether the tooltip is open (controlled) */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Align tooltip relative to trigger */
  align?: "start" | "center" | "end";
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = "top",
  delay = 150,
  className,
  open,
  onOpenChange,
  align = "center",
}) => {
  // Don't render tooltip if no content
  if (!content) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider delayDuration={delay}>
      <TooltipRoot open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={position} align={align} className={className}>
          {content}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
};

// ============================================================================
// FIELD LABEL WITH TOOLTIP
// ============================================================================

export interface FieldLabelProps {
  /** Label text */
  label: string;
  /** Tooltip text */
  tooltip?: string;
  /** Show required indicator */
  required?: boolean;
  /** Additional class names */
  className?: string;
  /** HTML for attribute */
  htmlFor?: string;
}

export const FieldLabel: React.FC<FieldLabelProps> = ({
  label,
  tooltip,
  required = false,
  className,
  htmlFor,
}) => {
  return (
    <div className={cn("flex items-center gap-1 mb-2", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-gray-400">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {tooltip && (
        <Tooltip content={tooltip} position="top">
          <span className="text-gray-500 hover:text-gray-400 cursor-help transition-colors">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
        </Tooltip>
      )}
    </div>
  );
};

// Export primitives for advanced usage
export { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent };
