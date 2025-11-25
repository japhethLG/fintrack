"use client";

import React, { useState, useEffect } from "react";
import { analyzeBudget } from "@/lib/services/geminiService";
import { Transaction, IncomeRule } from "@/lib/types";
import { MOCK_INCOME_RULES } from "@/lib/utils/mockData";
import { Button, Card, Alert, LoadingSpinner, PageHeader, Icon } from "@/components/common";

interface ForecastProps {
  transactions: Transaction[];
}

const Forecast: React.FC<ForecastProps> = ({ transactions }) => {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const result = await analyzeBudget(transactions, MOCK_INCOME_RULES, 12450);
      setAnalysis(result);
    } catch (error) {
      console.error("Failed to analyze budget:", error);
      setAnalysis("Error: Unable to generate analysis. Please check your API configuration.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 lg:p-10 max-w-4xl mx-auto animate-fade-in">
      <div className="text-center mb-10">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg shadow-purple-500/20">
          <Icon name="smart_toy" size={48} className="text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">AI Financial Forecaster</h1>
        <p className="text-gray-400 max-w-lg mx-auto">
          Our AI analyzes your recurring income rules, complex schedules, and upcoming bills to
          predict shortfalls.
        </p>
      </div>

      <Card variant="elevated" padding="lg">
        {!analysis && !loading && (
          <div className="text-center py-10">
            <p className="text-gray-400 mb-6">
              Ready to analyze {transactions.length} transactions and {MOCK_INCOME_RULES.length}{" "}
              income rules.
            </p>
            <Button
              onClick={handleAnalyze}
              variant="primary"
              size="lg"
              className="mx-auto hover:scale-105"
              icon={<Icon name="auto_awesome" />}
              iconPosition="left"
            >
              Generate Forecast
            </Button>
          </div>
        )}

        {loading && (
          <div className="py-20 flex flex-col items-center">
            <LoadingSpinner size="md" color="primary" text="Analyzing cash flow patterns..." />
          </div>
        )}

        {analysis && (
          <div className="prose prose-invert max-w-none">
            <div className="flex items-center justify-between mb-6 pb-6 border-b border-gray-800">
              <h3 className="text-xl font-bold text-white m-0">Analysis Report</h3>
              <Button
                onClick={() => setAnalysis(null)}
                variant="ghost"
                size="sm"
                className="text-gray-400 hover:text-white"
              >
                Reset
              </Button>
            </div>
            <div className="space-y-6 text-gray-300 leading-relaxed whitespace-pre-line">
              {analysis}
            </div>

            <Alert
              variant="info"
              icon={<Icon name="lightbulb" className="text-yellow-500" />}
              title="AI Insight"
              className="mt-8"
            >
              <p className="text-xs text-gray-400 mt-1">
                This forecast is based on your defined rules (e.g., 5th/20th Salary) and does not
                account for external market factors.
              </p>
            </Alert>
          </div>
        )}
      </Card>
    </div>
  );
};

export default Forecast;
