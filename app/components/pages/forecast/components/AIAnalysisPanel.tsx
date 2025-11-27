"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
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
        <div>
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

          <div className="ai-analysis-content">
            <ReactMarkdown
              components={{
                h1: ({ children }) => (
                  <h1 className="text-2xl font-bold text-white mt-6 mb-3 first:mt-0">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-xl font-bold text-white mt-6 mb-3 first:mt-0">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-lg font-semibold text-white mt-5 mb-2">{children}</h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-base font-semibold text-white mt-4 mb-2">{children}</h4>
                ),
                p: ({ children }) => (
                  <p className="text-gray-300 leading-relaxed mb-4">{children}</p>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-white">{children}</strong>
                ),
                em: ({ children }) => <em className="italic text-gray-200">{children}</em>,
                ul: ({ children }) => (
                  <ul className="list-disc list-inside space-y-2 mb-4 text-gray-300">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside space-y-2 mb-4 text-gray-300">
                    {children}
                  </ol>
                ),
                li: ({ children }) => <li className="text-gray-300 leading-relaxed">{children}</li>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-primary pl-4 py-2 my-4 bg-gray-800/50 rounded-r-lg">
                    {children}
                  </blockquote>
                ),
                code: ({ children }) => (
                  <code className="bg-gray-800 px-1.5 py-0.5 rounded text-primary text-sm">
                    {children}
                  </code>
                ),
                hr: () => <hr className="border-gray-700 my-6" />,
              }}
            >
              {analysis}
            </ReactMarkdown>
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
