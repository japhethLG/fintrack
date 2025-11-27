"use client";

import type { FC } from "react";
import { Controller, get, useFormContext } from "react-hook-form";

import { cn } from "@/lib/utils/cn";
import { Checkbox, type CheckboxProps } from "@/components/common";

interface IProps extends Omit<CheckboxProps, "error" | "checked" | "onCheckedChange"> {
  inputName: string;
}

const FormCheckbox: FC<IProps> = ({ inputName, label, description, className, ...rest }) => {
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
        <Checkbox
          {...rest}
          id={inputName}
          label={label}
          description={description}
          checked={field.value}
          onCheckedChange={field.onChange}
          error={fieldError?.message as string | undefined}
          className={cn(className)}
        />
      )}
    />
  );
};

export default FormCheckbox;
