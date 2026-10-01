"use client";

import React from "react";
import { Transaction, DayBalance, BalanceStatus } from "@/lib/types";
import { Card, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { rowDate } from "@/lib/logic/balanceCalculator/openItems";
import { categoryLabel } from "@/lib/utils/categoryLabel";
import { parseDate } from "@/lib/utils/dateUtils";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { STATUS_COLORS, STATUS_BG_COLORS } from "../constants";
import TransactionItem from "./TransactionItem";
import DraggableTransaction from "./DraggableTransaction";

interface IProps {
  selectedDate: Date | null;
  dayBalance: DayBalance | null;
  transactions: Transaction[];
  onTransactionClick?: (transaction: Transaction) => void;
  rangeLabel: string;
  rangeOpening: number | null;
  rangeClosing: number | null;
  viewMode: "month" | "week";
  rangeIncome: number;
  rangeExpenses: number;
  rangeTransactions: Transaction[];
  rangeStatus: BalanceStatus;
  dayOpeningStatus: BalanceStatus;
  rangeOpeningStatus: BalanceStatus;
}

interface DetailPanelProps {
  /** Overdue expenses deducted from this day's closing balance (today only). */
  overdueOwed?: number;
  title: string;
  subLabel?: string;
  status: BalanceStatus;
  openingStatus: BalanceStatus;
  opening: number | null;
  closing: number | null;
  income: number;
  expenses: number;
  /** Today only: rows listed on a later day that were paid ahead of their date and moved today. */
  paidAhead?: Transaction[];
  transactions: Transaction[];
  onTransactionClick?: (transaction: Transaction) => void;
}

const DetailPanel: React.FC<DetailPanelProps> = ({
  overdueOwed,
  title,
  subLabel,
  status,
  openingStatus,
  opening,
  closing,
  income,
  expenses,
  paidAhead,
  transactions,
  onTransactionClick,
}) => {
  const { formatCurrency, formatCurrencyWithSign } = useCurrency();

  // Label left, amount right, one row each: the sign stays glued to its amount whatever the width.
  const renderSummaryTiles = () => {
    if (income <= 0 && expenses <= 0) return null;
    return (
      <div className="grid grid-cols-1 gap-2 mb-4">
        <div className="bg-success/10 rounded-lg p-2 flex items-center justify-between gap-2">
          <p className="text-xs text-gray-400">Income</p>
          <p className="text-success font-bold whitespace-nowrap">{formatCurrencyWithSign(income)}</p>
        </div>
        <div className="bg-danger/10 rounded-lg p-2 flex items-center justify-between gap-2">
          <p className="text-xs text-gray-400">Expenses</p>
          <p className="text-danger font-bold whitespace-nowrap">{formatCurrency(-expenses)}</p>
        </div>
      </div>
    );
  };

  const renderPaidAhead = () => {
    if (!paidAhead || paidAhead.length === 0) return null;
    return (
      <div className="mb-4 rounded-lg border border-gray-700 p-2">
        <h4 className="text-sm font-medium text-gray-400">Paid ahead of their date</h4>
        <p className="text-xs text-gray-500 mb-1">Already counted in today&apos;s totals.</p>
        <ul className="space-y-1">
          {paidAhead.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-gray-300">
                {t.name}{" "}
                <span className="text-gray-500">
                  (due {parseDate(rowDate(t)).toLocaleDateString("en-US", { month: "short", day: "numeric" })},{" "}
                  {categoryLabel(t.category)})
                </span>
              </span>
              <span
                className={cn(
                  "font-bold whitespace-nowrap",
                  t.type === "income" ? "text-success" : "text-danger"
                )}
              >
                {formatCurrencyWithSign(
                  (t.type === "income" ? 1 : -1) * (t.actualAmount ?? t.projectedAmount)
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderTransactionsList = () => (
    <div>
      <h4 className="text-sm font-medium text-gray-400">Transactions ({transactions.length})</h4>
      <div className="mt-2 space-y-2 max-h-[360px] overflow-y-auto pr-1">
        {transactions.length > 0 ? (
          transactions.map((t) => (
            <DraggableTransaction key={t.id} transaction={t}>
              <TransactionItem transaction={t} onClick={() => onTransactionClick?.(t)} />
            </DraggableTransaction>
          ))
        ) : (
          <div className="py-8 text-center">
            <Icon name="event_available" size={32} className="text-gray-600 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No transactions</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="mb-4">
        <h3 className="text-lg font-bold text-white">{title}</h3>
        {subLabel && <p className="text-gray-400 text-sm">{subLabel}</p>}

        {(opening !== null || closing !== null) && (
          <div className={cn("mt-2 p-3 rounded-lg border", STATUS_BG_COLORS[status])}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-400">Opening</span>
              <span className={cn("font-bold", STATUS_COLORS[openingStatus])}>
                {opening !== null ? formatCurrency(opening) : "—"}
              </span>
            </div>
            {overdueOwed !== undefined && overdueOwed > 0 && (
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-danger">Overdue owed</span>
                <span className="font-bold text-danger">-{formatCurrency(overdueOwed)}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Closing</span>
              <span className={cn("font-bold", STATUS_COLORS[status])}>
                {closing !== null ? formatCurrency(closing) : "—"}
              </span>
            </div>
          </div>
        )}
      </div>

      {renderSummaryTiles()}
      {renderPaidAhead()}
      {renderTransactionsList()}
    </>
  );
};

const DayDetailSidebar: React.FC<IProps> = ({
  selectedDate,
  dayBalance,
  transactions,
  onTransactionClick,
  rangeLabel,
  rangeOpening,
  rangeClosing,
  viewMode,
  rangeIncome,
  rangeExpenses,
  rangeTransactions,
  rangeStatus,
  dayOpeningStatus,
  rangeOpeningStatus,
}) => {
  return (
    <Card padding="md" className="sticky top-6">
      {selectedDate ? (
        <DetailPanel
          title={selectedDate.toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          })}
          overdueOwed={dayBalance?.overdueOwed}
          status={dayBalance?.status ?? "safe"}
          openingStatus={dayOpeningStatus}
          opening={dayBalance?.openingBalance ?? null}
          closing={dayBalance?.closingBalance ?? null}
          // what MOVED the balance that day, so the totals agree with Opening -> Closing (MANUAL-M10)
          income={dayBalance?.movedIncome ?? dayBalance?.totalIncome ?? 0}
          expenses={dayBalance?.movedExpenses ?? dayBalance?.totalExpenses ?? 0}
          paidAhead={dayBalance?.paidAhead}
          transactions={transactions}
          onTransactionClick={onTransactionClick}
        />
      ) : (
        <DetailPanel
          title={viewMode === "month" ? "Monthly range" : "Weekly range"}
          subLabel={rangeLabel}
          status={rangeStatus}
          openingStatus={rangeOpeningStatus}
          opening={rangeOpening}
          closing={rangeClosing}
          income={rangeIncome}
          expenses={rangeExpenses}
          transactions={rangeTransactions}
          onTransactionClick={onTransactionClick}
        />
      )}
    </Card>
  );
};

export default DayDetailSidebar;
