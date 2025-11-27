"use client";

import type { FC } from "react";
import { Controller, get, useFormContext } from "react-hook-form";

import { cn } from "@/lib/utils/cn";
import { TextArea, type TextAreaProps } from "@/components/common";

interface IProps extends Omit<TextAreaProps, "error"> {
  inputName: string;
  isRequired?: boolean;
}

const FormTextArea: FC<IProps> = ({ inputName, label, isRequired = false, className, ...rest }) => {
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
        <TextArea
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

export default FormTextArea;
