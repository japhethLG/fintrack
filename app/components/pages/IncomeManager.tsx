"use client";
import React, { useState } from "react";
import { MOCK_INCOME_RULES } from "@/lib/utils/mockData";
import { IncomeRule } from "@/lib/types";
import { Button, Input, Select, Card, PageHeader, Icon } from "@/components/common";

const IncomeManager: React.FC = () => {
  const [rules, setRules] = useState<IncomeRule[]>(MOCK_INCOME_RULES);

  const frequencyOptions = [
    { value: "monthly-dates", label: "Specific Dates (Monthly)" },
    { value: "bi-weekly", label: "Bi-Weekly" },
    { value: "weekly", label: "Weekly" },
  ];

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto animate-fade-in">
      <PageHeader
        title="Income & Rules"
        description="Manage complex recurring income schedules and dynamic paydays."
        actions={
          <Button
            variant="primary"
            icon={<Icon name="add" />}
            iconPosition="left"
          >
            Add New Rule
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: List */}
        <div className="lg:col-span-1 space-y-4">
          <Card
            header={<h3 className="font-bold text-white">Active Rules</h3>}
            padding="none"
          >
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
                    <Icon name="chevron_right" size="sm" className="text-gray-600" />
                  </div>
                  <p className="text-white text-sm font-medium">${rule.amount.toLocaleString()}</p>
                  <p className="text-xs text-gray-500 mt-1 capitalize">
                    {rule.frequency.replace("-", " ")} • {rule.weekendAdjustment} adj
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right: Editor (Mocked for "Tech Corp Salary") */}
        <div className="lg:col-span-2">
          <Card
            header={<h3 className="text-xl font-bold text-white">Edit: Tech Corp Salary</h3>}
            padding="md"
            footer={
              <>
                <Button variant="danger">Delete Rule</Button>
                <Button variant="primary">Save Changes</Button>
              </>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <Input
                  type="text"
                  label="Source Name"
                  value="Tech Corp Salary"
                  readOnly
                />
              </div>

              <div>
                <Input
                  type="number"
                  label="Amount"
                  value="3200"
                  prefix="$"
                  readOnly
                />
              </div>

              <div>
                <Select
                  label="Frequency"
                  options={frequencyOptions}
                  value="monthly-dates"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Specific Dates
                </label>
                <div className="flex gap-2">
                  <div className="bg-primary/20 text-primary px-3 py-1 rounded-lg border border-primary/30 flex items-center gap-2">
                    5th{" "}
                    <Icon name="close" size="sm" className="cursor-pointer hover:text-white" />
                  </div>
                  <div className="bg-primary/20 text-primary px-3 py-1 rounded-lg border border-primary/30 flex items-center gap-2">
                    20th{" "}
                    <Icon name="close" size="sm" className="cursor-pointer hover:text-white" />
                  </div>
                  <Button variant="ghost" size="sm" className="text-gray-500 hover:text-white">
                    <Icon name="add" size="sm" /> Add Date
                  </Button>
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
          </Card>
        </div>
      </div>
    </div>
  );
};

export default IncomeManager;
