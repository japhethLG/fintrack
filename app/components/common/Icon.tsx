"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";

export interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | number;
  variant?: "outlined" | "filled" | "rounded";
  className?: string;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = "md",
  variant = "outlined",
  className = "",
  ...rest
}) => {
  const sizeMap = {
    xs: "text-[16px]",
    sm: "text-[20px]",
    md: "text-[24px]",
    lg: "text-[28px]",
    xl: "text-[32px]",
  };

  const sizeClass = typeof size === "number" ? "" : sizeMap[size];
  const sizeStyle = typeof size === "number" ? { fontSize: `${size}px` } : {};

  const variantClass =
    variant === "filled"
      ? "material-symbols-filled"
      : variant === "rounded"
        ? "material-symbols-rounded"
        : "material-symbols-outlined";

  const classes = cn(variantClass, sizeClass, className);

  return (
    <span className={classes} style={sizeStyle} {...rest}>
      {name}
    </span>
  );
};
