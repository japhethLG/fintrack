"use client";

import React, { type ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { FormProvider } from "react-hook-form";

import { cn } from "@/lib/utils/cn";

interface IProps<T extends FieldValues> {
  children: ReactNode;
  methods: UseFormReturn<T>;
  onSubmit: (values: T) => void;
  className?: string;
}

const Form = <T extends FieldValues>({
  children,
  methods,
  onSubmit,
  className,
}: IProps<T>): React.ReactElement => (
  <FormProvider {...methods}>
    <form className={cn("w-full", className)} onSubmit={methods.handleSubmit(onSubmit)}>
      {children}
    </form>
  </FormProvider>
);

export default Form;
