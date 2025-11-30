"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { ReloadIcon } from "@radix-ui/react-icons";

import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#101622] disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed select-none h-11",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/25 focus:ring-primary",
        secondary:
          "bg-dark-800 text-white border border-gray-700 hover:bg-gray-700 focus:ring-gray-600",
        danger:
          "bg-danger/20 text-danger border border-danger/30 hover:bg-danger/30 focus:ring-danger",
        ghost:
          "bg-transparent text-gray-400 hover:bg-gray-800 hover:text-white focus:ring-gray-600",
        icon: "bg-transparent text-gray-400 hover:bg-gray-800 hover:text-white focus:ring-gray-600 p-0",
        link: "text-primary underline-offset-4 hover:underline bg-transparent",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-11 px-4 text-base",
        lg: "h-12 px-6 text-lg",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  /** @deprecated Use startIcon instead */
  icon?: React.ReactNode;
  /** @deprecated Use startIcon/endIcon instead */
  iconPosition?: "left" | "right";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      fullWidth = false,
      startIcon,
      endIcon,
      icon,
      iconPosition = "left",
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    const isDisabled = disabled || loading;

    // Handle legacy icon prop
    const effectiveStartIcon = startIcon || (icon && iconPosition === "left" ? icon : undefined);
    const effectiveEndIcon = endIcon || (icon && iconPosition === "right" ? icon : undefined);

    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          fullWidth && "w-full",
          loading && "relative cursor-default"
        )}
        ref={ref}
        disabled={isDisabled}
        type={asChild ? undefined : "button"}
        {...props}
      >
        <>
          {effectiveStartIcon && (
            <span className={cn("flex items-center", loading && "invisible")}>
              {effectiveStartIcon}
            </span>
          )}
          {loading && (
            <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center">
              <ReloadIcon className="h-4 w-4 animate-spin" />
            </span>
          )}
          {children && (
            <span className={cn("inline-flex items-center", loading && "invisible")}>
              {children}
            </span>
          )}
          {effectiveEndIcon && (
            <span className={cn("flex items-center", loading && "invisible")}>
              {effectiveEndIcon}
            </span>
          )}
        </>
      </Comp>
    );
  }
);

Button.displayName = "Button";

export { Button, buttonVariants };
