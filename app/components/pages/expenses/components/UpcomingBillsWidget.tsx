"use client";

import React, { useState, useMemo } from "react";
import { useFinancial } from "@/contexts/FinancialContext";
import { Transaction } from "@/lib/types";
import { Card, Icon, Select, Badge } from "@/components/common";
import { formatDate, addDays } from "@/lib/utils/dateUtils";
import { cn } from "@/lib/utils/cn";

interface IProps {
  onSelectRule: (ruleId: string) => void;
}

const RANGE_OPTIONS = [
  { value: "14", label: "Next 14 days" },
  { value: "30", label: "Next 30 days" },
  { value: "90", label: "Next 90 days" },
];

const UpcomingBillsWidget: React.FC<IProps> = ({ onSelectRule }) => {
  const { transactions } = useFinancial();
  const [selectedDays, setSelectedDays] = useState("30");

  const upcomingBills = useMemo(() => {
    const today = formatDate(new Date());
    const daysAhead = parseInt(selectedDays, 10);
    const endDateStr = formatDate(addDays(new Date(), daysAhead));

    return transactions
      .filter((t) => {
        const date = t.actualDate || t.scheduledDate;
        return (
          t.type === "expense" &&
          date >= today &&
          date <= endDateStr &&
          t.status !== "completed" &&
          t.status !== "skipped"
        );
      })
      .sort((a, b) =>
        (a.actualDate || a.scheduledDate).localeCompare(b.actualDate || b.scheduledDate)
      );
  }, [transactions, selectedDays]);

  const totalExpected = upcomingBills.reduce((sum, t) => sum + t.projectedAmount, 0);

  // Group by date
  const groupedBills = useMemo(() => {
    const groups: Record<string, Transaction[]> = {};
    upcomingBills.forEach(t => {
        const date = t.actualDate || t.scheduledDate;
        if (!groups[date]) groups[date] = [];
        groups[date].push(t);
    });
    return groups;
  }, [upcomingBills]);

  return (
    <Card padding="none" className="h-full flex flex-col min-h-[400px]">
        {/* Header */}
       <div className="p-6 border-b border-gray-800 flex items-center justify-between">
         <div>
            <h3 className="font-bold text-white text-lg">Upcoming Bills</h3>
             <p className="text-gray-400 text-sm">Expected payments</p>
         </div>
        <Select
          options={RANGE_OPTIONS}
          value={selectedDays}
          onChange={setSelectedDays}
          className="w-[150px]"
        />
      </div>

      {/* Summary */}
      <div className="p-6 bg-gray-800/30 border-b border-gray-800">
        <div className="flex justify-between items-center">
             <span className="text-gray-400">Total Due</span>
             <span className="text-2xl font-bold text-danger">
                ${totalExpected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
             </span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {Object.keys(groupedBills).length === 0 ? (
            <div className="text-center py-8">
                <Icon name="check_circle" size={48} className="text-success mx-auto mb-4" />
                <p className="text-gray-400">No bills due in the next {selectedDays} days.</p>
            </div>
        ) : (
            Object.keys(groupedBills).sort().map(date => (
                <div key={date}>
                    <h4 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-3">
                        {new Date(date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                    </h4>
                    <div className="space-y-3">
                        {groupedBills[date].map(t => (
                            <div
                                key={t.id}
                                className="flex items-center justify-between p-4 bg-gray-800/50 rounded-xl border border-gray-800/50 hover:bg-gray-800 transition-colors cursor-pointer"
                                onClick={() => {
                                    if (t.sourceId && t.sourceType === "expense_rule") {
                                        onSelectRule(t.sourceId);
                                    }
                                }}
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-danger/20 flex items-center justify-center text-danger">
                                        <Icon name="receipt" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-white">{t.name}</p>
                                        <p className="text-xs text-gray-400 capitalize">{t.category}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                     <p className="font-bold text-danger">-${t.projectedAmount.toLocaleString()}</p>
                                     <Badge variant="warning" className="text-xs">{t.status}</Badge>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))
        )}
      </div>
    </Card>
  );
};

export default UpcomingBillsWidget;

