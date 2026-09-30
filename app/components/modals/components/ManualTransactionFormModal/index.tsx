"use client";

import React from "react";
import { Transaction } from "@/lib/types";
import { useFinancial } from "@/contexts/FinancialContext";
import ManualTransactionForm from "@/components/pages/transactions/components/ManualTransactionForm";

// ============================================================================
// MODAL DATA INTERFACE
// ============================================================================

export interface IModalData {
  transaction?: Transaction; // For editing
  prefilledDate?: string; // For prefilling date when creating new transaction
  onClose?: () => void;
  onSuccess?: () => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

interface IProps {
  modalData?: IModalData;
  closeModal: () => void;
}

const ManualTransactionFormModal: React.FC<IProps> = ({ modalData, closeModal }) => {
  const { addManualTransaction, updateManualTransaction, deleteManualTransaction } = useFinancial();
  const isEditing = !!modalData?.transaction;

  const handleSubmit = async (
    transactionData: Partial<Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">>
  ) => {
    if (isEditing && modalData?.transaction) {
      // Update existing manual transaction (only the fields the user changed)
      await updateManualTransaction(modalData.transaction.id, transactionData);
    } else {
      // Create new manual transaction (the form hands over a complete one)
      await addManualTransaction(
        transactionData as Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">
      );
    }

    modalData?.onSuccess?.();
    closeModal();
  };

  const handleDelete = async () => {
    if (!isEditing || !modalData?.transaction) return;

    if (
      confirm("Are you sure you want to delete this transaction? This action cannot be undone.")
    ) {
      await deleteManualTransaction(modalData.transaction.id);
      modalData?.onSuccess?.();
      closeModal();
    }
  };

  const handleCancel = () => {
    modalData?.onClose?.();
    closeModal();
  };

  return (
    <ManualTransactionForm
      initialData={modalData?.transaction}
      prefilledDate={modalData?.prefilledDate}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
      onDelete={isEditing ? handleDelete : undefined}
      isEditing={isEditing}
    />
  );
};

export default ManualTransactionFormModal;
