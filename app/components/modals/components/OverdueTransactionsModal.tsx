"use client";

import React from "react";
import { Transaction } from "@/lib/types";
import { Button, Icon, Badge } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";
import dayjs from "dayjs";

export interface IModalData {
  overdueTransactions: Transaction[];
  onReview: (transaction: Transaction) => void;
  onCloseModal?: () => void;
}

export interface IProps {
  closeModal: () => void;
  modalData: IModalData;
}

const OverdueTransactionsModal: React.FC<IProps> = ({ closeModal, modalData }) => {
  const { overdueTransactions, onReview } = modalData;
  const { formatCurrency } = useCurrency();

  const formatDisplayDate = (dateStr: string) => dayjs(dateStr).format("MMM D, YYYY");

  const getDaysOverdue = (dateStr: string) => {
    const today = dayjs();
    const scheduled = dayjs(dateStr);
    return today.diff(scheduled, "day");
  };

  const totalOverdueAmount = overdueTransactions.reduce((sum, t) => sum + t.projectedAmount, 0);

  const handleReview = (transaction: Transaction) => {
    onReview(transaction);
    closeModal();
  };

  return (
    <div className="flex flex-col max-h-[70vh]">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-danger/20 flex items-center justify-center shrink-0">
          <Icon name="warning" size={20} className="text-danger" />
        </div>
        <div>
          <p className="text-gray-400 text-sm">
            {overdueTransactions.length} transaction
            {overdueTransactions.length !== 1 ? "s" : ""} need
            {overdueTransactions.length === 1 ? "s" : ""} attention
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-danger/10 border border-danger/20 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Total Overdue</p>
            <p className="text-2xl font-bold text-danger">{formatCurrency(totalOverdueAmount)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Mark as paid or skip</p>
            <p className="text-sm text-gray-300">to keep your records accurate</p>
          </div>
        </div>
      </div>

      {/* Transaction List */}
      <div className="flex-1 overflow-y-auto space-y-3 min-h-0 mb-4">
        {overdueTransactions.map((transaction) => {
          const daysOverdue = getDaysOverdue(transaction.scheduledDate);
          const isIncome = transaction.type === "income";

          return (
            <div
              key={transaction.id}
              className="group p-4 rounded-xl border border-gray-800 bg-gray-900/50 hover:border-danger/40 hover:bg-gray-900 transition-all duration-200 cursor-pointer"
              onClick={() => handleReview(transaction)}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                      isIncome ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
                    )}
                  >
                    <Icon name={isIncome ? "arrow_downward" : "arrow_upward"} size={20} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-white truncate">{transaction.name}</p>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-400">{transaction.category}</span>
                      <span className="text-gray-600">•</span>
                      <span className="text-gray-400">
                        {formatDisplayDate(transaction.scheduledDate)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className={cn("font-bold", isIncome ? "text-success" : "text-danger")}>
                      {isIncome ? "+" : "-"}
                      {formatCurrency(transaction.projectedAmount)}
                    </p>
                    <Badge variant="danger" size="sm" className="mt-1">
                      {daysOverdue} day{daysOverdue !== 1 ? "s" : ""} overdue
                    </Badge>
                  </div>
                  <Icon
                    name="chevron_right"
                    size={20}
                    className="text-gray-600 group-hover:text-danger transition-colors"
                  />
                </div>
              </div>

              {transaction.notes && (
                <p className="mt-2 text-sm text-gray-500 truncate pl-13">{transaction.notes}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex gap-3 pt-4 border-t border-gray-800">
        <Button variant="ghost" className="flex-1" onClick={closeModal}>
          Close
        </Button>
        {overdueTransactions.length > 0 && (
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => handleReview(overdueTransactions[0])}
          >
            <Icon name="play_arrow" size="sm" className="mr-2" />
            Review First
          </Button>
        )}
      </div>
    </div>
  );
};

export default OverdueTransactionsModal;
