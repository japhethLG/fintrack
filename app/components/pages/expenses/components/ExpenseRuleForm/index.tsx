"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useForm, Resolver } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Button } from "@/components/common";
import { Form } from "@/components/formElements";
import { ExpenseRuleFormData } from "@/lib/types";
import FormStepIndicator from "./components/FormStepIndicator";
import ExpenseTypeStep from "./steps/ExpenseTypeStep";
import DetailsStep from "./steps/DetailsStep";
import ScheduleStep from "./steps/ScheduleStep";
import ReviewStep from "./steps/ReviewStep";
import {
  expenseRuleSchema,
  getDefaultValues,
  buildScheduleConfig,
  calculateLoanPayment,
  calculateInstallmentAmount,
  calculateCreditCardPayment,
  type ExpenseRuleFormValues,
} from "./formHelpers";

// ============================================================================
// STEP FIELD MAPPING
// ============================================================================

const getFieldsForStep = (step: number, expenseType: string): (keyof ExpenseRuleFormValues)[] => {
  switch (step) {
    case 1:
      return ["expenseType"];
    case 2:
      if (expenseType === "cash_loan") {
        return ["name", "loanPrincipal", "loanInterestRate", "loanTermMonths", "category"];
      }
      if (expenseType === "credit_card") {
        return ["name", "creditBalance", "creditApr", "category"];
      }
      if (expenseType === "installment") {
        return ["name", "installmentTotal", "installmentCount", "category"];
      }
      return ["name", "amount", "category"];
    case 3:
      return ["frequency", "startDate"];
    default:
      return [];
  }
};

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
    resolver: yupResolver(expenseRuleSchema) as Resolver<ExpenseRuleFormValues>,
    mode: "onChange",
  });

  // Destructure formState properly to enable Proxy subscription
  const {
    watch,
    trigger,
    formState: { errors },
  } = methods;

  // Watch expense type for conditional logic
  const expenseType = watch("expenseType");

  // Calculate step count based on expense type
  const totalSteps = useMemo(() => {
    if (
      expenseType === "cash_loan" ||
      expenseType === "credit_card" ||
      expenseType === "installment"
    ) {
      return 4;
    }
    return 3;
  }, [expenseType]);

  // Get fields for current step validation
  const currentStepFields = useMemo(() => getFieldsForStep(step, expenseType), [step, expenseType]);

  // Subscribe to form changes to update button state reactively
  const watchedValues = watch(currentStepFields);

  // Check if current step fields have errors
  const hasStepErrors = currentStepFields.some((field) => !!errors[field]);

  // Check if user can proceed to next step (recomputes when watchedValues change)
  const canProceed = useMemo(() => {
    const values = methods.getValues();
    const allFieldsValid = currentStepFields.every((field) => {
      const value = values[field];
      if (isNumericField(field)) {
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

  const handleSubmit = async (values: ExpenseRuleFormValues) => {
    setError(null);
    setIsSubmitting(true);

    try {
      // Calculate final amount based on expense type
      let finalAmount = parseFloat(values.amount) || 0;

      if (
        values.expenseType === "cash_loan" &&
        values.loanPrincipal &&
        values.loanInterestRate &&
        values.loanTermMonths
      ) {
        finalAmount = calculateLoanPayment(
          parseFloat(values.loanPrincipal),
          parseFloat(values.loanInterestRate),
          parseInt(values.loanTermMonths)
        );
      } else if (
        values.expenseType === "credit_card" &&
        values.creditBalance &&
        values.creditApr &&
        values.creditMinPaymentPercent
      ) {
        finalAmount = calculateCreditCardPayment(
          parseFloat(values.creditBalance),
          parseFloat(values.creditApr),
          parseFloat(values.creditMinPaymentPercent),
          parseFloat(values.creditMinPaymentFloor) || 0,
          values.creditMinPaymentMethod
        );
      } else if (
        values.expenseType === "installment" &&
        values.installmentTotal &&
        values.installmentCount
      ) {
        finalAmount = calculateInstallmentAmount(
          parseFloat(values.installmentTotal),
          parseInt(values.installmentCount),
          values.installmentHasInterest,
          values.installmentInterestRate ? parseFloat(values.installmentInterestRate) : undefined
        );
      }

      const formData: ExpenseRuleFormData = {
        name: values.name.trim(),
        expenseType: values.expenseType,
        category: values.category,
        amount: finalAmount,
        isVariableAmount: values.expenseType === "variable" ? true : values.isVariableAmount,
        frequency: values.expenseType === "one-time" ? "one-time" : values.frequency,
        startDate: values.startDate,
        endDate: values.hasEndDate ? values.endDate : undefined,
        scheduleConfig: buildScheduleConfig(values),
        weekendAdjustment: values.weekendAdjustment,
        notes: values.notes?.trim() || undefined,
        isPriority: values.isPriority,
        isActive: true,
      };

      // Add type-specific config
      if (values.expenseType === "cash_loan" && finalAmount > 0) {
        formData.loanConfig = {
          principalAmount: parseFloat(values.loanPrincipal),
          currentBalance: parseFloat(values.loanCurrentBalance || values.loanPrincipal),
          interestRate: parseFloat(values.loanInterestRate),
          termMonths: parseInt(values.loanTermMonths),
          monthlyPayment: finalAmount,
          calculationType: values.loanCalculationType,
          loanStartDate: values.loanStartDate,
          firstPaymentDate: values.startDate,
          paymentsMade: 0,
        };
      }

      if (values.expenseType === "credit_card") {
        formData.creditConfig = {
          creditLimit: parseFloat(values.creditLimit),
          currentBalance: parseFloat(values.creditBalance),
          apr: parseFloat(values.creditApr),
          minimumPaymentPercent: parseFloat(values.creditMinPaymentPercent),
          minimumPaymentFloor: parseFloat(values.creditMinPaymentFloor),
          minimumPaymentMethod: values.creditMinPaymentMethod,
          statementDate: parseInt(values.creditStatementDate),
          dueDate: parseInt(values.creditDueDate),
          paymentStrategy: values.creditPaymentStrategy,
          ...(values.creditPaymentStrategy === "fixed" && values.creditFixedPayment
            ? { fixedPaymentAmount: parseFloat(values.creditFixedPayment) }
            : {}),
        };
      }

      if (values.expenseType === "installment" && finalAmount > 0) {
        formData.installmentConfig = {
          totalAmount: parseFloat(values.installmentTotal),
          installmentCount: parseInt(values.installmentCount),
          installmentAmount: finalAmount,
          installmentsPaid: 0,
          hasInterest: values.installmentHasInterest,
          ...(values.installmentHasInterest && values.installmentInterestRate
            ? { interestRate: parseFloat(values.installmentInterestRate) }
            : {}),
        };
      }

      await onSubmit(formData);
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
    <Form methods={methods} onSubmit={handleSubmit}>
      <div className="space-y-6">
        <FormStepIndicator currentStep={step} totalSteps={totalSteps} />

        {step === 1 && <ExpenseTypeStep />}
        {step === 2 && <DetailsStep />}
        {step === 3 && <ScheduleStep totalSteps={totalSteps} />}
        {step === 4 && <ReviewStep error={error} />}

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
