"use client";

import React, { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { FormInput, FormSelect, FormCheckbox, FormDatePicker } from "@/components/formElements";
import { Button, Icon } from "@/components/common";
import { FREQUENCY_OPTIONS, DAYS_OF_WEEK, WEEKEND_ADJUSTMENT_OPTIONS } from "../constants";
import SchedulePreview from "../components/SchedulePreview";
import type { ExpenseRuleFormValues } from "../formHelpers";

interface IProps {
  totalSteps: number;
}

const ScheduleStep: React.FC<IProps> = ({ totalSteps }) => {
  const { control, setValue } = useFormContext<ExpenseRuleFormValues>();
  const [newSpecificDay, setNewSpecificDay] = useState("");

  const expenseType = useWatch({ control, name: "expenseType" });
  const frequency = useWatch({ control, name: "frequency" });
  const startDate = useWatch({ control, name: "startDate" });
  const endDate = useWatch({ control, name: "endDate" });
  const hasEndDate = useWatch({ control, name: "hasEndDate" });
  const specificDays = useWatch({ control, name: "specificDays" }) || [];
  const weekendAdjustment = useWatch({ control, name: "weekendAdjustment" });
  const dayOfMonth = useWatch({ control, name: "dayOfMonth" });
  const creditDueDate = useWatch({ control, name: "creditDueDate" });

  const handleAddSpecificDay = () => {
    const day = parseInt(newSpecificDay);
    if (day >= 1 && day <= 31 && !specificDays.includes(day)) {
      setValue(
        "specificDays",
        [...specificDays, day].sort((a, b) => a - b)
      );
      setNewSpecificDay("");
    }
  };

  const handleRemoveSpecificDay = (day: number) => {
    setValue(
      "specificDays",
      specificDays.filter((d: number) => d !== day)
    );
  };

  const filteredFrequencyOptions = FREQUENCY_OPTIONS.filter((f) =>
    expenseType === "cash_loan" || expenseType === "credit_card" || expenseType === "installment"
      ? f.value === "monthly"
      : true
  );

  return (
    <div className="space-y-6">
      {totalSteps === 4 ? (
        <>
          <h3 className="text-xl font-bold text-white">Payment Schedule</h3>
          <p className="text-gray-400">When should payments be made?</p>
        </>
      ) : (
        <>
          <h3 className="text-xl font-bold text-white">Schedule & Review</h3>
        </>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {expenseType !== "one-time" && (
          <div>
            <FormSelect
              inputName="frequency"
              label="Frequency"
              options={filteredFrequencyOptions}
            />
          </div>
        )}

        <div>
          <FormDatePicker
            inputName="startDate"
            label={
              expenseType === "one-time"
                ? "Date"
                : expenseType === "credit_card"
                  ? "Start Tracking From"
                  : "First Payment Date"
            }
          />
        </div>

        {/* For credit cards, show the due date as read-only */}
        {frequency === "monthly" && expenseType === "credit_card" && (
          <div>
            <FormInput
              inputName="creditDueDate"
              type="number"
              label="Payment Day (from Due Date)"
              disabled
            />
          </div>
        )}

        {/* For non-credit card monthly expenses, allow setting day of month */}
        {frequency === "monthly" && expenseType !== "credit_card" && (
          <div>
            <FormInput inputName="dayOfMonth" type="number" label="Day of Month" min={1} max={31} />
          </div>
        )}

        {(frequency === "weekly" || frequency === "bi-weekly") && (
          <div>
            <FormSelect
              inputName="dayOfWeek"
              label="Day of Week"
              options={DAYS_OF_WEEK.map((d) => ({ value: d.value.toString(), label: d.label }))}
            />
          </div>
        )}

        {frequency === "semi-monthly" && (
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-400 mb-2">Specific Dates</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {specificDays.map((day: number) => (
                <div
                  key={day}
                  className="bg-danger/20 text-danger px-3 py-1 rounded-lg border border-danger/30 flex items-center gap-2"
                >
                  {day}th
                  <Icon
                    name="close"
                    size="sm"
                    className="cursor-pointer hover:text-white"
                    onClick={() => handleRemoveSpecificDay(day)}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Day (1-31)"
                value={newSpecificDay}
                onChange={(e) => setNewSpecificDay(e.target.value)}
                min={1}
                max={31}
                className="w-32 bg-[#151c2c] border border-gray-700 rounded-lg p-3 text-white focus:outline-none focus:border-primary"
              />
              <Button variant="secondary" onClick={handleAddSpecificDay} disabled={!newSpecificDay}>
                Add Date
              </Button>
            </div>
          </div>
        )}

        {expenseType !== "one-time" &&
          expenseType !== "cash_loan" &&
          expenseType !== "credit_card" &&
          expenseType !== "installment" && (
            <div className="md:col-span-2">
              <FormCheckbox inputName="hasEndDate" label="Set End Date" />
              {hasEndDate && (
                <div className="mt-3">
                  <FormDatePicker inputName="endDate" label="End Date" />
                </div>
              )}
            </div>
          )}

        {expenseType !== "one-time" && (
          <div className="md:col-span-2">
            <FormSelect
              inputName="weekendAdjustment"
              label="Weekend Adjustment"
              options={WEEKEND_ADJUSTMENT_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
            />
          </div>
        )}
      </div>

      {expenseType !== "one-time" && (
        <SchedulePreview
          frequency={frequency}
          startDate={startDate}
          endDate={endDate}
          hasEndDate={hasEndDate}
          specificDays={specificDays}
          weekendAdjustment={weekendAdjustment}
          dayOfMonth={dayOfMonth || undefined}
          creditDueDate={
            expenseType === "credit_card" && creditDueDate ? parseInt(creditDueDate) : undefined
          }
        />
      )}
    </div>
  );
};

export default ScheduleStep;
