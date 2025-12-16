"use client";

import React, { useState, useMemo } from "react";
import { useFinancial } from "@/contexts/FinancialContext";
import { Transaction } from "@/lib/types";
import { Card, Icon, Badge, Select, Tabs, Button } from "@/components/common";
import { formatDate, addDays } from "@/lib/utils/dateUtils";
import { getBillCoverageReport } from "@/lib/logic/balanceCalculator";
import { BillItem } from "@/components/widgets/BillItem";
import QuickTransaction from "./QuickTransaction";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";

interface IProps {
  onTransactionClick: (transaction: Transaction) => void;
}

const RANGE_OPTIONS = [
  { value: "7", label: "Next 7 days" },
  { value: "14", label: "Next 14 days" },
  { value: "30", label: "Next 30 days" },
  { value: "60", label: "Next 60 days" },
];

const UpcomingActivityWidget: React.FC<IProps> = ({ onTransactionClick }) => {
  const { transactions, userProfile } = useFinancial();
  const { formatCurrency, formatCurrencyWithSign } = useCurrency();
  const [selectedDays, setSelectedDays] = useState("14");
  const [activeTab, setActiveTab] = useState("overview");

  // Filter transactions for the selected range
  const upcomingData = useMemo(() => {
    const today = formatDate(new Date());
    const daysAhead = parseInt(selectedDays, 10);
    const endDateStr = formatDate(addDays(new Date(), daysAhead));

    const filtered = transactions
      .filter((t) => {
        const date = t.actualDate || t.scheduledDate;
        return (
          date >= today && date <= endDateStr && t.status !== "completed" && t.status !== "skipped"
        );
      })
      .sort((a, b) =>
        (a.actualDate || a.scheduledDate).localeCompare(b.actualDate || b.scheduledDate)
      );

    const income = filtered.filter((t) => t.type === "income");
    const expenses = filtered.filter((t) => t.type === "expense");

    return { all: filtered, income, expenses };
  }, [transactions, selectedDays]);

  // Calculate bill coverage for the "Bills" tab
  const billReport = useMemo(() => {
    if (!userProfile || transactions.length === 0) return null;
    return getBillCoverageReport(
      userProfile.currentBalance,
      transactions,
      parseInt(selectedDays, 10)
    );
  }, [userProfile, transactions, selectedDays]);

  // Overview Stats
  const stats = useMemo(() => {
    const totalIncome = upcomingData.income.reduce((sum, t) => sum + (t.projectedAmount || 0), 0);
    const totalExpenses = upcomingData.expenses.reduce(
      (sum, t) => sum + (t.projectedAmount || 0),
      0
    );
    return { totalIncome, totalExpenses, net: totalIncome - totalExpenses };
  }, [upcomingData]);

  // Tab Content: Overview
  const OverviewTab = (
    <div className="space-y-4 animate-fade-in">
      {/* Mini Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-dark-800 p-3 rounded-lg border border-gray-800">
          <p className="text-xs text-gray-400 mb-1">Income</p>
          <p className="text-success font-bold text-sm">
            {formatCurrencyWithSign(stats.totalIncome)}
          </p>
        </div>
        <div className="bg-dark-800 p-3 rounded-lg border border-gray-800">
          <p className="text-xs text-gray-400 mb-1">Expenses</p>
          <p className="text-danger font-bold text-sm">-{formatCurrency(stats.totalExpenses)}</p>
        </div>
        <div className="bg-dark-800 p-3 rounded-lg border border-gray-800">
          <p className="text-xs text-gray-400 mb-1">Net Change</p>
          <p className={cn("font-bold text-sm", stats.net >= 0 ? "text-success" : "text-danger")}>
            {formatCurrencyWithSign(stats.net)}
          </p>
        </div>
      </div>

      {/* Timeline List */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {upcomingData.all.length > 0 ? (
          upcomingData.all.map((t) => (
            <QuickTransaction key={t.id} transaction={t} onClick={() => onTransactionClick(t)} />
          ))
        ) : (
          <div className="py-8 text-center">
            <Icon name="event_available" size={32} className="text-gray-600 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">No activity in next {selectedDays} days</p>
          </div>
        )}
      </div>
    </div>
  );

  // Tab Content: Bills (Coverage)
  const BillsTab = (
    <div className="space-y-4 animate-fade-in">
      {billReport ? (
        <>
          {/* Coverage Summary */}
          <div
            className={cn(
              "p-4 rounded-xl border",
              billReport.upcomingBills.some((b) => !b.canCover)
                ? "bg-danger/10 border-danger/20"
                : "bg-success/10 border-success/20"
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-white">Projected Balance</span>
              <span
                className={cn(
                  "font-bold text-lg",
                  billReport.projectedBalance >= 0 ? "text-success" : "text-danger"
                )}
              >
                {formatCurrency(billReport.projectedBalance)}
              </span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full",
                  billReport.projectedBalance >= 0 ? "bg-success" : "bg-danger"
                )}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          {/* Bills List */}
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {billReport.upcomingBills.length > 0 ? (
              billReport.upcomingBills.map((bill, index) => (
                <BillItem
                  key={index}
                  bill={bill}
                  onPay={() => onTransactionClick(bill.transaction)}
                />
              ))
            ) : (
              <div className="py-8 text-center">
                <Icon name="check_circle" size={32} className="text-success mx-auto mb-2" />
                <p className="text-gray-400 text-sm">No bills due soon!</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="py-8 text-center">
          <p className="text-gray-400">Loading coverage...</p>
        </div>
      )}
    </div>
  );

  // Tab Content: Income
  const IncomeTab = (
    <div className="space-y-2 max-h-[500px] overflow-y-auto animate-fade-in">
      {upcomingData.income.length > 0 ? (
        upcomingData.income.map((t) => (
          <QuickTransaction key={t.id} transaction={t} onClick={() => onTransactionClick(t)} />
        ))
      ) : (
        <div className="py-8 text-center">
          <Icon name="savings" size={32} className="text-gray-600 mx-auto mb-2" />
          <p className="text-gray-400 text-sm">No incoming payments expected</p>
        </div>
      )}
    </div>
  );

  return (
    <Card padding="none" className="h-full flex flex-col">
      {/* Shared Header */}
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-white">Upcoming Activity</h3>
          <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
            Own Range
          </span>
        </div>
        <Select
          options={RANGE_OPTIONS}
          value={selectedDays}
          onChange={setSelectedDays}
          className="h-8 text-xs w-[140px]"
        />
      </div>

      {/* Tabs */}
      <div className="p-4 flex-1">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          items={[
            {
              value: "overview",
              label: "Overview",
              icon: <Icon name="dashboard" size={16} />,
              content: OverviewTab,
            },
            {
              value: "bills",
              label: "Bills",
              icon: <Icon name="receipt_long" size={16} />,
              content: BillsTab,
            },
            {
              value: "income",
              label: "Income",
              icon: <Icon name="payments" size={16} />,
              content: IncomeTab,
            },
          ]}
        />
      </div>
    </Card>
  );
};

export default UpcomingActivityWidget;
