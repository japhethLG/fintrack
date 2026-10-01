"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  actions,
  className = "",
}) => {
  return (
    <header
      className={cn(
        // on a phone the actions stack under the title instead of squeezing (and covering) the subtitle
        "flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end mb-8",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-3xl font-bold text-white mb-2">{title}</h1>
        {description && <p className="text-gray-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3 sm:shrink-0">{actions}</div>}
    </header>
  );
};
