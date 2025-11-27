"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils/cn";

// ============================================================================
// POPOVER PRIMITIVES
// ============================================================================

const PopoverRoot = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;
const PopoverClose = PopoverPrimitive.Close;

// ============================================================================
// POPOVER CONTENT
// ============================================================================

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-lg border border-gray-700 bg-dark-800 p-4 text-white shadow-xl outline-none",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
        "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

// ============================================================================
// COMPOSED POPOVER COMPONENT
// ============================================================================

export interface PopoverProps {
  /** Trigger element */
  trigger: React.ReactNode;
  /** Popover content */
  children: React.ReactNode;
  /** Open state (controlled) */
  open?: boolean;
  /** Default open state (uncontrolled) */
  defaultOpen?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Side to position the popover */
  side?: "top" | "right" | "bottom" | "left";
  /** Alignment relative to trigger */
  align?: "start" | "center" | "end";
  /** Offset from trigger */
  sideOffset?: number;
  /** Width of the popover */
  width?: string | number;
  /** Additional class names for content */
  className?: string;
  /** Whether the trigger should be rendered as a child */
  asChild?: boolean;
  /** Whether to show arrow */
  modal?: boolean;
}

export const Popover: React.FC<PopoverProps> = ({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  side = "bottom",
  align = "center",
  sideOffset = 4,
  width,
  className,
  asChild = true,
  modal = false,
}) => {
  return (
    <PopoverRoot open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} modal={modal}>
      <PopoverTrigger asChild={asChild}>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={className}
        style={{ width }}
      >
        {children}
      </PopoverContent>
    </PopoverRoot>
  );
};

// Export primitives for advanced usage
export { PopoverRoot, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverClose };
