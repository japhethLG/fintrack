"use client";

import type { FC } from "react";
import { Controller, get, useFormContext } from "react-hook-form";

import { cn } from "@/lib/utils/cn";
import { RadioGroup, type RadioGroupProps } from "@/components/common";

interface IProps extends Omit<RadioGroupProps, "value" | "onValueChange" | "error"> {
  inputName: string;
  isRequired?: boolean;
}

const FormRadioGroup: FC<IProps> = ({
  inputName,
  label,
  description,
  options,
  variant,
  orientation,
  className,
  isRequired = false,
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
        <RadioGroup
          {...rest}
          id={inputName}
          label={label ? (isRequired ? `${label} *` : label) : undefined}
          description={description}
          options={options}
          variant={variant}
          orientation={orientation}
          value={field.value}
          onValueChange={field.onChange}
          error={fieldError?.message as string | undefined}
          className={cn(className)}
        />
      )}
    />
  );
};

export default FormRadioGroup;
