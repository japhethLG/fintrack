"use client";

import React from "react";
import { Button, Card, Alert, Icon, LoadingSpinner } from "@/components/common";

interface IProps {
  analysis: string | null;
  analyzing: boolean;
  transactionCount: number;
  incomeSourceCount: number;
  expenseRuleCount: number;
  onAnalyze: () => void;
  onClear: () => void;
}

const AIAnalysisPanel: React.FC<IProps> = ({
  analysis,
  analyzing,
  transactionCount,
  incomeSourceCount,
  expenseRuleCount,
  onAnalyze,
  onClear,
}) => {
  return (
    <Card variant="elevated" padding="lg">
      {!analysis && !analyzing && (
        <div className="text-center py-10">
          <Icon name="psychology" size={64} className="text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 mb-2">Ready to analyze your financial data</p>
          <p className="text-gray-500 text-sm mb-6">
            {transactionCount} transactions • {incomeSourceCount} income sources •{" "}
            {expenseRuleCount} expense rules
          </p>
          <Button
            onClick={onAnalyze}
            variant="primary"
            size="lg"
            className="mx-auto hover:scale-105 transition-transform"
            icon={<Icon name="auto_awesome" />}
            iconPosition="left"
          >
            Generate AI Insights
          </Button>
        </div>
      )}

      {analyzing && (
        <div className="py-20 flex flex-col items-center">
          <LoadingSpinner size="md" color="primary" text="Analyzing your financial patterns..." />
        </div>
      )}

      {analysis && (
        <div className="prose prose-invert max-w-none">
          <div className="flex items-center justify-between mb-6 pb-6 border-b border-gray-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Icon name="smart_toy" className="text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white m-0">AI Analysis Report</h3>
                <p className="text-sm text-gray-400 m-0">Generated just now</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={onAnalyze}
                variant="ghost"
                size="sm"
                icon={<Icon name="refresh" size="sm" />}
              >
                Regenerate
              </Button>
              <Button onClick={onClear} variant="ghost" size="sm">
                Clear
              </Button>
            </div>
          </div>

          <div className="space-y-4 text-gray-300 leading-relaxed whitespace-pre-line">
            {analysis}
          </div>

          <Alert
            variant="info"
            icon={<Icon name="lightbulb" className="text-yellow-500" />}
            title="AI Insight"
            className="mt-8"
          >
            <p className="text-xs text-gray-400 mt-1">
              This analysis is based on your defined income sources, expense rules, and transaction
              history. It does not account for external market factors or unexpected expenses.
            </p>
          </Alert>
        </div>
      )}
    </Card>
  );
};

export default AIAnalysisPanel;
