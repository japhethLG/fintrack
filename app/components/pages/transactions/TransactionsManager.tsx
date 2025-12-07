"use client";

import React, { useState, useMemo } from "react";
import { useFinancial } from "@/contexts/FinancialContext";
import { Transaction } from "@/lib/types";
import { Button, Card, PageHeader, Icon, LoadingSpinner, Select } from "@/components/common";
import CompleteTransactionModal from "./components/CompleteTransactionModal";
import TransactionRow from "./components/TransactionRow";
import { STATUS_OPTIONS, TYPE_OPTIONS, SORT_OPTIONS } from "./constants";

const TransactionsManager: React.FC = () => {
  const {
    transactions,
    isLoading,
    markTransactionComplete,
    markTransactionSkipped,
  } = useFinancial();

  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Filter and sort transactions
  const filteredTransactions = useMemo(() => {
    let result = [...transactions];

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
  }, [transactions, filterStatus, filterType, sortBy, sortOrder]);

  // Summary stats
  const stats = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];

    return {
      total: transactions.length,
      completed: transactions.filter((t) => t.status === "completed").length,
      pending: transactions.filter((t) => t.status === "pending" || t.status === "projected")
        .length,
      overdue: transactions.filter(
        (t) => (t.status === "pending" || t.status === "projected") && t.scheduledDate < today
      ).length,
    };
  }, [transactions]);

  const handleComplete = async (data: {
    actualAmount: number;
    actualDate?: string;
    notes?: string;
  }) => {
    if (!selectedTransaction) return;
    await markTransactionComplete(selectedTransaction.id, data);
  };

  const handleSkip = async (notes?: string) => {
    if (!selectedTransaction) return;
    await markTransactionSkipped(selectedTransaction.id, notes);
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
          <div className="flex items-end">
            <Button
              variant="ghost"
              size="sm"
              icon={
                <Icon name={sortOrder === "asc" ? "arrow_upward" : "arrow_downward"} size="sm" />
              }
              onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            >
              {sortOrder === "asc" ? "Oldest First" : "Newest First"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Transactions List */}
      <Card padding="none">
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-white">Transactions ({filteredTransactions.length})</h3>
          {filterStatus !== "all" || filterType !== "all" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterStatus("all");
                setFilterType("all");
              }}
            >
              Clear Filters
            </Button>
          ) : null}
        </div>

        {/* List */}
        {filteredTransactions.length > 0 ? (
          <div className="max-h-[600px] overflow-y-auto">
            {filteredTransactions.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                onAction={() => setSelectedTransaction(transaction)}
              />
            ))}
          </div>
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

      {/* Transaction Modal */}
      {selectedTransaction && (
        <CompleteTransactionModal
          transaction={selectedTransaction}
          onComplete={handleComplete}
          onSkip={handleSkip}
          onClose={() => setSelectedTransaction(null)}
        />
      )}
    </div>
  );
};

export default TransactionsManager;
