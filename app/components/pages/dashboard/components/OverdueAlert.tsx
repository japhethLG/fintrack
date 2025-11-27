"use client";

import React from "react";
import { Transaction } from "@/lib/types";
import { Button, Card, Icon } from "@/components/common";

interface IProps {
  overdueTransactions: Transaction[];
  onReview: (transaction: Transaction) => void;
}

const OverdueAlert: React.FC<IProps> = ({ overdueTransactions, onReview }) => {
  if (overdueTransactions.length === 0) return null;

  return (
    <Card padding="md" className="mb-8 bg-danger/10 border-danger/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon name="warning" className="text-danger" />
          <div>
            <p className="font-bold text-white">
              {overdueTransactions.length} Overdue Transaction
              {overdueTransactions.length > 1 ? "s" : ""}
            </p>
            <p className="text-sm text-gray-400">
              Mark these as paid or skip them to keep your records accurate.
            </p>
          </div>
        </div>
        <Button variant="danger" size="sm" onClick={() => onReview(overdueTransactions[0])}>
          Review
        </Button>
      </div>
    </Card>
  );
};

export default OverdueAlert;
