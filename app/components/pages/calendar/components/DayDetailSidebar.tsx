"use client";

import React from "react";
import { Transaction, DayBalance } from "@/lib/types";
import { Card, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { STATUS_COLORS, STATUS_BG_COLORS } from "../constants";
import TransactionItem from "./TransactionItem";

interface IProps {
  selectedDate: Date | null;
  dayBalance: DayBalance | null;
  transactions: Transaction[];
  onTransactionClick?: (transaction: Transaction) => void;
}

const DayDetailSidebar: React.FC<IProps> = ({
  selectedDate,
  dayBalance,
  transactions,
  onTransactionClick,
}) => {
  const { formatCurrency, formatCurrencyWithSign } = useCurrency();
  return (
    <Card padding="md" className="sticky top-6">
      {selectedDate ? (
        <>
          <div className="mb-4">
            <h3 className="text-lg font-bold text-white">
              {selectedDate.toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </h3>
            {dayBalance && (
              <div
                className={cn("mt-2 p-3 rounded-lg border", STATUS_BG_COLORS[dayBalance.status])}
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-400">Opening</span>
                  <span className="text-white font-medium">
                    {formatCurrency(dayBalance.openingBalance)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Closing</span>
                  <span className={cn("font-bold", STATUS_COLORS[dayBalance.status])}>
                    {formatCurrency(dayBalance.closingBalance)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Day summary */}
          {dayBalance && (dayBalance.totalIncome > 0 || dayBalance.totalExpenses > 0) && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-success/10 rounded-lg p-2 text-center">
                <p className="text-xs text-gray-400">Income</p>
                <p className="text-success font-bold">
                  {formatCurrencyWithSign(dayBalance.totalIncome)}
                </p>
              </div>
              <div className="bg-danger/10 rounded-lg p-2 text-center">
                <p className="text-xs text-gray-400">Expenses</p>
                <p className="text-danger font-bold">-{formatCurrency(dayBalance.totalExpenses)}</p>
              </div>
            </div>
          )}

          {/* Transactions list */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-400">
              Transactions ({transactions.length})
            </h4>
            {transactions.length > 0 ? (
              transactions.map((t) => (
                <TransactionItem
                  key={t.id}
                  transaction={t}
                  onClick={() => onTransactionClick?.(t)}
                />
              ))
            ) : (
              <div className="py-8 text-center">
                <Icon name="event_available" size={32} className="text-gray-600 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">No transactions</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="py-8 text-center">
          <Icon name="calendar_today" size={48} className="text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">Select a day to view details</p>
        </div>
      )}
    </Card>
  );
};

export default DayDetailSidebar;
