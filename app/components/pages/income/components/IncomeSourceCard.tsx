"use client";

import React from "react";
import { IncomeSource } from "@/lib/types";
import { Icon, Badge } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { SOURCE_TYPE_ICONS, FREQUENCY_LABELS } from "../constants";

interface IProps {
  source: IncomeSource;
  isSelected: boolean;
  onClick: () => void;
}

const IncomeSourceCard: React.FC<IProps> = ({ source, isSelected, onClick }) => {
  const { formatCurrency } = useCurrency();
  return (
    <div
      className={cn(
        "p-4 border-b border-gray-800 cursor-pointer transition-all",
        isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-gray-800/50"
      )}
      onClick={onClick}
    >
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center",
              source.isActive ? "bg-success/20 text-success" : "bg-gray-700 text-gray-400"
            )}
          >
            <Icon name={SOURCE_TYPE_ICONS[source.sourceType] || "attach_money"} />
          </div>
          <div>
            <h4 className="font-bold text-white">{source.name}</h4>
            <p className="text-xs text-gray-400 capitalize">{source.sourceType}</p>
          </div>
        </div>
        {!source.isActive && (
          <Badge variant="default" className="text-xs">
            Inactive
          </Badge>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-success font-bold">
          {formatCurrency(source.amount)}
          {source.isVariableAmount && (
            <span className="text-xs text-gray-400 font-normal ml-1">~</span>
          )}
        </p>
        <p className="text-xs text-gray-500">{FREQUENCY_LABELS[source.frequency]}</p>
      </div>
    </div>
  );
};

export default IncomeSourceCard;
