"use client";
import React, { useState } from "react";
import { MOCK_INCOME_RULES } from "@/lib/utils/mockData";
import { IncomeRule } from "@/lib/types";

const IncomeManager: React.FC = () => {
  const [rules, setRules] = useState<IncomeRule[]>(MOCK_INCOME_RULES);

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto animate-fade-in">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Income & Rules</h1>
          <p className="text-gray-400">
            Manage complex recurring income schedules and dynamic paydays.
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg font-bold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/25">
          <span className="material-symbols-outlined">add</span>
          Add New Rule
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: List */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-[#1a2336] border border-gray-800 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-800 bg-[#1e273b]">
              <h3 className="font-bold text-white">Active Rules</h3>
            </div>
            <div className="divide-y divide-gray-800">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="p-4 hover:bg-gray-800/50 cursor-pointer transition-colors group"
                >
                  <div className="flex justify-between items-start mb-1">
                    <h4 className="font-bold text-primary group-hover:text-white transition-colors">
                      {rule.name}
                    </h4>
                    <span className="material-symbols-outlined text-gray-600 text-sm">
                      chevron_right
                    </span>
                  </div>
                  <p className="text-white text-sm font-medium">${rule.amount.toLocaleString()}</p>
                  <p className="text-xs text-gray-500 mt-1 capitalize">
                    {rule.frequency.replace("-", " ")} • {rule.weekendAdjustment} adj
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Editor (Mocked for "Tech Corp Salary") */}
        <div className="lg:col-span-2">
          <div className="bg-[#1a2336] border border-gray-800 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-gray-800">
              <h3 className="text-xl font-bold text-white">Edit: Tech Corp Salary</h3>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-400 mb-2">Source Name</label>
                <input
                  type="text"
                  value="Tech Corp Salary"
                  className="w-full bg-[#151c2c] border border-gray-700 rounded-lg p-3 text-white focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-gray-500">$</span>
                  <input
                    type="number"
                    value="3200"
                    className="w-full bg-[#151c2c] border border-gray-700 rounded-lg p-3 pl-8 text-white focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Frequency</label>
                <select className="w-full bg-[#151c2c] border border-gray-700 rounded-lg p-3 text-white focus:outline-none focus:border-primary transition-colors">
                  <option value="monthly-dates">Specific Dates (Monthly)</option>
                  <option value="bi-weekly">Bi-Weekly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Specific Dates
                </label>
                <div className="flex gap-2">
                  <div className="bg-primary/20 text-primary px-3 py-1 rounded-lg border border-primary/30 flex items-center gap-2">
                    5th{" "}
                    <span className="material-symbols-outlined text-sm cursor-pointer hover:text-white">
                      close
                    </span>
                  </div>
                  <div className="bg-primary/20 text-primary px-3 py-1 rounded-lg border border-primary/30 flex items-center gap-2">
                    20th{" "}
                    <span className="material-symbols-outlined text-sm cursor-pointer hover:text-white">
                      close
                    </span>
                  </div>
                  <button className="text-gray-500 hover:text-white text-sm flex items-center gap-1 px-2">
                    <span className="material-symbols-outlined text-sm">add</span> Add Date
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Funds are expected on the 5th and 20th of every month.
                </p>
              </div>

              <div className="md:col-span-2 p-4 bg-[#1e273b] rounded-xl border border-gray-800">
                <div className="flex items-start gap-3">
                  <div className="pt-1">
                    <input
                      type="checkbox"
                      checked
                      className="w-4 h-4 rounded border-gray-600 bg-[#151c2c] text-primary focus:ring-offset-[#1e273b]"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-white block">Weekend Adjustment</label>
                    <p className="text-sm text-gray-400 mt-1">
                      If a specific payday falls on a Saturday or Sunday, the system will expect the
                      transaction on the{" "}
                      <span className="text-white font-bold">preceding Friday</span>.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 bg-[#151c2c] border-t border-gray-800 flex justify-end gap-3">
              <button className="px-4 py-2 text-danger hover:bg-danger/10 rounded-lg font-medium transition-colors">
                Delete Rule
              </button>
              <button className="px-4 py-2 bg-primary text-white rounded-lg font-bold hover:bg-primary/90 transition-colors">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IncomeManager;
