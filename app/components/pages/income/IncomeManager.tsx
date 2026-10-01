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
import { incomeSourceToFormValues } from "./components/IncomeSourceForm/formHelpers";
import IncomeSourceCard from "./components/IncomeSourceCard";
import IncomeSourceDetail from "./components/IncomeSourceDetail";
import { INCOME_FILTER_OPTIONS } from "./constants";
import { getTodayKey, parseDate } from "@/lib/utils/dateUtils";
import {
  annualRecurringTotals,
  isIncomeSourceCurrent,
  monthBounds,
  recurringPeriodTotals,
} from "@/lib/logic/forecasting";
import dayjs from "dayjs";
import UpcomingPaymentsWidget from "./components/UpcomingPaymentsWidget";

const IncomeManager: React.FC = () => {
  const { formatCurrency } = useCurrency();
  const {
    incomeSources,
    transactions,
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

  // Calculate totals by counting OCCURRENCES (no amount x multiplier estimate):
  // "Active" = switched on and still producing income (an ended source is not active).
  const today = getTodayKey();
  const activeSources = incomeSources.filter((s) => isIncomeSourceCurrent(s, today));

  // The recurring income of THIS calendar month: five Fridays are five payments.
  const month = monthBounds(today);
  const recurringMonthly = recurringPeriodTotals(
    transactions,
    incomeSources,
    [],
    month.start,
    month.end,
    today
  ).income;
  const monthLabel = dayjs(parseDate(today)).format("MMMM YYYY");

  // The occurrences of the next 12 months (a daily source is 365 payments, not 12 x 30).
  const annualRecurring = annualRecurringTotals(incomeSources, [], today).income;

  const oneTimeTotal = incomeSources
    .filter((s) => s.isActive && s.frequency === "one-time")
    .reduce((sum, source) => sum + source.amount, 0);

  if (isLoading) {
    return (
      <div className="p-4 lg:p-10 flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" text="Loading income sources..." />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-10 max-w-7xl mx-auto animate-fade-in">
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-6 mb-6 lg:mb-8">
          <Card padding="md">
            <p className="text-gray-400 text-xs lg:text-sm mb-1">Active Sources</p>
            <p className="text-2xl lg:text-3xl font-bold text-white">{activeSources.length}</p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-xs lg:text-sm mb-1">Monthly Recurring</p>
            <p className="text-xl lg:text-3xl font-bold text-success">
              {formatCurrency(recurringMonthly, { maximumFractionDigits: 0 })}
            </p>
            <p className="text-[10px] lg:text-xs text-gray-500 mt-1">Scheduled for {monthLabel}</p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-xs lg:text-sm mb-1">Annual Projection</p>
            <p className="text-xl lg:text-3xl font-bold text-success">
              {formatCurrency(annualRecurring, { maximumFractionDigits: 0 })}
            </p>
            <p className="text-[10px] lg:text-xs text-gray-500 mt-1">Next 12 months</p>
          </Card>
          <Card padding="md">
            <p className="text-gray-400 text-xs lg:text-sm mb-1">One-time Income</p>
            <p className="text-xl lg:text-3xl font-bold text-primary">
              {formatCurrency(oneTimeTotal, { maximumFractionDigits: 0 })}
            </p>
          </Card>
        </div>
      )}

      {/* Form or List View */}
      {showForm ? (
        <Card padding="lg">
          <IncomeSourceForm
            initialData={editingSource ? incomeSourceToFormValues(editingSource) : undefined}
            onSubmit={editingSource ? handleEditSource : handleCreateSource}
            onCancel={() => {
              setShowForm(false);
              setEditingSource(null);
            }}
            isEditing={!!editingSource}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-8">
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
