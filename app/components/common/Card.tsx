"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";

export interface CardProps {
  variant?: "default" | "elevated";
  padding?: "sm" | "md" | "lg" | "none";
  header?: React.ReactNode;
  footer?: React.ReactNode;
  hover?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  variant = "default",
  padding = "md",
  header,
  footer,
  hover = false,
  className = "",
  children,
}) => {
  const baseStyles = "bg-[#1a2336] border border-gray-800 rounded-2xl";

  const variantStyles = {
    default: "",
    elevated: "shadow-2xl",
  };

  const paddingStyles = {
    none: "",
    sm: "p-4",
    md: "p-6",
    lg: "p-8",
  };

	const combinedClassName = cn(
		baseStyles,
		variantStyles[variant],
		paddingStyles[padding],
		hover && "transition-all duration-200 hover:border-gray-700",
		className
	);

  return (
    <div className={combinedClassName}>
      {header && <div className="border-b border-gray-800 bg-[#1e273b] p-4 md:p-6">{header}</div>}
      <div className={header || footer ? (header && footer ? "" : header ? "" : "") : ""}>
        {children}
      </div>
      {footer && (
        <div className="border-t border-gray-800 bg-[#151c2c] p-4 flex justify-end gap-3">
          {footer}
        </div>
      )}
    </div>
  );
};
