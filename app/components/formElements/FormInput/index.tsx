"use client";

import type { FC } from "react";
import { Controller, get, useFormContext } from "react-hook-form";

import { cn } from "@/lib/utils/cn";
import { Input, type InputProps } from "@/components/common";

interface IProps extends Omit<InputProps, "error"> {
  inputName: string;
  isRequired?: boolean;
}

const FormInput: FC<IProps> = ({ inputName, label, isRequired = false, className, ...rest }) => {
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
        <Input
          {...rest}
          {...field}
          id={inputName}
          label={label ? (isRequired ? `${label} *` : label) : undefined}
          error={fieldError?.message as string | undefined}
          className={cn(className)}
        />
      )}
    />
  );
};

export default FormInput;
