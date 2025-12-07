"use client";

import React, { useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Icon } from "@/components/common";
import { DeletableDataType } from "@/lib/types";

interface IProps {
  /** Map of collection counts to display next to each option */
  counts?: Partial<Record<DeletableDataType, number>>;
  /** Called when the user confirms with the selected data types */
  onConfirm: (selected: DeletableDataType[]) => void;
  /** Called when the modal should be closed */
  onCancel: () => void;
  /** Disable actions while a request is in-flight */
  isSubmitting?: boolean;
}

const ALL_TYPES: DeletableDataType[] = [
  "income_sources",
  "expense_rules",
  "transactions",
  "balance_history",
  "alerts",
];

type SelectionKey = DeletableDataType | "all";

const OPTIONS: Array<{ key: SelectionKey; label: string; description: string }> = [
  {
    key: "all",
    label: "All Financial Data",
    description: "Everything below (resets balance to $0)",
  },
  { key: "income_sources", label: "Income Sources", description: "Recurring/one-time income" },
  { key: "expense_rules", label: "Expense Rules", description: "Bills, loans, credit cards" },
  { key: "transactions", label: "Transactions", description: "Projected and completed items" },
  { key: "balance_history", label: "Balance History", description: "Daily balance snapshots" },
  { key: "alerts", label: "Alerts", description: "Notifications and reminders" },
];

const SelectiveResetModal: React.FC<IProps> = ({ counts = {}, onConfirm, onCancel, isSubmitting }) => {
  const [selected, setSelected] = useState<SelectionKey[]>([]);

  const hasSelection = selected.length > 0;
  const hasAllSelected = selected.includes("all");

  const optionCounts = useMemo(
    () =>
      OPTIONS.map((option) => ({
        ...option,
        count: option.key === "all" ? ALL_TYPES.reduce((sum, type) => sum + (counts[type] ?? 0), 0) : counts[option.key] ?? 0,
      })),
    [counts]
  );

  const toggleSelection = (type: SelectionKey) => {
    setSelected((prev) => {
      if (type === "all") {
        return prev.includes("all") ? [] : ["all", ...ALL_TYPES];
      }

      const next = prev.includes(type) ? prev.filter((item) => item !== type) : [...prev, type];
      const cleaned = next.filter((item, idx, arr) => arr.indexOf(item) === idx);

      const hasAllSubSelections = ALL_TYPES.every((t) => cleaned.includes(t));
      if (hasAllSubSelections && !cleaned.includes("all")) {
        return ["all", ...ALL_TYPES];
      }

      return cleaned.filter((item) => item !== "all" || hasAllSubSelections);
    });
  };

  const effectiveSelection = hasAllSelected
    ? ALL_TYPES
    : selected.filter((item): item is DeletableDataType => item !== "all");

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <Card padding="lg" className="w-full max-w-xl animate-fade-in">
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-warning/20 flex items-center justify-center shrink-0">
            <Icon name="warning" size={24} className="text-warning" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-white">Selective Data Reset</h2>
            <p className="text-gray-400 text-sm mt-1">
              Choose which financial data to permanently delete. Your account and preferences will be
              preserved.
            </p>
          </div>
        </div>

        {/* Warning */}
        <Alert variant="warning" className="mb-5">
          This action cannot be undone. Transactions and balance history resets will also set your
          balance to $0.
        </Alert>

        {/* Options */}
        <div className="space-y-3 mb-6">
          {optionCounts.map(({ key, label, description, count }) => (
            <div
              key={key}
              className="p-4 rounded-lg border border-gray-800 bg-gray-900/40 hover:border-gray-700 transition-colors duration-200"
            >
              <div className="flex items-start justify-between gap-4">
                <Checkbox
                  label={label}
                  description={`${description} • ${count} item${count === 1 ? "" : "s"}`}
                  checked={selected.includes(key)}
                  onCheckedChange={() => toggleSelection(key)}
                  disabled={isSubmitting}
                  className="flex-1"
                />
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  Type: <span className="font-mono text-gray-300">{key}</span>
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            type="button"
            variant="ghost"
            className="flex-1"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="flex-1 border-warning/50 text-warning hover:bg-warning/10"
            onClick={() => onConfirm(effectiveSelection)}
            disabled={!hasSelection || isSubmitting}
            loading={isSubmitting}
          >
            {isSubmitting ? "Preparing..." : "Continue"}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default SelectiveResetModal;

