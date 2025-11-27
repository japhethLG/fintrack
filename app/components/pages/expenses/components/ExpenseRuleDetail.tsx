"use client";

import React, { useState } from "react";
import { ExpenseRule } from "@/lib/types";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants";
import { Button, Card, Icon, Badge } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { EXPENSE_TYPE_ICONS, EXPENSE_TYPE_LABELS, FREQUENCY_LABELS } from "../constants";

interface IProps {
  rule: ExpenseRule;
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

const ExpenseRuleDetail: React.FC<IProps> = ({ rule, onEdit, onDelete, onToggleActive }) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const getScheduleDescription = () => {
    switch (rule.frequency) {
      case "semi-monthly":
        const days = rule.scheduleConfig.specificDays || [];
        return `On the ${days.map((d) => `${d}${getOrdinalSuffix(d)}`).join(" and ")} of each month`;
      case "weekly":
        return `Every ${getDayName(rule.scheduleConfig.dayOfWeek || 0)}`;
      case "bi-weekly":
        return `Every 2 weeks on ${getDayName(rule.scheduleConfig.dayOfWeek || 0)}`;
      case "monthly":
        const dayOfMonth = rule.scheduleConfig.dayOfMonth || 1;
        return `On the ${dayOfMonth}${getOrdinalSuffix(dayOfMonth)} of each month`;
      default:
        return FREQUENCY_LABELS[rule.frequency];
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
              rule.isActive ? "bg-danger/20 text-danger" : "bg-gray-700 text-gray-400"
            )}
          >
            <Icon name={EXPENSE_TYPE_ICONS[rule.expenseType] || "payments"} size={32} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">{rule.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="default">{EXPENSE_TYPE_LABELS[rule.expenseType]}</Badge>
              <Badge variant="default">{EXPENSE_CATEGORY_LABELS[rule.category]}</Badge>
              {rule.isPriority && <Badge variant="warning">Priority</Badge>}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" icon={<Icon name="edit" size="sm" />} onClick={onEdit}>
          Edit
        </Button>
      </div>

      {/* Amount */}
      <div className="bg-gray-800/50 rounded-xl p-6 mb-6">
        <p className="text-gray-400 text-sm mb-1">
          {rule.expenseType === "cash_loan" ? "Monthly Payment" : "Amount"}
        </p>
        <p className="text-4xl font-bold text-danger">
          $
          {rule.amount.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
        <p className="text-gray-400 text-sm mt-2">{getScheduleDescription()}</p>
      </div>

      {/* Loan Details */}
      {rule.loanConfig && (
        <div className="bg-gray-800/30 rounded-xl p-6 mb-6">
          <h4 className="font-bold text-white mb-4">Loan Details</h4>

          {/* Progress */}
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-400">Payoff Progress</span>
              <span className="text-white">
                $
                {(
                  rule.loanConfig.principalAmount - rule.loanConfig.currentBalance
                ).toLocaleString()}{" "}
                / ${rule.loanConfig.principalAmount.toLocaleString()}
              </span>
            </div>
            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-success rounded-full transition-all"
                style={{
                  width: `${((rule.loanConfig.principalAmount - rule.loanConfig.currentBalance) / rule.loanConfig.principalAmount) * 100}%`,
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-400">Original Principal</p>
              <p className="text-white font-medium">
                ${rule.loanConfig.principalAmount.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Current Balance</p>
              <p className="text-danger font-medium">
                ${rule.loanConfig.currentBalance.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Interest Rate</p>
              <p className="text-white font-medium">{rule.loanConfig.interestRate}% APR</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Payments Made</p>
              <p className="text-white font-medium">
                {rule.loanConfig.paymentsMade} / {rule.loanConfig.termMonths}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Credit Card Details */}
      {rule.creditConfig && (
        <div className="bg-gray-800/30 rounded-xl p-6 mb-6">
          <h4 className="font-bold text-white mb-4">Credit Card Details</h4>

          {/* Utilization */}
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-400">Credit Utilization</span>
              <span
                className={cn(
                  "font-medium",
                  rule.creditConfig.currentBalance / rule.creditConfig.creditLimit > 0.3
                    ? "text-danger"
                    : "text-success"
                )}
              >
                {((rule.creditConfig.currentBalance / rule.creditConfig.creditLimit) * 100).toFixed(
                  0
                )}
                %
              </span>
            </div>
            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  rule.creditConfig.currentBalance / rule.creditConfig.creditLimit > 0.3
                    ? "bg-danger"
                    : "bg-success"
                )}
                style={{
                  width: `${(rule.creditConfig.currentBalance / rule.creditConfig.creditLimit) * 100}%`,
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-400">Credit Limit</p>
              <p className="text-white font-medium">
                ${rule.creditConfig.creditLimit.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Current Balance</p>
              <p className="text-danger font-medium">
                ${rule.creditConfig.currentBalance.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">APR</p>
              <p className="text-white font-medium">{rule.creditConfig.apr}%</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Due Date</p>
              <p className="text-white font-medium">
                {rule.creditConfig.dueDate}
                {getOrdinalSuffix(rule.creditConfig.dueDate)} of month
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Payment Strategy</p>
              <p className="text-white font-medium capitalize">
                {rule.creditConfig.paymentStrategy === "fixed"
                  ? `Fixed $${rule.creditConfig.fixedPaymentAmount}`
                  : rule.creditConfig.paymentStrategy.replace("_", " ")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Installment Details */}
      {rule.installmentConfig && (
        <div className="bg-gray-800/30 rounded-xl p-6 mb-6">
          <h4 className="font-bold text-white mb-4">Installment Details</h4>

          {/* Progress */}
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-400">Payment Progress</span>
              <span className="text-white">
                {rule.installmentConfig.installmentsPaid} /{" "}
                {rule.installmentConfig.installmentCount} payments
              </span>
            </div>
            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-success rounded-full transition-all"
                style={{
                  width: `${(rule.installmentConfig.installmentsPaid / rule.installmentConfig.installmentCount) * 100}%`,
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-400">Total Amount</p>
              <p className="text-white font-medium">
                ${rule.installmentConfig.totalAmount.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Remaining</p>
              <p className="text-danger font-medium">
                $
                {(
                  (rule.installmentConfig.installmentCount -
                    rule.installmentConfig.installmentsPaid) *
                  rule.installmentConfig.installmentAmount
                ).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Each Payment</p>
              <p className="text-white font-medium">
                ${rule.installmentConfig.installmentAmount.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Interest</p>
              <p className="text-white font-medium">
                {rule.installmentConfig.hasInterest
                  ? `${rule.installmentConfig.interestRate}%`
                  : "0% (Interest-free)"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Details */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <p className="text-gray-400 text-sm mb-1">Start Date</p>
          <p className="text-white font-medium">{new Date(rule.startDate).toLocaleDateString()}</p>
        </div>
        <div>
          <p className="text-gray-400 text-sm mb-1">End Date</p>
          <p className="text-white font-medium">
            {rule.endDate ? new Date(rule.endDate).toLocaleDateString() : "Ongoing"}
          </p>
        </div>
        <div>
          <p className="text-gray-400 text-sm mb-1">Weekend Handling</p>
          <p className="text-white font-medium capitalize">
            {rule.weekendAdjustment === "none"
              ? "No adjustment"
              : `Pay ${rule.weekendAdjustment === "before" ? "Friday" : "Monday"} if weekend`}
          </p>
        </div>
        <div>
          <p className="text-gray-400 text-sm mb-1">Status</p>
          <Badge variant={rule.isActive ? "success" : "default"}>
            {rule.isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
      </div>

      {/* Notes */}
      {rule.notes && (
        <div className="mb-6">
          <p className="text-gray-400 text-sm mb-1">Notes</p>
          <p className="text-white">{rule.notes}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-6 border-t border-gray-800">
        <Button
          variant={rule.isActive ? "secondary" : "primary"}
          onClick={() => onToggleActive(!rule.isActive)}
          icon={<Icon name={rule.isActive ? "pause" : "play_arrow"} size="sm" />}
        >
          {rule.isActive ? "Deactivate" : "Activate"}
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

export default ExpenseRuleDetail;
