"use client";

import React from "react";
import InsightCard from "./InsightCard";

interface Metrics {
  balance: number;
  runway: {
    runOutDate: string | null;
    days: number;
  };
  nextCrunch: {
    date: string;
    shortfall: number;
  } | null;
  savingsRate: number;
  monthlySurplus: number;
  totalDebt: number;
}

interface IProps {
  metrics: Metrics;
}

const MetricsGrid: React.FC<IProps> = ({ metrics }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <InsightCard
        icon="account_balance_wallet"
        title="Current Balance"
        value={`$${metrics.balance.toLocaleString()}`}
        status={metrics.balance >= 0 ? "success" : "danger"}
      />
      <InsightCard
        icon="timeline"
        title="Cash Runway"
        value={metrics.runway.runOutDate ? `${metrics.runway.days} days` : "90+ days"}
        subtitle={
          metrics.nextCrunch
            ? `Crunch on ${new Date(metrics.nextCrunch.date).toLocaleDateString()}`
            : "No crunch detected"
        }
        status={metrics.runway.runOutDate ? "warning" : "success"}
      />
      <InsightCard
        icon="savings"
        title="Savings Rate"
        value={`${metrics.savingsRate.toFixed(1)}%`}
        subtitle={`$${metrics.monthlySurplus.toLocaleString()} monthly`}
        status={
          metrics.savingsRate >= 20 ? "success" : metrics.savingsRate >= 0 ? "warning" : "danger"
        }
      />
      <InsightCard
        icon="credit_card"
        title="Total Debt"
        value={`$${metrics.totalDebt.toLocaleString()}`}
        status={metrics.totalDebt > 0 ? "warning" : "success"}
      />
    </div>
  );
};

export default MetricsGrid;
