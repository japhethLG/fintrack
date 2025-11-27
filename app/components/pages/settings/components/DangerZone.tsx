"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Icon, Alert } from "@/components/common";
import { useAuth } from "@/contexts/AuthContext";
import ConfirmationModal from "./ConfirmationModal";

type ModalType = "reset" | "delete" | null;

const DangerZone: React.FC = () => {
  const router = useRouter();
  const { user, resetFinancialData, deleteAccount } = useAuth();
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleResetData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await resetFinancialData();
      setActiveModal(null);
      setSuccess("All financial data has been reset successfully.");
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset data");
    } finally {
      setIsLoading(false);
    }
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
      setActiveModal(null);
    }
  };

  return (
    <>
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
          {/* Reset Financial Data */}
          <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="font-medium text-white">Reset Financial Data</h4>
                <p className="text-sm text-gray-400 mt-1">
                  Delete all income sources, expense rules, transactions, and reset your balance to
                  zero. Your account and preferences will be preserved.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0 border-warning/50 text-warning hover:bg-warning/10"
                onClick={() => setActiveModal("reset")}
              >
                Reset Data
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
                onClick={() => setActiveModal("delete")}
              >
                Delete Account
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Reset Data Modal */}
      {activeModal === "reset" && (
        <ConfirmationModal
          title="Reset Financial Data"
          description="This will permanently delete all your income sources, expense rules, transactions, balance history, and alerts. Your balance will be reset to $0. This action cannot be undone."
          confirmText="DELETE"
          confirmButtonText="Reset All Data"
          variant="warning"
          isLoading={isLoading}
          onConfirm={handleResetData}
          onCancel={() => setActiveModal(null)}
        />
      )}

      {/* Delete Account Modal */}
      {activeModal === "delete" && (
        <ConfirmationModal
          title="Delete Your Account"
          description="This will permanently delete your account, profile, and all associated data. You will be logged out and will not be able to recover your account."
          confirmText={user?.email || "DELETE"}
          confirmButtonText="Delete My Account"
          variant="danger"
          isLoading={isLoading}
          onConfirm={handleDeleteAccount}
          onCancel={() => setActiveModal(null)}
        />
      )}
    </>
  );
};

export default DangerZone;
