"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useFinancial } from "@/contexts/FinancialContext";
import { IncomeSource, IncomeSourceFormData } from "@/lib/types";
import {
  Button,
  Card,
  PageHeader,
  Icon,
  LoadingSpinner,
  MultiSelectDropdown,
} from "@/components/common";
import { useCurrency } from "@/lib/hooks/useCurrency";
import IncomeSourceForm from "./components/IncomeSourceForm";
import IncomeSourceCard from "./components/IncomeSourceCard";
import IncomeSourceDetail from "./components/IncomeSourceDetail";
import { getMonthlyMultiplier, INCOME_FILTER_OPTIONS } from "./constants";
import UpcomingPaymentsWidget from "./components/UpcomingPaymentsWidget";

const IncomeManager: React.FC = () => {
  const { formatCurrency } = useCurrency();
  const {
    incomeSources,
    isLoading,
    createIncomeSource,
    editIncomeSource,
    removeIncomeSource,
    toggleIncomeSourceActive,
  } = useFinancial();

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingSource, setEditingSource] = useState<IncomeSource | null>(null);
  const [filterTypes, setFilterTypes] = useState<string[]>(["all"]);

  // Handle query param for auto-selecting source (from transaction modal)
  const searchParams = useSearchParams();
  useEffect(() => {
    const sourceId = searchParams.get("source");
    if (sourceId && incomeSources.some((s) => s.id === sourceId)) {
      setSelectedSourceId(sourceId);
    }
  }, [searchParams, incomeSources]);

  const selectedSource = selectedSourceId
    ? incomeSources.find((s) => s.id === selectedSourceId)
    : null;

  const isAllSelected = filterTypes.includes("all");

  const filteredSources = incomeSources.filter((source) => {
    if (isAllSelected || filterTypes.length === 0) return true;
    return filterTypes.includes(source.sourceType);
  });

  const handleCreateSource = async (data: IncomeSourceFormData) => {
    const source = await createIncomeSource(data);
    setShowForm(false);
    setSelectedSourceId(source.id);
  };

  const handleEditSource = async (data: IncomeSourceFormData) => {
    if (!editingSource) return;
    await editIncomeSource(editingSource.id, data);
    setEditingSource(null);
    setShowForm(false);
  };

  const handleDeleteSource = async () => {
    if (!selectedSourceId) return;
    await removeIncomeSource(selectedSourceId);
    setSelectedSourceId(null);
  };

  const handleToggleActive = async (isActive: boolean) => {
    if (!selectedSourceId) return;
    await toggleIncomeSourceActive(selectedSourceId, isActive);
  };

  const startEdit = () => {
    if (selectedSource) {
      setEditingSource(selectedSource);
      setShowForm(true);
    }
  };

  // Calculate totals
  const activeSources = incomeSources.filter((s) => s.isActive);

  const recurringMonthly = activeSources.reduce((sum, source) => {
    return sum + source.amount * getMonthlyMultiplier(source.frequency);
  }, 0);

  const oneTimeTotal = activeSources
    .filter((s) => s.frequency === "one-time")
    .reduce((sum, source) => sum + source.amount, 0);

  if (isLoading) {
    return (
      <div className="p-6 lg:p-10 flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" text="Loading income sources..." />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto animate-fade-in">
      <PageHeader
        title="Income Management"
        description="Track your salary, freelance income, investments, and other revenue streams."
        actions={
          !showForm && (
            <Button
              variant="primary"
              icon={<Icon name="add" />}
              iconPosition="left"
              onClick={() => {
                setEditingSource(null);
                setShowForm(true);
              }}
            >
              Add Income
            </Button>
          )
        }
      />

      {/* Summary Cards */}
      {!showForm && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card padding="md">
            <p className="text-gray-400 text-sm mb-1">Active Sources</p>
            <p className="text-3xl font-bold text-white">{activeSources.length}</p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-sm mb-1">Monthly Recurring</p>
            <p className="text-3xl font-bold text-success">
              {formatCurrency(recurringMonthly, { maximumFractionDigits: 0 })}
            </p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-sm mb-1">Annual Projection</p>
            <p className="text-3xl font-bold text-success">
              {formatCurrency(recurringMonthly * 12, { maximumFractionDigits: 0 })}
            </p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-sm mb-1">One-time Income</p>
            <p className="text-3xl font-bold text-primary">
              {formatCurrency(oneTimeTotal, { maximumFractionDigits: 0 })}
            </p>
          </Card>
        </div>
      )}

      {/* Form or List View */}
      {showForm ? (
        <Card padding="lg">
          <IncomeSourceForm
            initialData={
              editingSource
                ? {
                    name: editingSource.name,
                    sourceType: editingSource.sourceType,
                    amount: editingSource.amount.toString(),
                    isVariableAmount: editingSource.isVariableAmount,
                    frequency: editingSource.frequency,
                    startDate: editingSource.startDate,
                    endDate: editingSource.endDate || "",
                    hasEndDate: !!editingSource.endDate,
                    weekendAdjustment: editingSource.weekendAdjustment,
                    specificDays: editingSource.scheduleConfig.specificDays || [15, 30],
                    dayOfWeek: editingSource.scheduleConfig.dayOfWeek ?? 0,
                    dayOfMonth: editingSource.scheduleConfig.dayOfMonth ?? 1,
                    category: editingSource.category,
                    notes: editingSource.notes || "",
                    color: editingSource.color || "#22c55e",
                  }
                : undefined
            }
            onSubmit={editingSource ? handleEditSource : handleCreateSource}
            onCancel={() => {
              setShowForm(false);
              setEditingSource(null);
            }}
            isEditing={!!editingSource}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: List */}
          <div className="lg:col-span-1">
            <Card padding="none">
              <div className="p-4 border-b border-gray-800">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="font-bold text-white">Income Sources</h3>
                  <MultiSelectDropdown
                    options={INCOME_FILTER_OPTIONS}
                    value={filterTypes}
                    onChange={setFilterTypes}
                    allValue="all"
                    placeholder="All income"
                    triggerIcon={<Icon name="filter_list" size="sm" />}
                    contentClassName="w-64"
                  />
                </div>
              </div>

              {filteredSources.length === 0 ? (
                <div className="p-8 text-center">
                  <Icon
                    name="account_balance_wallet"
                    size={48}
                    className="text-gray-600 mx-auto mb-4"
                  />
                  <p className="text-gray-400 mb-4">
                    {isAllSelected ? "No income sources yet" : "No matching income sources"}
                  </p>
                  {isAllSelected && (
                    <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
                      Add Your First Income
                    </Button>
                  )}
                </div>
              ) : (
                <div className="max-h-[600px] overflow-y-auto">
                  {filteredSources.map((source) => (
                    <IncomeSourceCard
                      key={source.id}
                      source={source}
                      isSelected={selectedSourceId === source.id}
                      onClick={() =>
                        setSelectedSourceId(selectedSourceId === source.id ? null : source.id)
                      }
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Right: Detail */}
          <div className="lg:col-span-2">
            {selectedSource ? (
              <IncomeSourceDetail
                source={selectedSource}
                onEdit={startEdit}
                onDelete={handleDeleteSource}
                onToggleActive={handleToggleActive}
              />
            ) : (
              <UpcomingPaymentsWidget />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default IncomeManager;
