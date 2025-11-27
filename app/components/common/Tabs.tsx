"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils/cn";

// ============================================================================
// TABS ROOT
// ============================================================================

const TabsRoot = TabsPrimitive.Root;

// ============================================================================
// TABS LIST
// ============================================================================

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-lg bg-dark-800 p-1 text-gray-400",
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

// ============================================================================
// TABS TRIGGER
// ============================================================================

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-900",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:bg-dark-700 data-[state=active]:text-white data-[state=active]:shadow-sm",
      "hover:text-white",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

// ============================================================================
// TABS CONTENT
// ============================================================================

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-dark-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

// ============================================================================
// COMPOSED TABS COMPONENT
// ============================================================================

export interface TabItem {
  /** Unique value for the tab */
  value: string;
  /** Label shown in the tab trigger */
  label: React.ReactNode;
  /** Content shown when tab is active */
  content: React.ReactNode;
  /** Disabled state */
  disabled?: boolean;
  /** Icon to show before label */
  icon?: React.ReactNode;
}

export interface TabsProps {
  /** Array of tab items */
  items: TabItem[];
  /** Default active tab value */
  defaultValue?: string;
  /** Controlled value */
  value?: string;
  /** Change handler */
  onValueChange?: (value: string) => void;
  /** Orientation */
  orientation?: "horizontal" | "vertical";
  /** Additional class names for root */
  className?: string;
  /** Additional class names for tab list */
  listClassName?: string;
  /** Additional class names for tab content */
  contentClassName?: string;
  /** Tab list variant */
  variant?: "default" | "underline" | "pills";
}

export const Tabs: React.FC<TabsProps> = ({
  items,
  defaultValue,
  value,
  onValueChange,
  orientation = "horizontal",
  className,
  listClassName,
  contentClassName,
  variant = "default",
}) => {
  const defaultTab = defaultValue || items[0]?.value;

  const listVariantClasses = {
    default: "bg-dark-800 p-1 rounded-lg",
    underline: "bg-transparent border-b border-gray-700 rounded-none p-0 gap-4",
    pills: "bg-transparent gap-2 p-0",
  };

  const triggerVariantClasses = {
    default: cn(
      "rounded-md px-3 py-1.5",
      "data-[state=active]:bg-dark-700 data-[state=active]:text-white data-[state=active]:shadow-sm"
    ),
    underline: cn(
      "rounded-none px-1 py-2 border-b-2 border-transparent -mb-px",
      "data-[state=active]:border-primary data-[state=active]:text-white"
    ),
    pills: cn(
      "rounded-full px-4 py-1.5 border border-gray-700",
      "data-[state=active]:bg-primary data-[state=active]:border-primary data-[state=active]:text-white"
    ),
  };

  return (
    <TabsRoot
      defaultValue={defaultTab}
      value={value}
      onValueChange={onValueChange}
      orientation={orientation}
      className={cn("w-full", orientation === "vertical" && "flex gap-4", className)}
    >
      <TabsList
        className={cn(
          listVariantClasses[variant],
          orientation === "vertical" && "flex-col h-auto items-stretch",
          listClassName
        )}
      >
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={triggerVariantClasses[variant]}
          >
            {item.icon && <span className="mr-2">{item.icon}</span>}
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {items.map((item) => (
        <TabsContent
          key={item.value}
          value={item.value}
          className={cn(orientation === "vertical" && "mt-0 flex-1", contentClassName)}
        >
          {item.content}
        </TabsContent>
      ))}
    </TabsRoot>
  );
};

// Export primitives for advanced usage
export { TabsRoot, TabsList, TabsTrigger, TabsContent };
