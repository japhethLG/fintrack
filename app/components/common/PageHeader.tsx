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
		<header className={cn("flex justify-between items-end mb-8", className)}>
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">{title}</h1>
        {description && <p className="text-gray-400">{description}</p>}
      </div>
      {actions && <div className="flex gap-3">{actions}</div>}
    </header>
  );
};
