"use client";

import React, { useMemo, useState } from "react";
import { useFinancial } from "@/contexts/FinancialContext";
import { Transaction } from "@/lib/types";
import { getBillCoverageReport } from "@/lib/logic/balanceCalculator";
import { Card, Icon, Badge, Select } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { BillItem } from "./BillItem";

// ============================================================================
// CONSTANTS
// ============================================================================

const RANGE_OPTIONS = [
  { value: "7", label: "Next 7 days" },
  { value: "14", label: "Next 14 days" },
  { value: "30", label: "Next 30 days" },
  { value: "60", label: "Next 60 days" },
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface BillCoverageWidgetProps {
  days?: number;
  onPayBill?: (transactionId: string) => void;
  transactions?: Transaction[];
  currentBalance?: number;
}

const BillCoverageWidget: React.FC<BillCoverageWidgetProps> = ({
  days = 14,
  onPayBill,
  transactions: propTransactions,
  currentBalance: propCurrentBalance,
}) => {
  const {
    billCoverage: contextBillCoverage,
    userProfile,
    transactions: contextTransactions,
  } = useFinancial();

  const [selectedDays, setSelectedDays] = useState(days.toString());

  // Calculate report locally if props provided or days differs from context default
  const report = useMemo(() => {
    const daysToUse = parseInt(selectedDays, 10);

    // 1. Use props if available
    if (propTransactions && propCurrentBalance !== undefined) {
      return getBillCoverageReport(propCurrentBalance, propTransactions, daysToUse);
    }

    // 2. Fallback to context data with custom days
    if (userProfile && contextTransactions.length > 0) {
      return getBillCoverageReport(userProfile.currentBalance, contextTransactions, daysToUse);
    }

    // 3. Fallback to context pre-calculated report (if available)
    return contextBillCoverage;
  }, [
    propTransactions,
    propCurrentBalance,
    selectedDays,
    contextBillCoverage,
    userProfile,
    contextTransactions,
  ]);

  if (!report) {
    return (
      <Card padding="md">
        <div className="flex items-center gap-3 mb-4">
          <Icon name="receipt_long" className="text-gray-400" />
          <h3 className="font-bold text-white">Upcoming Bills</h3>
        </div>
        <p className="text-gray-400 text-sm">Loading bill coverage...</p>
      </Card>
    );
  }

  const { currentBalance, upcomingBills, totalUpcoming, projectedBalance } = report;

  const billsAtRisk = upcomingBills.filter((b) => !b.canCover);
  const hasRisk = billsAtRisk.length > 0;

  return (
    <Card padding="md">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center",
              hasRisk ? "bg-danger/20 text-danger" : "bg-success/20 text-success"
            )}
          >
            <Icon name={hasRisk ? "warning" : "check_circle"} />
          </div>
          <div>
            <h3 className="font-bold text-white">Upcoming Bills</h3>
            <Select
              options={RANGE_OPTIONS}
              value={selectedDays}
              onChange={setSelectedDays}
              className="h-6 text-xs mt-1 w-[130px] bg-transparent border-none p-0 text-gray-400"
            />
          </div>
        </div>

        {hasRisk && <Badge variant="danger">{billsAtRisk.length} at risk</Badge>}
      </div>

      {/* Summary */}
      <div
        className={cn(
          "p-4 rounded-xl mb-4 border",
          hasRisk ? "bg-danger/10 border-danger/20" : "bg-success/10 border-success/20"
        )}
      >
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-400">Current Balance</p>
            <p className="text-white font-bold text-lg">${currentBalance.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-gray-400">Total Bills</p>
            <p className="text-danger font-bold text-lg">-${totalUpcoming.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-gray-400">Bills Count</p>
            <p className="text-white font-bold text-lg">{upcomingBills.length}</p>
          </div>
          <div>
            <p className="text-gray-400">Projected End</p>
            <p
              className={cn(
                "font-bold text-lg",
                projectedBalance >= 0 ? "text-success" : "text-danger"
              )}
            >
              ${projectedBalance.toLocaleString()}
            </p>
          </div>
        </div>

        {hasRisk && (
          <div className="mt-4 pt-4 border-t border-danger/20">
            <p className="text-danger text-sm flex items-center gap-2">
              <Icon name="info" size="sm" />
              {billsAtRisk.length} bill{billsAtRisk.length > 1 ? "s" : ""} may not be covered.
              Consider deferring or finding additional income.
            </p>
          </div>
        )}
      </div>

      {/* Bills List */}
      {upcomingBills.length > 0 ? (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {upcomingBills.map((bill, index) => (
            <BillItem
              key={index}
              bill={bill}
              onPay={onPayBill ? () => onPayBill(bill.transaction.id) : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="py-8 text-center">
          <Icon name="celebration" size={48} className="text-success mx-auto mb-2" />
          <p className="text-gray-400">No upcoming bills in the next {selectedDays} days!</p>
        </div>
      )}
    </Card>
  );
};

export default BillCoverageWidget;
