"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useFinancial } from "@/contexts/FinancialContext";
import { ExpenseRule, ExpenseRuleFormData } from "@/lib/types";
import {
  Alert,
  Button,
  Card,
  PageHeader,
  Icon,
  LoadingSpinner,
  MultiSelectDropdown,
} from "@/components/common";
import { useCurrency } from "@/lib/hooks/useCurrency";
import ExpenseRuleForm from "./components/ExpenseRuleForm";
import { expenseRuleToFormValues } from "./components/ExpenseRuleForm/formHelpers";
import ExpenseRuleCard from "./components/ExpenseRuleCard";
import ExpenseRuleDetail from "./components/ExpenseRuleDetail";
import { EXPENSE_FILTER_OPTIONS } from "./constants";
import { getTodayKey, parseDate } from "@/lib/utils/dateUtils";
import {
  isExpenseRuleCurrent,
  monthBounds,
  recurringPeriodTotals,
  totalDebt,
} from "@/lib/logic/forecasting";
import dayjs from "dayjs";
import UpcomingBillsWidget from "./components/UpcomingBillsWidget";

const ExpenseManager: React.FC = () => {
  const { formatCurrency } = useCurrency();
  const {
    expenseRules,
    transactions,
    isLoading,
    createExpenseRule,
    editExpenseRule,
    removeExpenseRule,
    toggleExpenseRuleActive,
  } = useFinancial();

  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<ExpenseRule | null>(null);
  const [filterTypes, setFilterTypes] = useState<string[]>(["all"]);

  // Handle query param for auto-selecting rule (from transaction modal)
  const searchParams = useSearchParams();
  useEffect(() => {
    const sourceId = searchParams.get("source");
    if (sourceId && expenseRules.some((r) => r.id === sourceId)) {
      setSelectedRuleId(sourceId);
    }
  }, [searchParams, expenseRules]);

  const selectedRule = selectedRuleId ? expenseRules.find((r) => r.id === selectedRuleId) : null;

  const isAllSelected = filterTypes.includes("all");

  const filteredRules = expenseRules.filter((rule) => {
    if (isAllSelected || filterTypes.length === 0) return true;

    const matchesPriority = filterTypes.includes("priority") && rule.isPriority;
    const matchesDebt =
      filterTypes.includes("debt") &&
      (rule.expenseType === "cash_loan" || rule.expenseType === "credit_card");
    const matchesType = filterTypes.some(
      (type) =>
        !["all", "priority", "debt"].includes(type) &&
        rule.expenseType === (type as ExpenseRule["expenseType"])
    );

    return matchesPriority || matchesDebt || matchesType;
  });

  const handleCreateRule = async (data: ExpenseRuleFormData) => {
    const rule = await createExpenseRule(data);
    setShowForm(false);
    setSelectedRuleId(rule.id);
  };

  const handleEditRule = async (data: ExpenseRuleFormData) => {
    if (!editingRule) return;
    await editExpenseRule(editingRule.id, data);
    setEditingRule(null);
    setShowForm(false);
  };

  // A rejected delete / deactivate is shown to the user (E2E-ROB-04); it used to be an unhandled rejection
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDeleteRule = async () => {
    if (!selectedRuleId) return;
    setActionError(null);
    try {
      await removeExpenseRule(selectedRuleId);
      setSelectedRuleId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete expense rule");
    }
  };

  const handleToggleActive = async (isActive: boolean) => {
    if (!selectedRuleId) return;
    setActionError(null);
    try {
      await toggleExpenseRuleActive(selectedRuleId, isActive);
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : `Failed to ${isActive ? "activate" : "deactivate"} expense rule`
      );
    }
  };

  const startEdit = () => {
    if (selectedRule) {
      setEditingRule(selectedRule);
      setShowForm(true);
    }
  };

  // Calculate totals by counting OCCURRENCES (no amount x multiplier estimate):
  // "Active" = switched on and still producing bills (an ended rule, a repaid loan, a settled card
  // and a fully paid installment plan are not active).
  const today = getTodayKey();
  const activeRules = expenseRules.filter((r) => isExpenseRuleCurrent(r, today));

  // The recurring bills of THIS calendar month (loan EMI, card payments, installments included).
  const month = monthBounds(today);
  const recurringMonthly = recurringPeriodTotals(
    transactions,
    [],
    expenseRules,
    month.start,
    month.end,
    today
  ).expenses;
  const monthLabel = dayjs(parseDate(today)).format("MMMM YYYY");

  const oneTimeTotal = activeRules
    .filter((r) => r.frequency === "one-time")
    .reduce((sum, rule) => sum + rule.amount, 0);

  const debtOwed = totalDebt(expenseRules);

  if (isLoading) {
    return (
      <div className="p-4 lg:p-10 flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" text="Loading expenses..." />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-10 max-w-7xl mx-auto animate-fade-in">
      <PageHeader
        title="Expense Management"
        description="Track bills, loans, credit cards, and recurring expenses."
        actions={
          !showForm && (
            <Button
              variant="primary"
              icon={<Icon name="add" />}
              iconPosition="left"
              onClick={() => {
                setEditingRule(null);
                setShowForm(true);
              }}
            >
              Add Expense
            </Button>
          )
        }
      />

      {actionError && (
        <Alert variant="error" className="mb-6">
          {actionError}
        </Alert>
      )}

      {/* Summary Cards */}
      {!showForm && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 lg:gap-6 mb-6 lg:mb-8">
          <Card padding="md">
            <p className="text-gray-400 text-xs lg:text-sm mb-1">Active Expenses</p>
            <p className="text-xl lg:text-3xl font-bold text-white">{activeRules.length}</p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-xs lg:text-sm mb-1">Monthly Recurring</p>
            <p className="text-lg lg:text-3xl font-bold text-danger">
              {formatCurrency(recurringMonthly, { maximumFractionDigits: 0 })}
            </p>
            <p className="text-[10px] lg:text-xs text-gray-500 mt-1">Scheduled for {monthLabel}</p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-xs lg:text-sm mb-1">One-time</p>
            <p className="text-lg lg:text-3xl font-bold text-warning">
              {formatCurrency(oneTimeTotal, { maximumFractionDigits: 0 })}
            </p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-xs lg:text-sm mb-1">Total Debt</p>
            <p className="text-lg lg:text-3xl font-bold text-danger">
              {formatCurrency(debtOwed, { maximumFractionDigits: 0 })}
            </p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-xs lg:text-sm mb-1">Priority Bills</p>
            <p className="text-xl lg:text-3xl font-bold text-warning">
              {activeRules.filter((r) => r.isPriority).length}
            </p>
          </Card>
        </div>
      )}

      {/* Form or List View */}
      {showForm ? (
        <Card padding="lg">
          <ExpenseRuleForm
            initialData={editingRule ? expenseRuleToFormValues(editingRule) : undefined}
            onSubmit={editingRule ? handleEditRule : handleCreateRule}
            onCancel={() => {
              setShowForm(false);
              setEditingRule(null);
            }}
            isEditing={!!editingRule}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-8">
          {/* Left: List */}
          <div className="lg:col-span-1">
            <Card padding="none">
              <div className="p-4 border-b border-gray-800">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="font-bold text-white">Expenses</h3>
                  <MultiSelectDropdown
                    options={EXPENSE_FILTER_OPTIONS}
                    value={filterTypes}
                    onChange={setFilterTypes}
                    allValue="all"
                    placeholder="All expenses"
                    triggerIcon={<Icon name="filter_list" size="sm" />}
                    contentClassName="w-64"
                  />
                </div>
              </div>

              {filteredRules.length === 0 ? (
                <div className="p-8 text-center">
                  <Icon name="receipt_long" size={48} className="text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-400 mb-4">
                    {isAllSelected ? "No expenses yet" : "No matching expenses"}
                  </p>
                  {isAllSelected && (
                    <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
                      Add Your First Expense
                    </Button>
                  )}
                </div>
              ) : (
                <div className="max-h-[600px] overflow-y-auto">
                  {filteredRules.map((rule) => (
                    <ExpenseRuleCard
                      key={rule.id}
                      rule={rule}
                      isSelected={selectedRuleId === rule.id}
                      onClick={() => setSelectedRuleId(selectedRuleId === rule.id ? null : rule.id)}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Right: Detail */}
          <div className="lg:col-span-2">
            {selectedRule ? (
              <ExpenseRuleDetail
                rule={selectedRule}
                onEdit={startEdit}
                onDelete={handleDeleteRule}
                onToggleActive={handleToggleActive}
              />
            ) : (
              <UpcomingBillsWidget />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpenseManager;
