"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

// ============================================================================
// DRAWER PRIMITIVES
// ============================================================================

const DrawerRoot = DialogPrimitive.Root;
const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerClose = DialogPrimitive.Close;
const DrawerPortal = DialogPrimitive.Portal;

// ============================================================================
// DRAWER OVERLAY
// ============================================================================

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DrawerOverlay.displayName = DialogPrimitive.Overlay.displayName;

// ============================================================================
// DRAWER CONTENT VARIANTS
// ============================================================================

const drawerContentVariants = cva(
  "fixed z-50 gap-4 bg-dark-800 p-6 shadow-xl transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500 border-gray-700",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
);

// ============================================================================
// DRAWER CONTENT
// ============================================================================

interface DrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof drawerContentVariants> {
  showClose?: boolean;
}

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(({ side = "right", className, children, showClose = true, ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(drawerContentVariants({ side }), className)}
      {...props}
    >
      {children}
      {showClose && (
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-dark-900 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-gray-700 text-gray-400">
          <Cross2Icon className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DrawerPortal>
));
DrawerContent.displayName = DialogPrimitive.Content.displayName;

// ============================================================================
// DRAWER HEADER
// ============================================================================

const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DrawerHeader.displayName = "DrawerHeader";

// ============================================================================
// DRAWER FOOTER
// ============================================================================

const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
DrawerFooter.displayName = "DrawerFooter";

// ============================================================================
// DRAWER TITLE
// ============================================================================

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight text-white", className)}
    {...props}
  />
));
DrawerTitle.displayName = DialogPrimitive.Title.displayName;

// ============================================================================
// DRAWER DESCRIPTION
// ============================================================================

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-gray-400", className)}
    {...props}
  />
));
DrawerDescription.displayName = DialogPrimitive.Description.displayName;

// ============================================================================
// COMPOSED DRAWER COMPONENT
// ============================================================================

export interface DrawerProps {
  /** Trigger element */
  trigger?: React.ReactNode;
  /** Drawer content */
  children: React.ReactNode;
  /** Title text */
  title?: React.ReactNode;
  /** Description text */
  description?: React.ReactNode;
  /** Footer content */
  footer?: React.ReactNode;
  /** Open state (controlled) */
  open?: boolean;
  /** Default open state (uncontrolled) */
  defaultOpen?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Side to slide from */
  side?: "top" | "right" | "bottom" | "left";
  /** Width of the drawer (for left/right) */
  width?: string | number;
  /** Height of the drawer (for top/bottom) */
  height?: string | number;
  /** Show close button */
  showClose?: boolean;
  /** Additional class names for content */
  className?: string;
  /** Whether the trigger should be rendered as a child */
  asChild?: boolean;
}

export const Drawer: React.FC<DrawerProps> = ({
  trigger,
  children,
  title,
  description,
  footer,
  open,
  defaultOpen,
  onOpenChange,
  side = "right",
  width,
  height,
  showClose = true,
  className,
  asChild = true,
}) => {
  const sizeStyle: React.CSSProperties = {};
  if (width && (side === "left" || side === "right")) {
    sizeStyle.width = width;
    sizeStyle.maxWidth = width;
  }
  if (height && (side === "top" || side === "bottom")) {
    sizeStyle.height = height;
    sizeStyle.maxHeight = height;
  }

  return (
    <DrawerRoot open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger && <DrawerTrigger asChild={asChild}>{trigger}</DrawerTrigger>}
      <DrawerContent side={side} showClose={showClose} className={className} style={sizeStyle}>
        {(title || description) && (
          <DrawerHeader>
            {title && <DrawerTitle>{title}</DrawerTitle>}
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>
        )}
        <div className="flex-1 overflow-auto">{children}</div>
        {footer && <DrawerFooter>{footer}</DrawerFooter>}
      </DrawerContent>
    </DrawerRoot>
  );
};

// Export primitives for advanced usage
export {
  DrawerRoot,
  DrawerTrigger,
  DrawerClose,
  DrawerPortal,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
