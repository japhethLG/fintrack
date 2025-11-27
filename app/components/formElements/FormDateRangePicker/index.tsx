"use client";

import type { FC } from "react";
import { Controller, get, useFormContext } from "react-hook-form";
import dayjs from "dayjs";

import { cn } from "@/lib/utils/cn";
import { DateRangePicker, type DateRangePickerProps, type DateRange } from "@/components/common";

interface IProps extends Omit<DateRangePickerProps, "value" | "onChange" | "error"> {
  inputName: string;
  isRequired?: boolean;
  /** The field name for start date (defaults to inputName + "Start") */
  startFieldName?: string;
  /** The field name for end date (defaults to inputName + "End") */
  endFieldName?: string;
}

const FormDateRangePicker: FC<IProps> = ({
  inputName,
  label,
  className,
  isRequired = false,
  startFieldName,
  endFieldName,
  format = "MM/DD/YYYY",
  ...rest
}) => {
  const {
    control,
    formState: { errors },
    setValue,
    watch,
  } = useFormContext();

  const fieldError = get(errors, inputName);
  const startField = startFieldName || `${inputName}Start`;
  const endField = endFieldName || `${inputName}End`;

  // Watch both fields
  const startValue = watch(startField);
  const endValue = watch(endField);

  // Convert to DateRange
  const value: DateRange = [
    startValue ? dayjs(startValue) : null,
    endValue ? dayjs(endValue) : null,
  ];

  return (
    <Controller
      control={control}
      name={inputName}
      render={() => (
        <DateRangePicker
          {...rest}
          id={inputName}
          label={label ? (isRequired ? `${label} *` : label) : undefined}
          format={format}
          value={value}
          onChange={(dates) => {
            // Set both start and end fields
            setValue(startField, dates[0]?.format("YYYY-MM-DD") || null);
            setValue(endField, dates[1]?.format("YYYY-MM-DD") || null);
          }}
          error={fieldError?.message as string | undefined}
          className={cn(className)}
        />
      )}
    />
  );
};

export default FormDateRangePicker;
