"use client";

import React from "react";
import { Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";

interface IProps {
  currentStep: number;
  totalSteps: number;
}

const FormStepIndicator: React.FC<IProps> = ({ currentStep, totalSteps }) => {
  return (
    <div className="flex items-center justify-between mb-8">
      {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
        <div key={step} className="flex items-center">
          <div
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center font-bold transition-colors",
              step < currentStep
                ? "bg-success text-white"
                : step === currentStep
                  ? "bg-primary text-white"
                  : "bg-gray-700 text-gray-400"
            )}
          >
            {step < currentStep ? <Icon name="check" size="sm" /> : step}
          </div>
          {step < totalSteps && (
            <div
              className={cn(
                "w-12 lg:w-20 h-1 mx-2",
                step < currentStep ? "bg-success" : "bg-gray-700"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
};

export default FormStepIndicator;
