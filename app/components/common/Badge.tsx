"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";

export interface BadgeProps {
  variant?: "default" | "success" | "warning" | "danger" | "primary";
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = "default",
  size = "md",
  icon,
  className = "",
  children,
}) => {
  const baseStyles = "inline-flex items-center gap-1.5 font-medium rounded";

  const variantStyles = {
    default: "bg-gray-700 text-gray-300",
    success: "bg-success/20 text-success",
    warning: "bg-warning/20 text-warning",
    danger: "bg-danger/20 text-danger",
    primary: "bg-primary/20 text-primary",
  };

  const sizeStyles = {
    sm: "px-1.5 py-0.5 text-xs",
    md: "px-2 py-1 text-xs",
    lg: "px-3 py-1.5 text-sm",
  };

  const combinedClassName = cn(baseStyles, variantStyles[variant], sizeStyles[size], className);

  return (
    <span className={combinedClassName}>
      {icon && <span className="flex items-center">{icon}</span>}
      {children}
    </span>
  );
};
