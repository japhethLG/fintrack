"use client";

import React, { useState } from "react";
import { Button, Input, Icon } from "@/components/common";

export interface IModalData {
  title?: string;
  description: string;
  confirmText?: string;
  confirmButtonText?: string;
  variant?: "danger" | "warning" | "default";
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  onCloseModal?: () => void;
}

export interface IProps {
  closeModal: () => void;
  modalData: IModalData;
}

const ConfirmModal: React.FC<IProps> = ({ closeModal, modalData }) => {
  const {
    description,
    confirmText,
    confirmButtonText = "Confirm",
    variant = "default",
    isLoading = false,
    onConfirm,
    onCancel,
  } = modalData;

  const [inputValue, setInputValue] = useState("");

  const needsConfirmText = !!confirmText;
  const isConfirmEnabled = !needsConfirmText || inputValue === confirmText;

  const handleCancel = () => {
    onCancel?.();
    closeModal();
  };

  const handleConfirm = () => {
    onConfirm();
    closeModal();
  };

  const getButtonVariant = () => {
    switch (variant) {
      case "danger":
        return "danger";
      case "warning":
        return "secondary";
      default:
        return "primary";
    }
  };

  return (
    <div>
      {/* Icon based on variant */}
      <div className="flex items-start gap-4 mb-4">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            variant === "danger"
              ? "bg-danger/20"
              : variant === "warning"
                ? "bg-warning/20"
                : "bg-primary/20"
          }`}
        >
          <Icon
            name={variant === "danger" ? "warning" : variant === "warning" ? "info" : "help"}
            size={20}
            className={
              variant === "danger"
                ? "text-danger"
                : variant === "warning"
                  ? "text-warning"
                  : "text-primary"
            }
          />
        </div>
        <p className="text-gray-300 text-sm flex-1">{description}</p>
      </div>

      {/* Confirmation Input */}
      {needsConfirmText && (
        <div className="mb-4">
          <p className="text-sm text-gray-400 mb-2">
            To confirm, type{" "}
            <span className="font-mono font-bold text-white">{confirmText}</span> below:
          </p>
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={`Type "${confirmText}" to confirm`}
            className="font-mono"
            autoFocus
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 mt-4">
        <Button
          type="button"
          variant="ghost"
          className="flex-1"
          onClick={handleCancel}
          disabled={isLoading}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant={getButtonVariant()}
          className="flex-1"
          onClick={handleConfirm}
          disabled={!isConfirmEnabled || isLoading}
          loading={isLoading}
        >
          {isLoading ? "Processing..." : confirmButtonText}
        </Button>
      </div>
    </div>
  );
};

export default ConfirmModal;
