"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";
import type { ButtonProps } from "./Button";
import { Button } from "./Button";
import type { DropdownProps } from "./Dropdown";
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "./Dropdown";

export interface MultiSelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface MultiSelectDropdownProps {
  /** Options to display */
  options: MultiSelectOption[];
  /** Selected values */
  value: string[];
  /** Change handler */
  onChange: (values: string[]) => void;
  /** Optional "all" sentinel value */
  allValue?: string;
  /** Text to show when all are selected or nothing selected */
  placeholder?: string;
  /** Custom trigger label renderer */
  renderLabel?: (selectedOptions: MultiSelectOption[], isAllSelected: boolean) => string;
  /** Trigger button appearance */
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  /** Optional icon for the trigger */
  triggerIcon?: React.ReactNode;
  /** Trigger class override */
  className?: string;
  /** Content class override */
  contentClassName?: string;
  /** Dropdown positioning */
  side?: DropdownProps["side"];
  align?: DropdownProps["align"];
  sideOffset?: number;
}

export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  options,
  value,
  onChange,
  allValue = "all",
  placeholder = "All",
  renderLabel,
  triggerVariant = "secondary",
  triggerSize = "md",
  triggerIcon,
  className,
  contentClassName,
  side = "bottom",
  align = "end",
  sideOffset = 4,
}) => {
  const isAllSelected = value.includes(allValue);
  const selectedOptions = options.filter(
    (option) => value.includes(option.value) && option.value !== allValue
  );

  const label = renderLabel
    ? renderLabel(selectedOptions, isAllSelected)
    : isAllSelected || selectedOptions.length === 0
      ? placeholder
      : `${selectedOptions.length} selected`;

  const toggleValue = (optionValue: string) => {
    if (optionValue === allValue) {
      onChange([allValue]);
      return;
    }

    const withoutAll = value.filter((v) => v !== allValue);
    const exists = withoutAll.includes(optionValue);
    const next = exists
      ? withoutAll.filter((v) => v !== optionValue)
      : [...withoutAll, optionValue];

    onChange(next.length === 0 ? [allValue] : next);
  };

  const isChecked = (optionValue: string) =>
    optionValue === allValue ? isAllSelected : value.includes(optionValue);

  return (
    <DropdownMenuRoot>
      <DropdownMenuTrigger asChild>
        <Button
          variant={triggerVariant}
          size={triggerSize}
          icon={triggerIcon}
          iconPosition="left"
          className={className}
        >
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn("w-64", contentClassName)}
      >
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={isChecked(option.value)}
            onCheckedChange={() => toggleValue(option.value)}
            disabled={option.disabled}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenuRoot>
  );
};

export default MultiSelectDropdown;
