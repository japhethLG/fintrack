"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { List as VirtualizedList, type RowComponentProps } from "react-window";
import { useFinancial } from "@/contexts/FinancialContext";
import { Transaction } from "@/lib/types";
import {
  Button,
  Card,
  PageHeader,
  Icon,
  LoadingSpinner,
  Select,
  DateRangePicker,
  DateRange,
} from "@/components/common";
import { useModal } from "@/components/modals";
import TransactionRow from "./components/TransactionRow";
import {
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  SORT_OPTIONS,
  ORDER_OPTIONS,
  DATE_RANGE_PRESETS,
} from "./constants";

const TransactionsManager: React.FC = () => {
  type VirtualRowProps = {
    transactions: Transaction[];
    onSelect: (transaction: Transaction) => void;
  };

  const VirtualRow = ({
    index,
    style,
    transactions,
    onSelect,
  }: RowComponentProps<VirtualRowProps>) => {
    const transaction = transactions[index];

    return (
      <div style={style}>
        <TransactionRow transaction={transaction} onAction={() => onSelect(transaction)} />
      </div>
    );
  };

  const { transactions, isLoading, viewDateRange, setViewDateRange } = useFinancial();
  const { openModal } = useModal();

  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [dateRange, setDateRange] = useState<DateRange | null>(null);

  const dateFilteredTransactions = useMemo(() => {
    let result = [...transactions];

    // Filter by date range (optional)
    if (dateRange?.[0] && dateRange?.[1]) {
      const startDate = dateRange[0].format("YYYY-MM-DD");
      const endDate = dateRange[1].format("YYYY-MM-DD");
      result = result.filter((t) => {
        const txDate = t.actualDate || t.scheduledDate;
        return txDate >= startDate && txDate <= endDate;
      });
    }

    return result;
  }, [transactions, dateRange]);

  // Filter and sort transactions
  const filteredTransactions = useMemo(() => {
    let result = [...dateFilteredTransactions];

    // Filter by status
    if (filterStatus !== "all") {
      result = result.filter((t) => t.status === filterStatus);
    }

    // Filter by type
    if (filterType !== "all") {
      result = result.filter((t) => t.type === filterType);
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === "date") {
        const dateA = new Date(a.actualDate || a.scheduledDate).getTime();
        const dateB = new Date(b.actualDate || b.scheduledDate).getTime();
        return sortOrder === "asc" ? dateA - dateB : dateB - dateA;
      } else {
        const amountA = a.actualAmount ?? a.projectedAmount;
        const amountB = b.actualAmount ?? b.projectedAmount;
        return sortOrder === "asc" ? amountA - amountB : amountB - amountA;
      }
    });

    return result;
  }, [dateFilteredTransactions, filterStatus, filterType, sortBy, sortOrder]);

  // Summary stats
  const stats = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];

    return {
      total: dateFilteredTransactions.length,
      completed: dateFilteredTransactions.filter((t) => t.status === "completed").length,
      pending: dateFilteredTransactions.filter((t) => t.status === "projected").length,
      overdue: dateFilteredTransactions.filter(
        (t) => t.status === "projected" && t.scheduledDate < today
      ).length,
    };
  }, [dateFilteredTransactions]);

  const openTransactionModal = useCallback(
    (transaction: Transaction) => {
      openModal("CompleteTransactionModal", { transaction });
    },
    [openModal]
  );

  // Expand view date range if user selects outside current window
  useEffect(() => {
    if (dateRange?.[0] && dateRange?.[1]) {
      const selectedStart = dateRange[0].format("YYYY-MM-DD");
      const selectedEnd = dateRange[1].format("YYYY-MM-DD");

      if (selectedStart < viewDateRange.start || selectedEnd > viewDateRange.end) {
        setViewDateRange(selectedStart, selectedEnd);
      }
    }
  }, [dateRange, viewDateRange, setViewDateRange]);

  const hasActiveFilters =
    filterStatus !== "all" || filterType !== "all" || (dateRange?.[0] && dateRange?.[1]);

  const handleClearFilters = () => {
    setFilterStatus("all");
    setFilterType("all");
    setDateRange(null);
  };

  if (isLoading) {
    return (
      <div className="p-6 lg:p-10 flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" text="Loading transactions..." />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto animate-fade-in">
      <PageHeader
        title="Transactions"
        description="View and manage all your financial transactions."
        actions={
          <Button variant="primary" icon={<Icon name="add" />} iconPosition="left">
            Add Transaction
          </Button>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card padding="sm">
          <p className="text-xs text-gray-400">Total</p>
          <p className="text-2xl font-bold text-white">{stats.total}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs text-gray-400">Completed</p>
          <p className="text-2xl font-bold text-success">{stats.completed}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs text-gray-400">Pending</p>
          <p className="text-2xl font-bold text-warning">{stats.pending}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs text-gray-400">Overdue</p>
          <p className="text-2xl font-bold text-danger">{stats.overdue}</p>
        </Card>
      </div>

      {/* Filters */}
      <Card padding="md" className="mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[150px]">
            <Select
              label="Status"
              options={STATUS_OPTIONS}
              value={filterStatus}
              onChange={setFilterStatus}
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <Select
              label="Type"
              options={TYPE_OPTIONS}
              value={filterType}
              onChange={setFilterType}
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <Select
              label="Sort By"
              options={SORT_OPTIONS}
              value={sortBy}
              onChange={(v) => setSortBy(v as "date" | "amount")}
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <Select
              label="Order By"
              options={ORDER_OPTIONS}
              value={sortOrder}
              onChange={(v) => setSortOrder(v as "asc" | "desc")}
            />
          </div>
          <div className="flex-1 min-w-[220px]">
            <DateRangePicker
              label="Date Range"
              value={dateRange ?? [null, null]}
              allowClear
              showQuickSelect
              presets={DATE_RANGE_PRESETS}
              onChange={(range) => {
                if (!range?.[0] || !range?.[1]) {
                  setDateRange(null);
                } else {
                  setDateRange(range);
                }
              }}
            />
          </div>
        </div>
      </Card>

      {/* Transactions List */}
      <Card padding="none">
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-white">Transactions ({filteredTransactions.length})</h3>
          {hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={handleClearFilters}>
              Clear Filters
            </Button>
          ) : null}
        </div>

        {/* List */}
        {filteredTransactions.length > 0 ? (
          <VirtualizedList
            rowCount={filteredTransactions.length}
            rowHeight={96}
            rowComponent={VirtualRow}
            rowProps={{
              transactions: filteredTransactions,
              onSelect: openTransactionModal,
            }}
            style={{ height: 600, width: "100%" }}
          />
        ) : (
          <div className="p-12 text-center">
            <Icon name="receipt_long" size={64} className="text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 text-lg mb-2">No transactions found</p>
            <p className="text-gray-500 text-sm">
              {filterStatus !== "all" || filterType !== "all"
                ? "Try adjusting your filters"
                : "Add income sources or expenses to see transactions"}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
};

export default TransactionsManager;
