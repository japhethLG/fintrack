"use client";

import React, { useState } from "react";
import { Button, Card, Icon, Input } from "@/components/common";

interface IProps {
  title: string;
  description: string;
  confirmText: string;
  confirmButtonText: string;
  variant: "danger" | "warning";
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmationModal: React.FC<IProps> = ({
  title,
  description,
  confirmText,
  confirmButtonText,
  variant,
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  const [inputValue, setInputValue] = useState("");

  const isConfirmEnabled = inputValue === confirmText;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <Card padding="lg" className="w-full max-w-md animate-fade-in">
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              variant === "danger" ? "bg-danger/20" : "bg-warning/20"
            }`}
          >
            <Icon
              name={variant === "danger" ? "warning" : "info"}
              size={24}
              className={variant === "danger" ? "text-danger" : "text-warning"}
            />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">{title}</h2>
            <p className="text-gray-400 text-sm mt-1">{description}</p>
          </div>
        </div>

        {/* Confirmation Input */}
        <div className="mb-6">
          <p className="text-sm text-gray-300 mb-3">
            To confirm, type <span className="font-mono font-bold text-white">{confirmText}</span>{" "}
            below:
          </p>
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={`Type "${confirmText}" to confirm`}
            className="font-mono"
            autoFocus
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            type="button"
            variant="ghost"
            className="flex-1"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            className="flex-1"
            onClick={onConfirm}
            disabled={!isConfirmEnabled || isLoading}
            loading={isLoading}
          >
            {isLoading ? "Processing..." : confirmButtonText}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default ConfirmationModal;
