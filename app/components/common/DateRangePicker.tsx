"use client";

import * as React from "react";
import { DatePicker } from "antd";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
} from "@radix-ui/react-icons";
import dayjs, { type Dayjs } from "dayjs";

import { cn } from "@/lib/utils/cn";
import { Button } from "./Button";

const { RangePicker } = DatePicker;

// ============================================================================
// QUICK SELECT BUTTON
// ============================================================================

interface QuickSelectButtonProps {
  value: string;
  label: string;
  isActive: boolean | undefined;
  onClick: (value: string) => void;
}

const QuickSelectButton: React.FC<QuickSelectButtonProps> = ({
  value,
  label,
  isActive,
  onClick,
}) => (
  <Button
    variant="ghost"
    onClick={() => onClick(value)}
    className={cn(
      "flex w-full justify-start px-4 py-1 text-sm text-gray-300 transition-colors rounded-none",
      isActive ? "bg-primary/20 text-primary" : "hover:bg-gray-700"
    )}
  >
    {label}
  </Button>
);

// ============================================================================
// DATE RANGE PICKER COMPONENT
// ============================================================================

export type DateRange = [Dayjs | null, Dayjs | null];

export interface DateRangePickerProps {
  /** Label text */
  label?: string;
  /** Error message */
  error?: string;
  /** Current value */
  value?: DateRange;
  /** Default value */
  defaultValue?: DateRange;
  /** Change handler */
  onChange?: (dates: DateRange, dateStrings: [string, string]) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Disable specific dates */
  disabledDate?: (date: Dayjs) => boolean;
  /** Date format */
  format?: string;
  /** Additional class names */
  className?: string;
  /** Placeholder text */
  placeholder?: [string, string];
  /** Required field */
  required?: boolean;
  /** ID for the input */
  id?: string;
  /** Allow clearing the value */
  allowClear?: boolean;
  /** Size variant */
  size?: "small" | "middle" | "large";
  /** Show quick select presets */
  showQuickSelect?: boolean;
  /** Custom presets */
  presets?: { value: string; label: string; range: DateRange }[];
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  label,
  error,
  value,
  defaultValue = [dayjs(), dayjs()],
  onChange,
  disabled,
  disabledDate,
  format = "MM/DD/YYYY",
  className,
  placeholder = ["Start date", "End date"],
  required,
  id,
  allowClear = true,
  size = "middle",
  showQuickSelect = true,
  presets,
}) => {
  const pickerId =
    id || (label ? `daterange-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);
  const [dateRange, setDateRange] = React.useState<DateRange>(value || defaultValue);

  // Sync with external value
  React.useEffect(() => {
    if (value) {
      setDateRange(value);
    }
  }, [value]);

  // Default quick select options
  const defaultQuickSelectButtons = React.useMemo(
    () => [
      {
        value: "today",
        label: "Today",
        isActive: dateRange[0]?.isSame(dateRange[1], "day") && dateRange[0]?.isSame(dayjs(), "day"),
      },
      {
        value: "thisWeek",
        label: "This Week",
        isActive: dateRange[0]?.isSame(dayjs().startOf("week"), "day"),
      },
      {
        value: "thisMonth",
        label: "This Month",
        isActive: dateRange[0]?.isSame(dayjs().startOf("month"), "day"),
      },
      {
        value: "lastWeek",
        label: "Last Week",
        isActive: dateRange[0]?.isSame(dayjs().subtract(1, "week").startOf("week"), "day"),
      },
      {
        value: "lastMonth",
        label: "Last Month",
        isActive: dateRange[0]?.isSame(dayjs().subtract(1, "month").startOf("month"), "day"),
      },
    ],
    [dateRange]
  );

  const handleDateChange = (dates: DateRange) => {
    if (!dates) {
      setDateRange([null, null]);
      onChange?.([null, null], ["", ""]);
      return;
    }

    const newRange: DateRange = [dates[0]?.startOf("day") || null, dates[1]?.endOf("day") || null];
    setDateRange(newRange);
    onChange?.(newRange, [newRange[0]?.format(format) || "", newRange[1]?.format(format) || ""]);
  };

  const handleQuickSelect = (quickValue: string) => {
    const today = dayjs();

    // Check custom presets first
    if (presets) {
      const preset = presets.find((p) => p.value === quickValue);
      if (preset) {
        handleDateChange(preset.range);
        return;
      }
    }

    // Default presets
    const dateRanges: Record<string, DateRange> = {
      today: [today, today],
      thisWeek: [today.startOf("week"), today.endOf("week")],
      thisMonth: [today.startOf("month"), today.endOf("month")],
      lastWeek: [
        today.subtract(1, "week").startOf("week"),
        today.subtract(1, "week").endOf("week"),
      ],
      lastMonth: [
        today.subtract(1, "month").startOf("month"),
        today.subtract(1, "month").endOf("month"),
      ],
    };

    const newDates = dateRanges[quickValue];
    if (newDates) {
      handleDateChange(newDates);
    }
  };

  const quickSelectButtons = presets
    ? presets.map((preset) => ({
        value: preset.value,
        label: preset.label,
        isActive:
          dateRange[0]?.isSame(preset.range[0], "day") &&
          dateRange[1]?.isSame(preset.range[1], "day"),
      }))
    : defaultQuickSelectButtons;

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
      <RangePicker
        id={pickerId}
        value={dateRange}
        onChange={(dates) => handleDateChange(dates as DateRange)}
        disabled={disabled}
        disabledDate={disabledDate}
        format={format}
        className={cn(
          "w-full fintrack-datepicker",
          sizeClass[size],
          error && "fintrack-datepicker-error"
        )}
        placeholder={placeholder}
        allowClear={allowClear}
        size={size}
        prevIcon={<ChevronLeftIcon className="h-4 w-4" />}
        nextIcon={<ChevronRightIcon className="h-4 w-4" />}
        superPrevIcon={<DoubleArrowLeftIcon className="h-4 w-4" />}
        superNextIcon={<DoubleArrowRightIcon className="h-4 w-4" />}
        panelRender={
          showQuickSelect
            ? (panel) => (
                <div className="grid min-h-[300px] grid-cols-[140px_1fr] rounded-lg overflow-hidden">
                  <div className="flex flex-col border-r border-gray-700 bg-dark-900 py-3">
                    {quickSelectButtons.map((button) => (
                      <QuickSelectButton
                        key={button.value}
                        value={button.value}
                        label={button.label}
                        isActive={button.isActive}
                        onClick={handleQuickSelect}
                      />
                    ))}
                  </div>
                  <div className="calendar-container">{panel}</div>
                </div>
              )
            : undefined
        }
      />
      {error && (
        <p className="mt-1 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
