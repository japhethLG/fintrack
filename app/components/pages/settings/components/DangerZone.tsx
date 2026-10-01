"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Icon, Alert } from "@/components/common";
import { useAuth } from "@/contexts/AuthContext";
import { useFinancial } from "@/contexts/FinancialContext";
import { DeletableDataType } from "@/lib/types";
import { countBalanceHistory } from "@/lib/firebase/firestore";
import { useModal } from "@/components/modals";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { isGoogleOnlyUser } from "@/lib/firebase/auth";
import { AccountDeletionIncompleteError } from "@/contexts/AuthContext";
import { setFlashNotice } from "@/lib/utils/flashNotice";

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
  const { formatCurrency } = useCurrency();
  const { incomeSources, expenseRules, storedTransactions, alerts } = useFinancial();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Nothing in the app subscribes to balance snapshots, so their number is read on demand
  const [balanceHistoryCount, setBalanceHistoryCount] = useState(0);
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    countBalanceHistory(uid)
      .then((count) => {
        if (!cancelled) setBalanceHistoryCount(count);
      })
      .catch(() => {
        /* the count is informational; a failed read must not break Settings */
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // What a reset would delete: STORED documents. The merged transaction list also holds
  // projections generated on the fly, which are not documents and cannot be deleted
  // (UI-OBS-04, UI-BAL-20/22).
  const dataCounts = useMemo(
    () => ({
      income_sources: incomeSources.length,
      expense_rules: expenseRules.length,
      transactions: storedTransactions.length,
      balance_history: balanceHistoryCount,
      alerts: alerts.length,
    }),
    [
      alerts.length,
      balanceHistoryCount,
      expenseRules.length,
      incomeSources.length,
      storedTransactions.length,
    ]
  );

  const resetSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 5000);
  };

  const handleDeleteAccount = async (password?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      await deleteAccount({ password });
      router.push("/login");
    } catch (err) {
      setIsLoading(false);
      const message = err instanceof Error ? err.message : "Failed to delete account";
      if (err instanceof AccountDeletionIncompleteError) {
        // the data is gone and the user has been signed out: this page is about to go away, so the
        // message travels to the login page
        setFlashNotice(message);
        router.push("/login");
        return;
      }
      setError(message);
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
                if (types.includes("balance_history")) setBalanceHistoryCount(0);

                // Show contextual success message
                // (only deleting transactions resets the balance; snapshots are not part of it)
                const deletedTransactions = types.includes("transactions");
                const deletedRules =
                  types.includes("income_sources") || types.includes("expense_rules");

                if (deletedTransactions) {
                  resetSuccess(
                    `Selected data reset successfully. Your balance has been reset to ${formatCurrency(0)}. Update your initial balance in Settings → Balance Management.`
                  );
                } else if (deletedRules) {
                  resetSuccess(
                    "Selected data reset successfully. Your projections have changed. Consider reviewing your balance in Settings → Balance Management."
                  );
                } else {
                  resetSuccess("Selected financial data has been reset successfully.");
                }
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
        // email users prove it is them with their password (Google users get the Google popup)
        requirePassword: !isGoogleOnlyUser(user),
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
                Balance resets to {formatCurrency(0)} when transactions are removed.
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

