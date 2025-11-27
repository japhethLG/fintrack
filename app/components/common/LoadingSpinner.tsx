"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";

export interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  color?: "primary" | "success" | "danger" | "warning" | "white";
  text?: string;
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = "md",
  color = "primary",
  text,
  className = "",
}) => {
  const sizeStyles = {
    sm: "w-6 h-6 border-2",
    md: "w-12 h-12 border-4",
    lg: "w-16 h-16 border-4",
  };

  const colorStyles = {
    primary: "border-primary border-t-transparent",
    success: "border-success border-t-transparent",
    danger: "border-danger border-t-transparent",
    warning: "border-warning border-t-transparent",
    white: "border-white border-t-transparent",
  };

  const spinnerClassName = cn(
    sizeStyles[size],
    colorStyles[color],
    "rounded-full animate-spin",
    className
  );

  return (
    <div className="flex flex-col items-center gap-4">
      <div className={spinnerClassName}></div>
      {text && <p className="text-gray-400">{text}</p>}
    </div>
  );
};
