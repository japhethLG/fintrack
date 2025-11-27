"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDownIcon } from "@radix-ui/react-icons";

import { cn } from "@/lib/utils/cn";

// ============================================================================
// ACCORDION ROOT
// ============================================================================

const AccordionRoot = AccordionPrimitive.Root;

// ============================================================================
// ACCORDION ITEM
// ============================================================================

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn("border-b border-gray-700", className)}
    {...props}
  />
));
AccordionItem.displayName = "AccordionItem";

// ============================================================================
// ACCORDION TRIGGER
// ============================================================================

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex flex-1 items-center justify-between py-4 text-sm font-medium text-white transition-all",
        "hover:text-gray-300 [&[data-state=open]>svg]:rotate-180",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200" />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
));
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;

// ============================================================================
// ACCORDION CONTENT
// ============================================================================

const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className={cn(
      "overflow-hidden text-sm text-gray-300",
      "data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
    )}
    {...props}
  >
    <div className={cn("pb-4 pt-0", className)}>{children}</div>
  </AccordionPrimitive.Content>
));
AccordionContent.displayName = AccordionPrimitive.Content.displayName;

// ============================================================================
// COMPOSED ACCORDION COMPONENT
// ============================================================================

export interface AccordionItemData {
  /** Unique value for the item */
  value: string;
  /** Title shown in the trigger */
  title: React.ReactNode;
  /** Content shown when expanded */
  content: React.ReactNode;
  /** Disabled state */
  disabled?: boolean;
}

export interface AccordionProps {
  /** Array of accordion items */
  items: AccordionItemData[];
  /** Type of accordion: single allows one item open, multiple allows many */
  type?: "single" | "multiple";
  /** Default expanded item(s) */
  defaultValue?: string | string[];
  /** Controlled value */
  value?: string | string[];
  /** Change handler */
  onValueChange?: (value: string | string[]) => void;
  /** Whether items can be collapsed */
  collapsible?: boolean;
  /** Additional class names */
  className?: string;
}

export const Accordion: React.FC<AccordionProps> = ({
  items,
  type = "single",
  defaultValue,
  value,
  onValueChange,
  collapsible = true,
  className,
}) => {
  // Handle type-safe props based on accordion type
  if (type === "single") {
    return (
      <AccordionRoot
        type="single"
        defaultValue={defaultValue as string}
        value={value as string}
        onValueChange={onValueChange as (value: string) => void}
        collapsible={collapsible}
        className={cn("w-full", className)}
      >
        {items.map((item) => (
          <AccordionItem key={item.value} value={item.value} disabled={item.disabled}>
            <AccordionTrigger>{item.title}</AccordionTrigger>
            <AccordionContent>{item.content}</AccordionContent>
          </AccordionItem>
        ))}
      </AccordionRoot>
    );
  }

  return (
    <AccordionRoot
      type="multiple"
      defaultValue={defaultValue as string[]}
      value={value as string[]}
      onValueChange={onValueChange as (value: string[]) => void}
      className={cn("w-full", className)}
    >
      {items.map((item) => (
        <AccordionItem key={item.value} value={item.value} disabled={item.disabled}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>{item.content}</AccordionContent>
        </AccordionItem>
      ))}
    </AccordionRoot>
  );
};

// Export primitives for advanced usage
export { AccordionRoot, AccordionItem, AccordionTrigger, AccordionContent };
