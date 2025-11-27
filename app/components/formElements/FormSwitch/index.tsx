"use client";

import type { FC } from "react";
import { Controller, get, useFormContext } from "react-hook-form";

import { cn } from "@/lib/utils/cn";
import { Switch, type SwitchProps } from "@/components/common";

interface IProps extends Omit<SwitchProps, "checked" | "onCheckedChange"> {
  inputName: string;
}

const FormSwitch: FC<IProps> = ({ inputName, label, description, className, ...rest }) => {
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
        <div className={cn("w-full", className)}>
          <Switch
            {...rest}
            id={inputName}
            label={label}
            description={description}
            checked={field.value}
            onCheckedChange={field.onChange}
          />
          {fieldError?.message && (
            <p className="mt-1 text-sm text-danger" role="alert">
              {fieldError.message as string}
            </p>
          )}
        </div>
      )}
    />
  );
};

export default FormSwitch;
