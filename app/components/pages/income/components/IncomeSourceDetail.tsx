"use client";

import React, { useState } from "react";
import { IncomeSource } from "@/lib/types";
import { Button, Card, Icon, Badge } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { SOURCE_TYPE_ICONS, FREQUENCY_LABELS } from "../constants";

interface IProps {
  source: IncomeSource;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: (isActive: boolean) => void;
}

const getOrdinalSuffix = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
};

const getDayName = (day: number) => {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day];
};

const IncomeSourceDetail: React.FC<IProps> = ({ source, onEdit, onDelete, onToggleActive }) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { formatCurrency } = useCurrency();

  const getScheduleDescription = () => {
    switch (source.frequency) {
      case "semi-monthly":
        const days = source.scheduleConfig.specificDays || [];
        return `On the ${days.map((d) => `${d}${getOrdinalSuffix(d)}`).join(" and ")} of each month`;
      case "weekly":
        return `Every ${getDayName(source.scheduleConfig.dayOfWeek || 0)}`;
      case "bi-weekly":
        return `Every 2 weeks on ${getDayName(source.scheduleConfig.dayOfWeek || 0)}`;
      case "monthly":
        const dayOfMonth = source.scheduleConfig.dayOfMonth || 1;
        return `On the ${dayOfMonth}${getOrdinalSuffix(dayOfMonth)} of each month`;
      default:
        return FREQUENCY_LABELS[source.frequency];
    }
  };

  return (
    <Card padding="lg">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "w-14 h-14 rounded-xl flex items-center justify-center",
              source.isActive ? "bg-success/20 text-success" : "bg-gray-700 text-gray-400"
            )}
          >
            <Icon name={SOURCE_TYPE_ICONS[source.sourceType] || "attach_money"} size={32} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">{source.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="default" className="capitalize">
                {source.sourceType}
              </Badge>
              <Badge variant="default">{source.category}</Badge>
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" icon={<Icon name="edit" size="sm" />} onClick={onEdit}>
          Edit
        </Button>
      </div>

      {/* Amount */}
      <div className="bg-gray-800/50 rounded-xl p-6 mb-6">
        <p className="text-gray-400 text-sm mb-1">Amount</p>
        <p className="text-4xl font-bold text-success">
          {formatCurrency(source.amount, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          {source.isVariableAmount && (
            <span className="text-lg text-gray-400 font-normal ml-2">(Variable)</span>
          )}
        </p>
        <p className="text-gray-400 text-sm mt-2">{getScheduleDescription()}</p>
      </div>

      {/* Schedule Details */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <p className="text-gray-400 text-sm mb-1">Start Date</p>
          <p className="text-white font-medium">
            {new Date(source.startDate).toLocaleDateString()}
          </p>
        </div>
        <div>
          <p className="text-gray-400 text-sm mb-1">End Date</p>
          <p className="text-white font-medium">
            {source.endDate ? new Date(source.endDate).toLocaleDateString() : "Ongoing"}
          </p>
        </div>
        <div>
          <p className="text-gray-400 text-sm mb-1">Weekend Handling</p>
          <p className="text-white font-medium capitalize">
            {source.weekendAdjustment === "none"
              ? "No adjustment"
              : `Pay ${source.weekendAdjustment === "before" ? "Friday" : "Monday"} if weekend`}
          </p>
        </div>
        <div>
          <p className="text-gray-400 text-sm mb-1">Status</p>
          <Badge variant={source.isActive ? "success" : "default"}>
            {source.isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
      </div>

      {/* Notes */}
      {source.notes && (
        <div className="mb-6">
          <p className="text-gray-400 text-sm mb-1">Notes</p>
          <p className="text-white">{source.notes}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-6 border-t border-gray-800">
        <Button
          variant={source.isActive ? "secondary" : "primary"}
          onClick={() => onToggleActive(!source.isActive)}
          icon={<Icon name={source.isActive ? "pause" : "play_arrow"} size="sm" />}
        >
          {source.isActive ? "Deactivate" : "Activate"}
        </Button>

        {showDeleteConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Are you sure?</span>
            <Button variant="danger" size="sm" onClick={onDelete}>
              Yes, Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            className="text-danger hover:text-danger"
            onClick={() => setShowDeleteConfirm(true)}
            icon={<Icon name="delete" size="sm" />}
          >
            Delete
          </Button>
        )}
      </div>
    </Card>
  );
};

export default IncomeSourceDetail;
