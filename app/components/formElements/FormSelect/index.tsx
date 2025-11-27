"use client";

import type { FC } from "react";
import { Controller, get, useFormContext } from "react-hook-form";

import { cn } from "@/lib/utils/cn";
import { Select, type SelectProps } from "@/components/common";

interface IProps extends Omit<SelectProps, "error" | "onChange"> {
  inputName: string;
  isRequired?: boolean;
}

const FormSelect: FC<IProps> = ({
  inputName,
  label,
  isRequired = false,
  className,
  options,
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
      render={({ field }) => (
        <Select
          {...rest}
          {...field}
          id={inputName}
          options={options}
          onChange={(value) => field.onChange(value)}
          label={label ? (isRequired ? `${label} *` : label) : undefined}
          error={fieldError?.message as string | undefined}
          className={cn(className)}
        />
      )}
    />
  );
};

export default FormSelect;
