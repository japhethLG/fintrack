"use client";

import type { FC } from "react";
import { Controller, get, useFormContext } from "react-hook-form";
import dayjs from "dayjs";

import { cn } from "@/lib/utils/cn";
import { DatePicker, type DatePickerProps } from "@/components/common";

interface IProps extends Omit<DatePickerProps, "value" | "onChange" | "error"> {
  inputName: string;
  isRequired?: boolean;
  /** Return ISO string instead of formatted string */
  returnIsoString?: boolean;
}

const FormDatePicker: FC<IProps> = ({
  inputName,
  label,
  className,
  isRequired = false,
  returnIsoString = false,
  format = "MM/DD/YYYY",
  ...rest
}) => {
  const {
    control,
    formState: { errors },
  } = useFormContext();

  const fieldError = get(errors, inputName);

  return (
    <Controller
      control={control}
      name={inputName}
      render={({ field }) => {
        // Convert string value to Dayjs for the picker
        const value = field.value ? dayjs(field.value) : null;

        return (
          <DatePicker
            {...rest}
            id={inputName}
            label={label ? (isRequired ? `${label} *` : label) : undefined}
            format={format}
            value={value}
            onChange={(date) => {
              if (date) {
                // Return either ISO string or formatted string based on prop
                const outputValue = returnIsoString
                  ? date.toISOString()
                  : date.format("YYYY-MM-DD");
                field.onChange(outputValue);
              } else {
                field.onChange(null);
              }
            }}
            error={fieldError?.message as string | undefined}
            className={cn(className)}
          />
        );
      }}
    />
  );
};

export default FormDatePicker;
