"use client";

import React from "react";
import { Card, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";

interface IProps {
  icon: string;
  title: string;
  value: string | number;
  subtitle?: string;
  status?: "success" | "warning" | "danger" | "info";
}

const InsightCard: React.FC<IProps> = ({
  icon,
  title,
  value,
  subtitle,
  status = "info",
}) => {
  const statusColors = {
    success: "bg-success/20 text-success border-success/20",
    warning: "bg-warning/20 text-warning border-warning/20",
    danger: "bg-danger/20 text-danger border-danger/20",
    info: "bg-primary/20 text-primary border-primary/20",
  };

  return (
    <Card padding="md" className={cn("border", statusColors[status])}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center",
            statusColors[status]
          )}
        >
          <Icon name={icon} />
        </div>
        <div className="flex-1">
          <p className="text-gray-400 text-xs">{title}</p>
          <p className="text-white font-bold text-xl">{value}</p>
          {subtitle && <p className="text-gray-500 text-xs mt-1">{subtitle}</p>}
        </div>
      </div>
    </Card>
  );
};

export default InsightCard;
