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
  /**
   * When false, Enter in a field never submits the form (a wizard saves only from its button: Enter in a
   * date field confirms the date, it must not save the rule). Default true.
   */
  submitOnEnter?: boolean;
}

/**
 * Enter in a field (not a textarea, not a button) would trigger the browser's implicit submission. Runs in the
 * CAPTURE phase: the antd date picker stops Enter's propagation, so a bubbling handler never sees it.
 */
const blockImplicitSubmit = (event: React.KeyboardEvent<HTMLFormElement>) => {
  const target = event.target as HTMLElement;
  if (event.key === "Enter" && target instanceof HTMLInputElement) event.preventDefault();
};

const Form = <T extends FieldValues>({
  children,
  methods,
  onSubmit,
  className,
  submitOnEnter = true,
}: IProps<T>): React.ReactElement => (
  <FormProvider {...methods}>
    <form
      className={cn("w-full", className)}
      onSubmit={methods.handleSubmit(onSubmit)}
      onKeyDownCapture={submitOnEnter ? undefined : blockImplicitSubmit}
    >
      {children}
    </form>
  </FormProvider>
);

export default Form;
