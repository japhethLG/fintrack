"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useForm, Resolver } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Button } from "@/components/common";
import { Form } from "@/components/formElements";
import { ExpenseRuleFormData } from "@/lib/types";
import { useFollowStartDate } from "@/lib/hooks/useFollowStartDate";
import FormStepIndicator from "./components/FormStepIndicator";
import ValidationIssues from "./components/ValidationIssues";
import ExpenseTypeStep from "./steps/ExpenseTypeStep";
import DetailsStep from "./steps/DetailsStep";
import ScheduleStep from "./steps/ScheduleStep";
import ReviewStep from "./steps/ReviewStep";
import {
  expenseRuleSchema,
  getDefaultValues,
  buildExpenseRulePayload,
  collectExpenseIssues,
  SOFT_ERROR_TYPES,
  type ExpenseRuleFormValues,
} from "./formHelpers";

// ============================================================================
// STEP FIELD MAPPING
// ============================================================================

type Field = keyof ExpenseRuleFormValues;

/** Fields that must be filled in before a step's Continue is enabled. */
const getFieldsForStep = (step: number, expenseType: string): Field[] => {
  switch (step) {
    case 1:
      return ["expenseType"];
    case 2:
      if (expenseType === "cash_loan") {
        return ["name", "loanPrincipal", "loanInterestRate", "loanTermMonths", "category"];
      }
      if (expenseType === "credit_card") {
        return ["name", "creditBalance", "creditApr", "creditDueDate", "category"];
      }
      if (expenseType === "installment") {
        return ["name", "installmentTotal", "installmentCount", "category"];
      }
      // One-time expenses include startDate in step 2
      if (expenseType === "one-time") {
        return ["name", "amount", "category", "startDate"];
      }
      return ["name", "amount", "category"];
    case 3:
      return ["frequency", "startDate"];
    default:
      return [];
  }
};

/** Optional fields whose validation errors also stop a step's Continue (when they are not "soft"). */
const OPTIONAL_CHECKED: Record<string, Field[]> = {
  cash_loan: ["loanCurrentBalance"],
  credit_card: [
    "creditLimit",
    "creditMinPaymentPercent",
    "creditMinPaymentFloor",
    "creditStatementDate",
    "creditFixedPayment",
  ],
  installment: ["installmentInterestRate"],
};

const getCheckedFields = (step: number, expenseType: string): Field[] => [
  ...getFieldsForStep(step, expenseType),
  ...(step === 2 ? (OPTIONAL_CHECKED[expenseType] ?? []) : []),
];

const isNumericField = (field: string): boolean => {
  return ["amount", "loanPrincipal", "creditBalance", "installmentTotal"].includes(field);
};

// ============================================================================
// INTERFACES
// ============================================================================

interface IProps {
  initialData?: Partial<ExpenseRuleFormValues>;
  onSubmit: (data: ExpenseRuleFormData) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

const ExpenseRuleForm: React.FC<IProps> = ({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
}) => {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const methods = useForm<ExpenseRuleFormValues>({
    defaultValues: getDefaultValues(initialData),
    resolver: yupResolver(expenseRuleSchema) as unknown as Resolver<ExpenseRuleFormValues>,
    mode: "onChange",
  });

  // Destructure formState properly to enable Proxy subscription
  const {
    watch,
    setValue,
    trigger,
    formState: { errors },
  } = methods;

  // Watch expense type for conditional logic
  const expenseType = watch("expenseType");
  const startDate = watch("startDate");

  // Day of Week / Day of Month follow the start date until the user sets them (an edit keeps the stored ones).
  useFollowStartDate({
    startDate,
    implicit: {
      dayOfMonth: initialData?.dayOfMonth === undefined,
      dayOfWeek: initialData?.dayOfWeek === undefined,
    },
    get: () => methods.getValues(),
    set: (patch) => {
      if (patch.dayOfMonth !== undefined) setValue("dayOfMonth", patch.dayOfMonth);
      if (patch.dayOfWeek !== undefined) setValue("dayOfWeek", patch.dayOfWeek);
    },
  });

  // Calculate step count based on expense type
  const totalSteps = useMemo(() => {
    if (
      expenseType === "cash_loan" ||
      expenseType === "credit_card" ||
      expenseType === "installment"
    ) {
      return 4;
    }
    // One-time expenses only need 2 steps: Type + Details (with date)
    if (expenseType === "one-time") {
      return 2;
    }
    return 3;
  }, [expenseType]);

  // Fields that gate / validate the current step
  const requiredFields = useMemo(() => getFieldsForStep(step, expenseType), [step, expenseType]);
  const checkedFields = useMemo(() => getCheckedFields(step, expenseType), [step, expenseType]);

  // Subscribe to every value so the button state and the issue list update as the user types
  const allValues = watch() as ExpenseRuleFormValues;

  // Everything that must be fixed before this rule can be saved. It gates the Schedule step's Continue and
  // the final Create/Save button; earlier steps only show the problems inline.
  const issues = collectExpenseIssues(allValues);
  const gatesOnIssues = step >= 3 || step === totalSteps;

  // Hard errors on the step's fields (soft ones show inline but only block from the Schedule step on)
  const isHardError = (field: Field) => {
    const fieldError = errors[field];
    return !!fieldError && !SOFT_ERROR_TYPES.has(String(fieldError.type));
  };
  const hasStepErrors = checkedFields.some(isHardError);

  // Check if user can proceed to next step (recomputes as values change)
  const canProceed = (() => {
    const allFieldsValid = requiredFields.every((field) => {
      const value = allValues[field];
      if (isNumericField(field)) {
        return value && parseFloat(value as string) > 0;
      }
      if (typeof value === "string") {
        return value.trim().length > 0;
      }
      return !!value;
    });
    return allFieldsValid && !hasStepErrors && !(gatesOnIssues && issues.length > 0);
  })();

  // Validate current step fields before proceeding
  const validateAndProceed = useCallback(async () => {
    await trigger(checkedFields);
    const fresh = methods.formState.errors;
    const blocked = checkedFields.some((field) => {
      const fieldError = fresh[field];
      return !!fieldError && !SOFT_ERROR_TYPES.has(String(fieldError.type));
    });
    if (!blocked && step < totalSteps) {
      setStep(step + 1);
    }
  }, [trigger, checkedFields, methods, step, totalSteps]);

  const handleSubmit = async (values: ExpenseRuleFormValues) => {
    setError(null);

    const blocking = collectExpenseIssues(values);
    if (blocking.length > 0) {
      setError(blocking[0].message);
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(buildExpenseRulePayload(values));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save expense rule");
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

  return (
    // Enter inside an input submits the <form>; only the last step may save
    <Form methods={methods} onSubmit={(values) => (step === totalSteps ? handleSubmit(values) : undefined)}>
      <div className="space-y-6">
        <FormStepIndicator currentStep={step} totalSteps={totalSteps} />

        {step === 1 && <ExpenseTypeStep />}
        {step === 2 && <DetailsStep />}
        {step === 3 && <ScheduleStep totalSteps={totalSteps} />}
        {step === 4 && <ReviewStep error={error} />}

        {gatesOnIssues && <ValidationIssues issues={issues} />}
        {error && step !== 4 && (
          <div className="p-4 bg-danger/20 border border-danger/30 rounded-lg text-danger">
            {error}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-6 border-t border-gray-800">
          <Button variant="ghost" onClick={handleBack} type="button">
            {step === 1 ? "Cancel" : "Back"}
          </Button>

          {step === totalSteps ? (
            <Button
              variant="primary"
              type="button"
              onClick={() => handleSubmit(methods.getValues())}
              disabled={!canProceed || isSubmitting}
            >
              {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Create Expense"}
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

export default ExpenseRuleForm;
