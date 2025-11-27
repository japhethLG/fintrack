"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";
import { Tooltip } from "./Tooltip";

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  tooltip?: string;
  error?: string;
  className?: string;
}

export const TextArea: React.FC<TextAreaProps> = ({
  label,
  tooltip,
  error,
  className = "",
  disabled,
  id,
  rows = 4,
  ...props
}) => {
  const textareaId =
    id || (label ? `textarea-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

  const baseTextAreaStyles =
    "w-full bg-[#151c2c] border rounded-lg text-white focus:outline-none transition-colors duration-200 placeholder:text-gray-500 resize-none";

  const combinedTextAreaClassName = cn(
    baseTextAreaStyles,
    error
      ? "border-danger focus:border-danger focus:ring-2 focus:ring-danger/20"
      : "border-gray-700 focus:border-primary focus:ring-2 focus:ring-primary/20",
    "p-3",
    disabled && "opacity-50 cursor-not-allowed",
    className
  );

  return (
    <div className="w-full">
      {label && (
        <div className="flex items-center gap-1 mb-2">
          <label htmlFor={textareaId} className="text-sm font-medium text-gray-400">
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
      <textarea
        id={textareaId}
        className={combinedTextAreaClassName}
        disabled={disabled}
        rows={rows}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={error ? `${textareaId}-error` : undefined}
        {...props}
      />
      {error && (
        <p
          id={error ? `${textareaId}-error` : undefined}
          className="mt-1 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
};
