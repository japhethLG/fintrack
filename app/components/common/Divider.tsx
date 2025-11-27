"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";

export interface DividerProps {
  text?: string;
  variant?: "solid" | "dashed";
  vertical?: boolean;
  className?: string;
}

export const Divider: React.FC<DividerProps> = ({
  text,
  variant = "solid",
  vertical = false,
  className = "",
}) => {
  const borderStyle = variant === "dashed" ? "border-dashed" : "border-solid";

  if (vertical) {
    return (
      <div
        className={cn("w-px h-full border-l border-gray-700", borderStyle, className)}
        aria-orientation="vertical"
      />
    );
  }

  if (text) {
    return (
      <div className={cn("relative", className)}>
        <div className={cn("absolute inset-0 flex items-center", borderStyle)}>
          <div className={cn("w-full border-t border-gray-700", borderStyle)}></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-[#1a2336] text-gray-400">{text}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("w-full border-t border-gray-700", borderStyle, className)}
      aria-orientation="horizontal"
    />
  );
};
