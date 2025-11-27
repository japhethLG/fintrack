"use client";

import type { FC, ReactNode } from "react";

import { Button, type ButtonProps } from "@/components/common";

interface IProps extends Omit<ButtonProps, "type"> {
  children: ReactNode;
  isLoading?: boolean;
}

const FormSubmit: FC<IProps> = ({ children, isLoading = false, disabled, ...rest }) => (
  <Button variant="primary" type="submit" disabled={disabled || isLoading} {...rest}>
    {isLoading ? "Loading..." : children}
  </Button>
);

export default FormSubmit;
