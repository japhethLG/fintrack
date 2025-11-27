"use client";

import * as React from "react";
import { DatePicker as AntDatePicker } from "antd";
import type { DatePickerProps as AntDatePickerProps } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";

import { cn } from "@/lib/utils/cn";

// ============================================================================
// DATE PICKER COMPONENT
// ============================================================================

export interface DatePickerProps extends Omit<AntDatePickerProps, "value" | "onChange"> {
  /** Label text */
  label?: string;
  /** Error message */
  error?: string;
  /** Current value */
  value?: Dayjs | string | null;
  /** Change handler */
  onChange?: (date: Dayjs | null, dateString: string) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Disable specific dates */
  disabledDate?: (date: Dayjs) => boolean;
  /** Date format */
  format?: string;
  /** Additional class names */
  className?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Required field */
  required?: boolean;
  /** ID for the input */
  id?: string;
  /** Allow clearing the value */
  allowClear?: boolean;
  /** Size variant */
  size?: "small" | "middle" | "large";
  /** Show time picker */
  showTime?: boolean;
  /** Picker type */
  picker?: "date" | "week" | "month" | "quarter" | "year";
}

export const DatePicker: React.FC<DatePickerProps> = ({
  label,
  error,
  value,
  onChange,
  disabled,
  disabledDate,
  format = "MM/DD/YYYY",
  className,
  placeholder,
  required,
  id,
  allowClear = true,
  size = "middle",
  showTime,
  picker = "date",
  ...rest
}) => {
  const pickerId =
    id || (label ? `datepicker-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

  // Convert string value to Dayjs if needed
  const dayjsValue = React.useMemo(() => {
    if (!value) return null;
    if (typeof value === "string") {
      const parsed = dayjs(value);
      return parsed.isValid() ? parsed : null;
    }
    return value;
  }, [value]);

  const sizeClass = {
    small: "h-8",
    middle: "h-10",
    large: "h-12",
  };

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <div className="flex items-center gap-1 mb-2">
          <label htmlFor={pickerId} className="text-sm font-medium text-gray-400">
            {label}
            {required && <span className="text-danger ml-0.5">*</span>}
          </label>
        </div>
      )}
      <AntDatePicker
        id={pickerId}
        value={dayjsValue}
        onChange={(date, dateString) => onChange?.(date, dateString as string)}
        disabled={disabled}
        disabledDate={disabledDate}
        format={format}
        className={cn(
          "w-full fintrack-datepicker",
          sizeClass[size],
          error && "fintrack-datepicker-error"
        )}
        placeholder={placeholder || format}
        allowClear={allowClear}
        size={size}
        showTime={showTime}
        picker={picker}
        {...rest}
      />
      {error && (
        <p className="mt-1 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
