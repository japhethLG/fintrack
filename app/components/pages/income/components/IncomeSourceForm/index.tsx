"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useForm, Resolver } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Button, Card } from "@/components/common";
import { Form, FormInput, FormSelect, FormCheckbox } from "@/components/formElements";
import { IncomeSourceFormData } from "@/lib/types";
import { INCOME_CATEGORIES } from "@/lib/constants";
import FormStepIndicator from "../../../expenses/components/ExpenseRuleForm/components/FormStepIndicator";
import SchedulePreview from "../../../expenses/components/ExpenseRuleForm/components/SchedulePreview";
import {
  INCOME_SOURCE_TYPES,
  FREQUENCY_OPTIONS,
  DAYS_OF_WEEK,
  WEEKEND_ADJUSTMENT_OPTIONS,
} from "../../constants";
import {
  incomeSourceSchema,
  getDefaultValues,
  buildScheduleConfig,
  type IncomeSourceFormValues,
} from "./formHelpers";
import { cn } from "@/lib/utils/cn";

// ============================================================================
// STEP FIELD MAPPING
// ============================================================================

const getFieldsForStep = (step: number): (keyof IncomeSourceFormValues)[] => {
  switch (step) {
    case 1:
      return ["sourceType"];
    case 2:
      return ["name", "amount", "category"];
    case 3:
      return ["frequency", "startDate"];
    default:
      return [];
  }
};

// ============================================================================
// INTERFACES
// ============================================================================

interface IProps {
  initialData?: Partial<IncomeSourceFormValues>;
  onSubmit: (data: IncomeSourceFormData) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

const IncomeSourceForm: React.FC<IProps> = ({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
}) => {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const methods = useForm<IncomeSourceFormValues>({
    defaultValues: getDefaultValues(initialData),
    resolver: yupResolver(incomeSourceSchema) as Resolver<IncomeSourceFormValues>,
    mode: "onChange",
  });

  // Destructure formState properly to enable Proxy subscription
  const {
    watch,
    setValue,
    trigger,
    formState: { errors },
  } = methods;

  // Watch fields for UI display
  const sourceType = watch("sourceType");
  const frequency = watch("frequency");
  const startDate = watch("startDate");
  const endDate = watch("endDate");
  const hasEndDate = watch("hasEndDate");
  const specificDays = watch("specificDays");
  const weekendAdjustment = watch("weekendAdjustment");
  const amount = watch("amount");
  const name = watch("name");
  const isVariableAmount = watch("isVariableAmount");
  const category = watch("category");
  const dayOfMonth = watch("dayOfMonth");

  const totalSteps = 4;

  // Get fields for current step validation
  const currentStepFields = useMemo(() => getFieldsForStep(step), [step]);

  // Subscribe to form changes to update button state reactively
  const watchedValues = watch(currentStepFields);

  // Check if current step fields have errors
  const hasStepErrors = currentStepFields.some((field) => !!errors[field]);

  // Check if user can proceed to next step
  const canProceed = useMemo(() => {
    const values = methods.getValues();
    const allFieldsValid = currentStepFields.every((field) => {
      const value = values[field];
      if (field === "amount") {
        return value && parseFloat(value as string) > 0;
      }
      if (typeof value === "string") {
        return value.trim().length > 0;
      }
      return !!value;
    });
    return allFieldsValid && !hasStepErrors;
  }, [watchedValues, currentStepFields, hasStepErrors]); // eslint-disable-line react-hooks/exhaustive-deps

  // Validate current step fields before proceeding
  const validateAndProceed = useCallback(async () => {
    const isValid = await trigger(currentStepFields);
    if (isValid && step < totalSteps) {
      setStep(step + 1);
    }
  }, [trigger, currentStepFields, step, totalSteps]);

  const handleSubmit = async (values: IncomeSourceFormValues) => {
    setError(null);
    setIsSubmitting(true);

    try {
      const formData: IncomeSourceFormData = {
        name: values.name.trim(),
        sourceType: values.sourceType,
        amount: parseFloat(values.amount),
        isVariableAmount: values.isVariableAmount,
        frequency: values.frequency,
        startDate: values.startDate,
        endDate: values.hasEndDate ? values.endDate : undefined,
        scheduleConfig: buildScheduleConfig(values),
        weekendAdjustment: values.weekendAdjustment,
        category: values.category,
        notes: values.notes?.trim() || undefined,
        color: values.color,
        isActive: true,
      };

      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save income source");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    } else {
      onCancel();
    }
  };

  const categoryOptions = INCOME_CATEGORIES.map((c) => ({ value: c, label: c }));

  return (
    <Form methods={methods} onSubmit={handleSubmit}>
      <div className="space-y-6">
        <FormStepIndicator currentStep={step} totalSteps={totalSteps} />

        {/* Step 1: Source Type */}
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-white">Select Income Type</h3>
            <p className="text-gray-400">What type of income is this?</p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {INCOME_SOURCE_TYPES.map((type) => (
                <Card
                  key={type.value}
                  className={cn(
                    "cursor-pointer transition-all hover:border-primary",
                    sourceType === type.value && "border-primary bg-primary/10"
                  )}
                  padding="sm"
                  onClick={() => setValue("sourceType", type.value)}
                >
                  <h4 className="font-bold text-white">{type.label}</h4>
                  <p className="text-xs text-gray-400 mt-1">{type.description}</p>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Details */}
        {step === 2 && (
          <div className="space-y-6">
            <h3 className="text-xl font-bold text-white">Income Details</h3>
            <p className="text-gray-400">Enter the name and amount for this income source.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <FormInput
                  inputName="name"
                  label="Source Name"
                  placeholder="e.g., Tech Corp Salary"
                  isRequired
                />
              </div>

              <div>
                <FormInput
                  inputName="amount"
                  type="number"
                  label="Amount"
                  placeholder="0.00"
                  prefix="$"
                  isRequired
                />
              </div>

              <div>
                <FormSelect
                  inputName="category"
                  label="Category"
                  options={categoryOptions}
                  isRequired
                />
              </div>

              <div className="md:col-span-2">
                <FormCheckbox
                  inputName="isVariableAmount"
                  label="Variable Amount"
                  description="Amount may vary each time (estimate only)"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Schedule */}
        {step === 3 && (
          <div className="space-y-6">
            <h3 className="text-xl font-bold text-white">Schedule Configuration</h3>
            <p className="text-gray-400">Set when you expect to receive this income.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <FormSelect
                  inputName="frequency"
                  label="Frequency"
                  options={FREQUENCY_OPTIONS}
                  isRequired
                />
              </div>

              <div>
                <FormInput inputName="startDate" type="date" label="Start Date" isRequired />
              </div>

              {(frequency === "weekly" || frequency === "bi-weekly") && (
                <div>
                  <FormSelect
                    inputName="dayOfWeek"
                    label="Day of Week"
                    options={DAYS_OF_WEEK.map((d) => ({
                      value: d.value.toString(),
                      label: d.label,
                    }))}
                  />
                </div>
              )}

              {frequency === "monthly" && (
                <div>
                  <FormInput
                    inputName="dayOfMonth"
                    type="number"
                    label="Day of Month"
                    min={1}
                    max={31}
                  />
                </div>
              )}

              <div className="md:col-span-2">
                <FormCheckbox inputName="hasEndDate" label="Set End Date" />
                {hasEndDate && (
                  <div className="mt-3">
                    <FormInput inputName="endDate" type="date" label="End Date" min={startDate} />
                  </div>
                )}
              </div>

              <div className="md:col-span-2">
                <FormSelect
                  inputName="weekendAdjustment"
                  label="Weekend Adjustment"
                  options={WEEKEND_ADJUSTMENT_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                />
                <p className="text-xs text-gray-500 mt-1">
                  What happens if a payment date falls on a weekend?
                </p>
              </div>
            </div>

            <SchedulePreview
              frequency={frequency}
              startDate={startDate}
              endDate={endDate}
              hasEndDate={hasEndDate}
              specificDays={specificDays}
              weekendAdjustment={weekendAdjustment}
              dayOfMonth={dayOfMonth || undefined}
            />
          </div>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
          <div className="space-y-6">
            <h3 className="text-xl font-bold text-white">Review & Confirm</h3>
            <p className="text-gray-400">Review your income source details before saving.</p>

            <Card padding="md">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-400">Type</p>
                  <p className="text-white font-medium capitalize">{sourceType}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Name</p>
                  <p className="text-white font-medium">{name}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Amount</p>
                  <p className="text-success font-bold text-xl">
                    ${parseFloat(amount || "0").toLocaleString()}
                    {isVariableAmount && (
                      <span className="text-xs text-gray-400 ml-1">(estimate)</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Frequency</p>
                  <p className="text-white font-medium capitalize">{frequency.replace("-", " ")}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Start Date</p>
                  <p className="text-white font-medium">
                    {new Date(startDate).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">End Date</p>
                  <p className="text-white font-medium">
                    {hasEndDate && endDate ? new Date(endDate).toLocaleDateString() : "Ongoing"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Category</p>
                  <p className="text-white font-medium">{category}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Weekend Adjustment</p>
                  <p className="text-white font-medium capitalize">
                    {weekendAdjustment === "none" ? "None" : `Pay ${weekendAdjustment}`}
                  </p>
                </div>
              </div>
            </Card>

            <FormInput
              inputName="notes"
              label="Notes (Optional)"
              placeholder="Any additional notes..."
            />

            {error && (
              <div className="p-4 bg-danger/20 border border-danger/30 rounded-lg text-danger">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-6 border-t border-gray-800">
          <Button variant="ghost" onClick={handleBack} type="button">
            {step === 1 ? "Cancel" : "Back"}
          </Button>

          {step === totalSteps ? (
            <Button variant="primary" type="submit" disabled={!canProceed || isSubmitting}>
              {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Create Income Source"}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={validateAndProceed}
              disabled={!canProceed}
              type="button"
            >
              Continue
            </Button>
          )}
        </div>
      </div>
    </Form>
  );
};

export default IncomeSourceForm;
