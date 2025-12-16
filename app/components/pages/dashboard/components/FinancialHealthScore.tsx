"use client";

import React, { useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Card, Icon, Tooltip as CommonTooltip, Button } from "@/components/common";
import { HealthScoreBreakdown } from "@/lib/logic/healthScore";
import { cn } from "@/lib/utils/cn";

interface IProps {
  healthScore: HealthScoreBreakdown;
}

const FinancialHealthScore: React.FC<IProps> = ({ healthScore }) => {
  const { score, grade, color, components, insights } = healthScore;
  const [showAllInsights, setShowAllInsights] = useState(false);

  // Data for the gauge chart
  const gaugeData = [
    { name: "Score", value: score, color: color },
    { name: "Remaining", value: 100 - score, color: "#1f2937" }, // gray-800
  ];

  // Helper to get color based on score
  const getBarColor = (value: number) => {
    if (value >= 60) return "#22c55e";
    if (value >= 30) return "#eab308";
    return "#ef4444";
  };

  // All metrics to display
  const metrics = [
    { label: "Cash Runway", value: components.runway },
    { label: "Savings Rate", value: components.savingsRate },
    { label: "Bill Payments", value: components.billPaymentRate },
    { label: "Balance Trend", value: components.balanceTrend },
  ];

  return (
    <Card padding="md" className="relative overflow-hidden h-full">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-400 text-sm font-medium mb-1">Financial Health</p>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-3xl font-bold text-white">{score}/100</h2>
            <div
              className="px-2 py-0.5 rounded text-xs font-bold border"
              style={{ borderColor: color, color: color, backgroundColor: `${color}20` }}
            >
              Grade {grade}
            </div>
          </div>
        </div>

        {/* Gauge Chart */}
        <div className="h-[60px] w-[60px] relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={gaugeData}
                cx="50%"
                cy="50%"
                innerRadius={20}
                outerRadius={28}
                startAngle={90}
                endAngle={-270}
                dataKey="value"
                stroke="none"
              >
                {gaugeData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Icon name="health_and_safety" size={16} style={{ color: color }} />
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {/* Component Bars - All 4 metrics */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span className="truncate">{metric.label}</span>
                <span>{metric.value}/100</span>
              </div>
              <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${metric.value}%`,
                    backgroundColor: getBarColor(metric.value),
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Expandable Insights */}
        {insights.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-800">
            <div className="space-y-2">
              <p className="text-xs text-gray-300 flex items-start gap-2">
                <Icon name="lightbulb" size={14} className="text-primary shrink-0 mt-0.5" />
                {insights[0]}
              </p>
              {showAllInsights &&
                insights.slice(1).map((insight, idx) => (
                  <p key={idx} className="text-xs text-gray-300 flex items-start gap-2 ml-5">
                    {insight}
                  </p>
                ))}
            </div>
            {insights.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllInsights(!showAllInsights)}
                startIcon={<Icon name={showAllInsights ? "expand_less" : "expand_more"} size={14} />}
                className="h-auto p-0 text-xs text-primary hover:text-primary/80 mt-2"
              >
                {showAllInsights ? "Show less" : `View ${insights.length - 1} more`}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default FinancialHealthScore;
