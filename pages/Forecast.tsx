import React, { useState, useEffect } from 'react';
import { analyzeBudget } from '../services/geminiService';
import { Transaction, IncomeRule } from '../types';
import { MOCK_INCOME_RULES } from '../utils/mockData';

interface ForecastProps {
  transactions: Transaction[];
}

const Forecast: React.FC<ForecastProps> = ({ transactions }) => {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(!!process.env.API_KEY);

  // In a real app, we might check for API key presence differently or ask user to input it
  
  const handleAnalyze = async () => {
    if (!hasApiKey) {
        // Simulate analysis for demo purposes if no key is present
        setLoading(true);
        setTimeout(() => {
            setAnalysis(`
**Cash Flow Analysis:**
The user is currently cash flow positive. With a projected income of $4,000 against $2,100 in projected expenses for the remainder of the month, the end-of-month balance is expected to increase by approximately $1,900.

**Upcoming Risks:**
The "Car Loan" payment of $350 is due on the 15th. While the current balance covers this, the "Tech Corp Salary" scheduled for the 20th means there is a 5-day window where cash reserves will be lower. Ensure the balance stays above $500 during this period to avoid overdrafts from unexpected smaller debits.

**Recommendation:**
Consider moving the "Student Loan" payment date to the 22nd to align with your second salary deposit. This would smooth out your cash flow curve and reduce the mid-month dip risk.
            `);
            setLoading(false);
        }, 2000);
        return;
    }

    setLoading(true);
    const result = await analyzeBudget(transactions, MOCK_INCOME_RULES, 12450);
    setAnalysis(result);
    setLoading(false);
  };

  return (
    <div className="p-6 lg:p-10 max-w-4xl mx-auto animate-fade-in">
      <div className="text-center mb-10">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg shadow-purple-500/20">
          <span className="material-symbols-outlined text-white text-3xl">smart_toy</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">AI Financial Forecaster</h1>
        <p className="text-gray-400 max-w-lg mx-auto">
          Our AI analyzes your recurring income rules, complex schedules, and upcoming bills to predict shortfalls.
        </p>
      </div>

      <div className="bg-[#1a2336] border border-gray-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-8">
           {!analysis && !loading && (
               <div className="text-center py-10">
                   <p className="text-gray-400 mb-6">Ready to analyze {transactions.length} transactions and {MOCK_INCOME_RULES.length} income rules.</p>
                   <button 
                    onClick={handleAnalyze}
                    className="px-8 py-4 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary/90 transition-all hover:scale-105 shadow-lg shadow-primary/30 flex items-center gap-3 mx-auto"
                   >
                     <span className="material-symbols-outlined">auto_awesome</span>
                     Generate Forecast
                   </button>
                   {!hasApiKey && <p className="text-xs text-gray-600 mt-4 italic">(Demo Mode: Simulating AI response)</p>}
               </div>
           )}

           {loading && (
               <div className="py-20 flex flex-col items-center">
                   <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
                   <p className="text-gray-400 animate-pulse">Analyzing cash flow patterns...</p>
               </div>
           )}

           {analysis && (
               <div className="prose prose-invert max-w-none">
                   <div className="flex items-center justify-between mb-6 pb-6 border-b border-gray-800">
                       <h3 className="text-xl font-bold text-white m-0">Analysis Report</h3>
                       <button onClick={() => setAnalysis(null)} className="text-sm text-gray-400 hover:text-white">Reset</button>
                   </div>
                   <div className="space-y-6 text-gray-300 leading-relaxed whitespace-pre-line">
                       {analysis}
                   </div>
                   
                   <div className="mt-8 p-4 bg-[#151c2c] border border-gray-800 rounded-xl flex items-start gap-3">
                       <span className="material-symbols-outlined text-yellow-500 mt-1">lightbulb</span>
                       <div>
                           <h4 className="font-bold text-white text-sm">AI Insight</h4>
                           <p className="text-xs text-gray-400 mt-1">This forecast is based on your defined rules (e.g., 5th/20th Salary) and does not account for external market factors.</p>
                       </div>
                   </div>
               </div>
           )}
        </div>
      </div>
    </div>
  );
};

export default Forecast;