"use client";

import React, { useState, useMemo } from "react";
import { ExpenseRule } from "@/lib/types";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants";
import { Button, Card, Icon, Badge, Tooltip } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { EXPENSE_TYPE_ICONS, EXPENSE_TYPE_LABELS, FREQUENCY_LABELS } from "../constants";
import {
  calculatePayoffSummary,
  calculateMinimumPayment,
  formatPayoffTime,
  type CreditCardPayoffSummary,
  type PayoffScenario,
} from "@/lib/logic/creditCardCalculator";

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
  const [showPayoffScenarios, setShowPayoffScenarios] = useState(false);
  const { formatCurrency } = useCurrency();

  // Get the display amount based on payment strategy for credit cards
  const getDisplayAmount = () => {
    if (rule.creditConfig) {
      if (rule.creditConfig.paymentStrategy === "fixed" && rule.creditConfig.fixedPaymentAmount) {
        return rule.creditConfig.fixedPaymentAmount;
      }
      if (rule.creditConfig.paymentStrategy === "full_balance") {
        return rule.creditConfig.currentBalance;
      }
    }
    return rule.amount;
  };

  // Calculate estimated minimum payment for credit cards
  const getEstimatedMinimumPayment = () => {
    if (!rule.creditConfig) return 0;
    return calculateMinimumPayment(rule.creditConfig);
  };

  // Calculate credit card payoff summary
  const creditPayoffSummary = useMemo((): CreditCardPayoffSummary | null => {
    if (!rule.creditConfig) return null;
    return calculatePayoffSummary(rule.creditConfig);
  }, [rule.creditConfig]);

  const displayAmount = getDisplayAmount();

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
          {rule.expenseType === "cash_loan"
            ? "Monthly Payment"
            : rule.creditConfig?.paymentStrategy === "fixed"
              ? "Fixed Payment"
              : rule.creditConfig?.paymentStrategy === "full_balance"
                ? "Full Balance Payment"
                : rule.creditConfig
                  ? "Est. Min Payment"
                  : "Amount"}
        </p>
        <p className="text-4xl font-bold text-danger">
          {formatCurrency(displayAmount, {
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
                {formatCurrency(rule.loanConfig.principalAmount - rule.loanConfig.currentBalance)} /{" "}
                {formatCurrency(rule.loanConfig.principalAmount)}
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
                {formatCurrency(rule.loanConfig.principalAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Current Balance</p>
              <p className="text-danger font-medium">
                {formatCurrency(rule.loanConfig.currentBalance)}
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
      {rule.creditConfig && creditPayoffSummary && (
        <div className="space-y-4 mb-6">
          {/* Card Overview */}
          <div className="bg-gray-800/30 rounded-xl p-6">
            <h4 className="font-bold text-white mb-4 flex items-center gap-2">
              <Icon name="credit_card" size={20} />
              Credit Card Overview
            </h4>

            {/* Credit Utilization */}
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
                  {((rule.creditConfig.currentBalance / rule.creditConfig.creditLimit) * 100).toFixed(0)}%
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
                    width: `${Math.min(100, (rule.creditConfig.currentBalance / rule.creditConfig.creditLimit) * 100)}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-400">Credit Limit</p>
                <p className="text-white font-medium">{formatCurrency(rule.creditConfig.creditLimit)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Current Balance</p>
                <p className="text-danger font-medium">{formatCurrency(rule.creditConfig.currentBalance)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Available Credit</p>
                <p className="text-success font-medium">
                  {formatCurrency(rule.creditConfig.creditLimit - rule.creditConfig.currentBalance)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">APR</p>
                <p className="text-white font-medium">{rule.creditConfig.apr}%</p>
              </div>
            </div>
          </div>

          {/* Payoff Timeline */}
          <div className="bg-gray-800/30 rounded-xl p-6">
            <h4 className="font-bold text-white mb-4 flex items-center gap-2">
              <Icon name="event" size={20} />
              Payoff Timeline
              {creditPayoffSummary.isMinimumPaymentTrap && (
                <Tooltip content="Your payment barely covers interest. Consider increasing your payment.">
                  <Badge variant="danger" className="ml-2">
                    <Icon name="warning" size={14} className="mr-1" />
                    Warning
                  </Badge>
                </Tooltip>
              )}
            </h4>

            {/* Payoff Progress */}
            {creditPayoffSummary.payoffDate && (
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Payoff Progress</span>
                  <span className="text-white">
                    {formatPayoffTime(creditPayoffSummary.monthsToPayoff)} remaining
                  </span>
                </div>
                <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{
                      // Progress = principal paid so far / total to pay
                      width: `${creditPayoffSummary.principalPaidSoFar > 0
                        ? Math.min(100, (creditPayoffSummary.principalPaidSoFar / rule.creditConfig.currentBalance) * 100)
                        : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-400">Estimated Payoff Date</p>
                <p className={cn("font-medium", creditPayoffSummary.payoffDate ? "text-white" : "text-danger")}>
                  {creditPayoffSummary.payoffDate
                    ? creditPayoffSummary.payoffDate.toLocaleDateString("en-US", {
                        month: "short",
                        year: "numeric",
                      })
                    : "Never"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Time to Pay Off</p>
                <p className={cn("font-medium", creditPayoffSummary.monthsToPayoff > 60 ? "text-warning" : "text-white")}>
                  {formatPayoffTime(creditPayoffSummary.monthsToPayoff)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Payments Remaining</p>
                <p className="text-white font-medium">
                  {isFinite(creditPayoffSummary.monthsToPayoff) ? creditPayoffSummary.monthsToPayoff : "∞"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Current Payment</p>
                <p className="text-primary font-medium">
                  {formatCurrency(creditPayoffSummary.effectiveMonthlyPayment, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* Cost Breakdown */}
          <div className="bg-gray-800/30 rounded-xl p-6">
            <h4 className="font-bold text-white mb-4 flex items-center gap-2">
              <Icon name="payments" size={20} />
              Cost Breakdown
            </h4>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-xs text-gray-400">Principal (Balance)</p>
                <p className="text-white font-medium">{formatCurrency(rule.creditConfig.currentBalance)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Total Interest to Pay</p>
                <p className={cn("font-medium", isFinite(creditPayoffSummary.totalInterestToPay) ? "text-danger" : "text-danger")}>
                  {isFinite(creditPayoffSummary.totalInterestToPay)
                    ? formatCurrency(creditPayoffSummary.totalInterestToPay)
                    : "Accumulating"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Total Amount to Pay</p>
                <p className="text-white font-medium">
                  {isFinite(creditPayoffSummary.totalAmountToPay)
                    ? formatCurrency(creditPayoffSummary.totalAmountToPay)
                    : "N/A"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Monthly Interest Charge</p>
                <p className="text-warning font-medium">
                  {formatCurrency(creditPayoffSummary.currentMonthlyInterest, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>

            {/* Interest vs Principal visualization */}
            {isFinite(creditPayoffSummary.totalInterestToPay) && (
              <div className="mt-4 p-4 bg-gray-900/50 rounded-lg">
                <p className="text-xs text-gray-400 mb-2">Payment Breakdown Visualization</p>
                <div className="flex h-6 rounded-lg overflow-hidden">
                  <div
                    className="bg-primary flex items-center justify-center text-xs font-medium text-white"
                    style={{
                      width: `${(rule.creditConfig.currentBalance / creditPayoffSummary.totalAmountToPay) * 100}%`,
                    }}
                  >
                    {((rule.creditConfig.currentBalance / creditPayoffSummary.totalAmountToPay) * 100).toFixed(0)}%
                  </div>
                  <div
                    className="bg-danger flex items-center justify-center text-xs font-medium text-white"
                    style={{
                      width: `${(creditPayoffSummary.totalInterestToPay / creditPayoffSummary.totalAmountToPay) * 100}%`,
                    }}
                  >
                    {((creditPayoffSummary.totalInterestToPay / creditPayoffSummary.totalAmountToPay) * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="flex justify-between mt-2 text-xs">
                  <span className="text-primary">Principal: {formatCurrency(rule.creditConfig.currentBalance)}</span>
                  <span className="text-danger">Interest: {formatCurrency(creditPayoffSummary.totalInterestToPay)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Payment & Schedule Details */}
          <div className="bg-gray-800/30 rounded-xl p-6">
            <h4 className="font-bold text-white mb-4 flex items-center gap-2">
              <Icon name="schedule" size={20} />
              Payment Details
            </h4>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-400">Due Date</p>
                <p className="text-white font-medium">
                  {rule.creditConfig.dueDate}
                  {getOrdinalSuffix(rule.creditConfig.dueDate)} of month
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Statement Date</p>
                <p className="text-white font-medium">
                  {rule.creditConfig.statementDate}
                  {getOrdinalSuffix(rule.creditConfig.statementDate)} of month
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Est. Minimum Payment</p>
                <p className="text-warning font-medium">
                  {formatCurrency(getEstimatedMinimumPayment(), {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Min Payment Rule</p>
                <p className="text-white font-medium text-sm">
                  {rule.creditConfig.minimumPaymentPercent}%
                  {rule.creditConfig.minimumPaymentMethod === "percent_plus_interest" ? " + Interest" : " of Balance"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Payment Strategy</p>
                <p className="text-white font-medium capitalize">
                  {rule.creditConfig.paymentStrategy === "fixed"
                    ? `Fixed ${formatCurrency(rule.creditConfig.fixedPaymentAmount || 0)}`
                    : rule.creditConfig.paymentStrategy === "full_balance"
                      ? "Full Balance"
                      : "Minimum"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Minimum Floor</p>
                <p className="text-white font-medium">{formatCurrency(rule.creditConfig.minimumPaymentFloor)}</p>
              </div>
            </div>
          </div>

          {/* Payoff Scenarios */}
          {creditPayoffSummary.scenarios.length > 0 && (
            <div className="bg-gray-800/30 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-bold text-white flex items-center gap-2">
                  <Icon name="lightbulb" size={20} />
                  Pay Off Faster
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPayoffScenarios(!showPayoffScenarios)}
                  icon={<Icon name={showPayoffScenarios ? "expand_less" : "expand_more"} size="sm" />}
                >
                  {showPayoffScenarios ? "Hide" : "Show"} Options
                </Button>
              </div>

              {showPayoffScenarios && (
                <div className="space-y-3">
                  {creditPayoffSummary.scenarios.map((scenario: PayoffScenario, index: number) => (
                    <div
                      key={index}
                      className="p-4 bg-gray-900/50 rounded-lg border border-gray-700 hover:border-primary/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-white">{scenario.name}</span>
                        <Badge variant="success">
                          Save {formatCurrency(scenario.interestSavings)}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-xs text-gray-400">Monthly Payment</p>
                          <p className="text-primary font-medium">{formatCurrency(scenario.monthlyPayment)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Time to Pay Off</p>
                          <p className="text-white">{formatPayoffTime(scenario.monthsToPayoff)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Total Interest</p>
                          <p className="text-white">{formatCurrency(scenario.totalInterest)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Time Saved</p>
                          <p className="text-success">{formatPayoffTime(scenario.timeSavingsMonths)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!showPayoffScenarios && (
                <p className="text-sm text-gray-400">
                  See how you could save up to{" "}
                  <span className="text-success font-medium">
                    {formatCurrency(Math.max(...creditPayoffSummary.scenarios.map((s) => s.interestSavings)))}
                  </span>{" "}
                  in interest by increasing your payments.
                </p>
              )}
            </div>
          )}
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
                {formatCurrency(rule.installmentConfig.totalAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Remaining</p>
              <p className="text-danger font-medium">
                {formatCurrency(
                  (rule.installmentConfig.installmentCount -
                    rule.installmentConfig.installmentsPaid) *
                    rule.installmentConfig.installmentAmount
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Each Payment</p>
              <p className="text-white font-medium">
                {formatCurrency(rule.installmentConfig.installmentAmount, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
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
