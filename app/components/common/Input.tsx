"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { Tooltip } from "./Tooltip";
import { Icon } from "./Icon";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix" | "suffix"> {
  label?: string;
  tooltip?: string;
  error?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  className?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  tooltip,
  error,
  prefix,
  suffix,
  className = "",
  disabled,
  id,
  type,
  ...props
}) => {
  const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);
  const isPassword = type === "password";
  const [showPassword, setShowPassword] = useState(false);
  const inputType = isPassword && showPassword ? "text" : type;

  const baseInputStyles =
    "h-11 w-full bg-[#151c2c] border rounded-lg text-white focus:outline-none transition-colors duration-200 placeholder:text-gray-500";

  const combinedInputClassName = cn(
    baseInputStyles,
    "p-3",
    error
      ? "border-danger focus:border-danger focus:ring-2 focus:ring-danger/20"
      : "border-gray-700 focus:border-primary focus:ring-2 focus:ring-primary/20",
    prefix && "pl-6",
    (suffix || isPassword) && "pr-10",
    disabled && "opacity-50 cursor-not-allowed",
    className
  );

  return (
    <div className="">
      {label && (
        <div className="flex items-center gap-1 mb-2">
          <label htmlFor={inputId} className="text-sm font-medium text-gray-400">
            {label}
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
      )}
      <div className="relative">
        {prefix && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
            {prefix}
          </div>
        )}
        <input
          id={inputId}
          type={inputType}
          className={combinedInputClassName}
          disabled={disabled}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors focus:outline-none focus:text-primary"
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={0}
          >
            <Icon
              name={showPassword ? "visibility_off" : "visibility"}
              size="sm"
              className="text-current"
            />
          </button>
        )}
        {suffix && !isPassword && (
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
