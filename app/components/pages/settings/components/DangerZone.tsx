"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Icon, Alert } from "@/components/common";
import { useAuth } from "@/contexts/AuthContext";
import { useFinancial } from "@/contexts/FinancialContext";
import { DeletableDataType } from "@/lib/types";
import { useModal } from "@/components/modals";

const DATA_LABELS: Record<DeletableDataType, string> = {
  income_sources: "Income Sources",
  expense_rules: "Expense Rules",
  transactions: "Transactions",
  balance_history: "Balance History",
  alerts: "Alerts",
};

const DangerZone: React.FC = () => {
  const router = useRouter();
  const { openModal, closeModal } = useModal();
  const { user, resetSelectiveFinancialData, deleteAccount } = useAuth();
  const { incomeSources, expenseRules, transactions, alerts } = useFinancial();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const dataCounts = useMemo(
    () => ({
      income_sources: incomeSources.length,
      expense_rules: expenseRules.length,
      transactions: transactions.length,
      balance_history: 0,
      alerts: alerts.length,
    }),
    [alerts.length, expenseRules.length, incomeSources.length, transactions.length]
  );

  const resetSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 5000);
  };

  const handleDeleteAccount = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await deleteAccount();
      router.push("/login");
    } catch (err) {
      setIsLoading(false);
      setError(err instanceof Error ? err.message : "Failed to delete account");
      closeModal("ConfirmModal");
    }
  };

  const openSelectiveResetModal = () => {
    openModal("SelectiveResetModal", {
      counts: dataCounts,
      onConfirm: (types: DeletableDataType[]) => {
        closeModal("SelectiveResetModal");
        // Open confirmation modal with inline handler that uses types directly
        openModal(
          "ConfirmModal",
          {
            description: `This will delete: ${
              types.length > 0 ? types.map((type) => DATA_LABELS[type]).join(", ") : "no selections"
            }. Type DELETE to confirm.`,
            confirmText: "DELETE",
            confirmButtonText: "Reset Selected Data",
            variant: "warning" as const,
            isLoading,
            onConfirm: async () => {
              setIsLoading(true);
              setError(null);
              try {
                await resetSelectiveFinancialData(types);
                closeModal("ConfirmModal");
                resetSuccess("Selected financial data has been reset successfully.");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to reset selected data");
              } finally {
                setIsLoading(false);
              }
            },
          },
          "Confirm Selected Reset"
        );
      },
      onCancel: () => {},
      isSubmitting: isLoading,
    });
  };

  const openDeleteAccountModal = () => {
    openModal(
      "ConfirmModal",
      {
        description:
          "This will permanently delete your account, profile, and all associated data. You will be logged out and will not be able to recover your account.",
        confirmText: user?.email || "DELETE",
        confirmButtonText: "Delete My Account",
        variant: "danger" as const,
        isLoading,
        onConfirm: handleDeleteAccount,
      },
      "Delete Your Account"
    );
  };

  return (
    <Card padding="lg" className="border-danger/30">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-danger/20 flex items-center justify-center">
          <Icon name="warning" size={20} className="text-danger" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Danger Zone</h3>
          <p className="text-sm text-gray-400">Irreversible actions</p>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {success && (
        <div className="mb-4">
          <Alert variant="success">{success}</Alert>
        </div>
      )}

      <div className="space-y-4">
        {/* Reset Financial Data (All or Selective) */}
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="font-medium text-white">Reset Financial Data</h4>
              <p className="text-sm text-gray-400 mt-1">
                Choose exactly what to delete or pick "All Financial Data" to wipe everything.
                Balance resets to $0 when transactions or balance history are removed.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 border-warning/50 text-warning hover:bg-warning/10"
              onClick={openSelectiveResetModal}
            >
              Selective Reset
            </Button>
          </div>
        </div>

        {/* Delete Account */}
        <div className="p-4 bg-danger/5 rounded-lg border border-danger/30">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="font-medium text-white">Delete Account</h4>
              <p className="text-sm text-gray-400 mt-1">
                Permanently delete your account and all associated data. This action cannot be
                undone.
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              className="shrink-0"
              onClick={openDeleteAccountModal}
            >
              Delete Account
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default DangerZone;

