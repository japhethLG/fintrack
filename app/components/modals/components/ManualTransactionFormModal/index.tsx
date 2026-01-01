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
    transactionData: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">
  ) => {
    if (isEditing && modalData?.transaction) {
      // Update existing manual transaction
      await updateManualTransaction(modalData.transaction.id, transactionData);
    } else {
      // Create new manual transaction
      await addManualTransaction(transactionData);
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
      onSubmit={handleSubmit}
      onCancel={handleCancel}
      onDelete={isEditing ? handleDelete : undefined}
      isEditing={isEditing}
    />
  );
};

export default ManualTransactionFormModal;
