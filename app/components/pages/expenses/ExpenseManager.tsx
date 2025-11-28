"use client";

import React, { useState } from "react";
import { useFinancial } from "@/contexts/FinancialContext";
import { ExpenseRule, ExpenseRuleFormData } from "@/lib/types";
import { Button, Card, PageHeader, Icon, LoadingSpinner } from "@/components/common";
import { useCurrency } from "@/lib/hooks/useCurrency";
import ExpenseRuleForm from "./components/ExpenseRuleForm";
import ExpenseRuleCard from "./components/ExpenseRuleCard";
import ExpenseRuleDetail from "./components/ExpenseRuleDetail";
import { getMonthlyExpenseMultiplier } from "./constants";
import UpcomingBillsWidget from "./components/UpcomingBillsWidget";

const ExpenseManager: React.FC = () => {
  const { formatCurrency } = useCurrency();
  const {
    expenseRules,
    isLoading,
    createExpenseRule,
    editExpenseRule,
    removeExpenseRule,
    toggleExpenseRuleActive,
  } = useFinancial();

  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<ExpenseRule | null>(null);
  const [filterType, setFilterType] = useState<string>("all");

  const selectedRule = selectedRuleId ? expenseRules.find((r) => r.id === selectedRuleId) : null;

  const filteredRules = expenseRules.filter((rule) => {
    if (filterType === "all") return true;
    if (filterType === "priority") return rule.isPriority;
    if (filterType === "debt")
      return rule.expenseType === "cash_loan" || rule.expenseType === "credit_card";
    return rule.expenseType === filterType;
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

  const handleDeleteRule = async () => {
    if (!selectedRuleId) return;
    await removeExpenseRule(selectedRuleId);
    setSelectedRuleId(null);
  };

  const handleToggleActive = async (isActive: boolean) => {
    if (!selectedRuleId) return;
    await toggleExpenseRuleActive(selectedRuleId, isActive);
  };

  const startEdit = () => {
    if (selectedRule) {
      setEditingRule(selectedRule);
      setShowForm(true);
    }
  };

  // Calculate totals
  const activeRules = expenseRules.filter((r) => r.isActive);

  const recurringMonthly = activeRules.reduce((sum, rule) => {
    // For credit cards with fixed payment strategy, use the fixed payment amount
    let amount = rule.amount;
    if (rule.creditConfig) {
      if (rule.creditConfig.paymentStrategy === "fixed" && rule.creditConfig.fixedPaymentAmount) {
        amount = rule.creditConfig.fixedPaymentAmount;
      } else if (rule.creditConfig.paymentStrategy === "full_balance") {
        amount = rule.creditConfig.currentBalance;
      }
    }
    return sum + amount * getMonthlyExpenseMultiplier(rule.frequency);
  }, 0);

  const oneTimeTotal = activeRules
    .filter((r) => r.frequency === "one-time")
    .reduce((sum, rule) => sum + rule.amount, 0);

  const totalDebt = activeRules.reduce((sum, rule) => {
    if (rule.loanConfig) return sum + rule.loanConfig.currentBalance;
    if (rule.creditConfig) return sum + rule.creditConfig.currentBalance;
    if (rule.installmentConfig) {
      const remaining =
        rule.installmentConfig.installmentCount - rule.installmentConfig.installmentsPaid;
      return sum + remaining * rule.installmentConfig.installmentAmount;
    }
    return sum;
  }, 0);

  if (isLoading) {
    return (
      <div className="p-6 lg:p-10 flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" text="Loading expenses..." />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto animate-fade-in">
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

      {/* Summary Cards */}
      {!showForm && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
          <Card padding="md">
            <p className="text-gray-400 text-sm mb-1">Active Expenses</p>
            <p className="text-3xl font-bold text-white">{activeRules.length}</p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-sm mb-1">Monthly Recurring</p>
            <p className="text-3xl font-bold text-danger">
              {formatCurrency(recurringMonthly, { maximumFractionDigits: 0 })}
            </p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-sm mb-1">One-time Expenses</p>
            <p className="text-3xl font-bold text-warning">
              {formatCurrency(oneTimeTotal, { maximumFractionDigits: 0 })}
            </p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-sm mb-1">Total Debt</p>
            <p className="text-3xl font-bold text-danger">
              {formatCurrency(totalDebt, { maximumFractionDigits: 0 })}
            </p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-sm mb-1">Priority Bills</p>
            <p className="text-3xl font-bold text-warning">
              {activeRules.filter((r) => r.isPriority).length}
            </p>
          </Card>
        </div>
      )}

      {/* Form or List View */}
      {showForm ? (
        <Card padding="lg">
          <ExpenseRuleForm
            initialData={
              editingRule
                ? {
                    name: editingRule.name,
                    expenseType: editingRule.expenseType,
                    category: editingRule.category,
                    amount: editingRule.amount.toString(),
                    isVariableAmount: editingRule.isVariableAmount,
                    frequency: editingRule.frequency,
                    startDate: editingRule.startDate,
                    endDate: editingRule.endDate || "",
                    hasEndDate: !!editingRule.endDate,
                    weekendAdjustment: editingRule.weekendAdjustment,
                    specificDays: editingRule.scheduleConfig.specificDays || [1],
                    dayOfWeek: editingRule.scheduleConfig.dayOfWeek ?? 0,
                    dayOfMonth: editingRule.scheduleConfig.dayOfMonth ?? 1,
                    loanPrincipal: editingRule.loanConfig?.principalAmount?.toString() || "",
                    loanCurrentBalance: editingRule.loanConfig?.currentBalance?.toString() || "",
                    loanInterestRate: editingRule.loanConfig?.interestRate?.toString() || "",
                    loanTermMonths: editingRule.loanConfig?.termMonths?.toString() || "",
                    loanCalculationType: editingRule.loanConfig?.calculationType || "amortized",
                    loanStartDate: editingRule.loanConfig?.loanStartDate || "",
                    creditLimit: editingRule.creditConfig?.creditLimit?.toString() || "",
                    creditBalance: editingRule.creditConfig?.currentBalance?.toString() || "",
                    creditApr: editingRule.creditConfig?.apr?.toString() || "",
                    creditMinPaymentPercent:
                      editingRule.creditConfig?.minimumPaymentPercent?.toString() || "2",
                    creditMinPaymentFloor:
                      editingRule.creditConfig?.minimumPaymentFloor?.toString() || "25",
                    creditStatementDate: editingRule.creditConfig?.statementDate?.toString() || "5",
                    creditDueDate: editingRule.creditConfig?.dueDate?.toString() || "25",
                    creditPaymentStrategy: editingRule.creditConfig?.paymentStrategy || "minimum",
                    creditMinPaymentMethod:
                      editingRule.creditConfig?.minimumPaymentMethod || "percent_only",
                    creditFixedPayment:
                      editingRule.creditConfig?.fixedPaymentAmount?.toString() || "",
                    installmentTotal: editingRule.installmentConfig?.totalAmount?.toString() || "",
                    installmentCount:
                      editingRule.installmentConfig?.installmentCount?.toString() || "12",
                    installmentHasInterest: editingRule.installmentConfig?.hasInterest || false,
                    installmentInterestRate:
                      editingRule.installmentConfig?.interestRate?.toString() || "",
                    notes: editingRule.notes || "",
                    isPriority: editingRule.isPriority,
                  }
                : undefined
            }
            onSubmit={editingRule ? handleEditRule : handleCreateRule}
            onCancel={() => {
              setShowForm(false);
              setEditingRule(null);
            }}
            isEditing={!!editingRule}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: List */}
          <div className="lg:col-span-1">
            <Card padding="none">
              <div className="p-4 border-b border-gray-800">
                <h3 className="font-bold text-white mb-3">Expenses</h3>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "all", label: "All" },
                    { value: "priority", label: "Priority" },
                    { value: "debt", label: "Debt" },
                    { value: "fixed", label: "Fixed" },
                    { value: "variable", label: "Variable" },
                  ].map((filter) => (
                    <Button
                      key={filter.value}
                      variant={filterType === filter.value ? "primary" : "ghost"}
                      size="sm"
                      onClick={() => setFilterType(filter.value)}
                    >
                      {filter.label}
                    </Button>
                  ))}
                </div>
              </div>

              {filteredRules.length === 0 ? (
                <div className="p-8 text-center">
                  <Icon name="receipt_long" size={48} className="text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-400 mb-4">
                    {filterType === "all" ? "No expenses yet" : "No matching expenses"}
                  </p>
                  {filterType === "all" && (
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
                      onClick={() => setSelectedRuleId(rule.id)}
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
              <UpcomingBillsWidget onSelectRule={setSelectedRuleId} />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpenseManager;
