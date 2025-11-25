"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  className?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  prefix,
  suffix,
  className = "",
  disabled,
  id,
  ...props
}) => {
  const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

  const baseInputStyles =
    "w-full bg-[#151c2c] border rounded-lg text-white focus:outline-none transition-colors duration-200 placeholder:text-gray-500";

  const combinedInputClassName = cn(
    baseInputStyles,
    error
      ? "border-danger focus:border-danger focus:ring-2 focus:ring-danger/20"
      : "border-gray-700 focus:border-primary focus:ring-2 focus:ring-primary/20",
    prefix && "pl-8",
    suffix && "pr-8",
    "p-3",
    disabled && "opacity-50 cursor-not-allowed",
    className
  );

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-400 mb-2">
          {label}
        </label>
      )}
      <div className="relative">
        {prefix && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
            {prefix}
          </div>
        )}
        <input
          id={inputId}
          className={combinedInputClassName}
          disabled={disabled}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...props}
        />
        {suffix && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
            {suffix}
          </div>
        )}
      </div>
      {error && (
        <p
          id={error ? `${inputId}-error` : undefined}
          className="mt-1 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
};
