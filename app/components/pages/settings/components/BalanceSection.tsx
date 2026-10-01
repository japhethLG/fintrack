"use client";

import React, { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { Button, Card, Icon, Alert } from "@/components/common";
import { Form, FormInput } from "@/components/formElements";
import { useAuth } from "@/contexts/AuthContext";
import { useFinancial } from "@/contexts/FinancialContext";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { useDatePreferences } from "@/lib/hooks/useDatePreferences";
import {
  overrideCurrentBalance,
  recalculateBalance,
  setInitialBalance,
} from "@/lib/firebase/firestore";
import { cleanMoney } from "@/lib/logic/balanceCalculator/ledgerMath";

const balanceSchema = yup.object({
  newBalance: yup
    .string()
    .required("Balance is required")
    .test("is-number", "Please enter a valid number", (value) => !isNaN(parseFloat(value || ""))),
});

const initialBalanceSchema = yup.object({
  initialBalance: yup
    .string()
    .required("Initial balance is required")
    .test("is-number", "Please enter a valid number", (value) => !isNaN(parseFloat(value || ""))),
});

type BalanceForm = yup.InferType<typeof balanceSchema>;
type InitialBalanceForm = yup.InferType<typeof initialBalanceSchema>;

const BalanceSection: React.FC = () => {
  const { user, userProfile } = useAuth();
  // `ledger` counts ALL stored completed rows. The merged `transactions` list is windowed and
  // mixes in projections; deriving the balance from it made the mismatch banner and
  // "Recalculate Balance" wrong in both directions (UI-BAL-06/07/08).
  const { ledger, isInitialized } = useFinancial();
  const { formatCurrency, currencySymbol } = useCurrency();
  const { formatDate } = useDatePreferences();
  const [isEditingCurrent, setIsEditingCurrent] = useState(false);
  const [isEditingInitial, setIsEditingInitial] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingInitialBalance, setPendingInitialBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const currentBalanceMethods = useForm<BalanceForm>({
    defaultValues: { newBalance: "" },
    resolver: yupResolver(balanceSchema),
  });

  const initialBalanceMethods = useForm<InitialBalanceForm>({
    defaultValues: { initialBalance: "" },
    resolver: yupResolver(initialBalanceSchema),
  });

  // The balance the ledger implies: initialBalance + SUM(signed(completed stored rows))
  const { computedBalance, completedCount } = useMemo(() => {
    if (!userProfile) return { computedBalance: 0, completedCount: 0 };
    return {
      computedBalance: cleanMoney((userProfile.initialBalance || 0) + ledger.sum),
      completedCount: ledger.completedCount,
    };
  }, [userProfile, ledger]);

  const handleUpdateCurrentBalance = async (values: BalanceForm) => {
    if (!user) return;

    setError(null);
    setSuccess(false);
    setIsSaving(true);

    try {
      // the baseline absorbs the correction (initialBalance = typed balance - completed history),
      // so current == initial + SUM(completed) keeps holding and Recalculate cannot undo it
      await overrideCurrentBalance(user.uid, parseFloat(values.newBalance));
      setSuccess(true);
      setIsEditingCurrent(false);
      currentBalanceMethods.reset({ newBalance: "" });
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update balance");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateInitialBalance = async (values: InitialBalanceForm) => {
    if (!user || !userProfile) return;

    const newInitialBalance = parseFloat(values.initialBalance);

    // Check if there are completed transactions
    if (completedCount > 0) {
      // Show confirmation dialog
      setPendingInitialBalance(newInitialBalance);
      setShowConfirmation(true);
      return;
    }

    // No completed transactions, proceed directly
    await applyInitialBalanceUpdate(newInitialBalance);
  };

  const applyInitialBalanceUpdate = async (newInitialBalance: number) => {
    if (!user) return;

    setError(null);
    setSuccess(false);
    setIsSaving(true);

    try {
      // baseline and balance change together, from every stored completed row
      await setInitialBalance(user.uid, newInitialBalance);
      setSuccess(true);
      setIsEditingInitial(false);
      setShowConfirmation(false);
      setPendingInitialBalance(null);
      initialBalanceMethods.reset({ initialBalance: "" });
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update initial balance");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRecalculateBalance = async () => {
    if (!user) return;

    setError(null);
    setIsRecalculating(true);

    try {
      await recalculateBalance(user.uid);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to recalculate balance");
    } finally {
      setIsRecalculating(false);
    }
  };

  const handleCancelCurrentBalance = () => {
    currentBalanceMethods.reset({ newBalance: "" });
    setIsEditingCurrent(false);
    setError(null);
  };

  const handleCancelInitialBalance = () => {
    initialBalanceMethods.reset({ initialBalance: "" });
    setIsEditingInitial(false);
    setShowConfirmation(false);
    setPendingInitialBalance(null);
    setError(null);
  };

  const newComputedBalance =
    pendingInitialBalance !== null ? cleanMoney(pendingInitialBalance + ledger.sum) : null;

  return (
    <Card padding="lg">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-success/20 flex items-center justify-center">
          <Icon name="account_balance_wallet" size={20} className="text-success" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Balance Management</h3>
          <p className="text-sm text-gray-400">Manage your account balances and reconciliation</p>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {success && (
        <div className="mb-4">
          <Alert variant="success">Balance updated successfully!</Alert>
        </div>
      )}

      <div className="space-y-6">
        {/* Current Balance Section */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-gray-300">Current Balance</h4>
          <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-400">Current</p>
              <p className="text-2xl font-bold text-white">
                {formatCurrency(userProfile?.currentBalance || 0)}
              </p>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>
                Computed from {completedCount} transaction{completedCount === 1 ? "" : "s"}
              </span>
              <span>{formatCurrency(computedBalance)}</span>
            </div>
            {userProfile?.balanceLastUpdatedAt && (
              <p className="text-xs text-gray-500 mt-2">
                Last updated: {formatDate(userProfile.balanceLastUpdatedAt)}
              </p>
            )}
          </div>

          {/* Recalculate Button */}
          {isInitialized && Math.abs((userProfile?.currentBalance || 0) - computedBalance) > 0.01 && (
            <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg">
              <p className="text-sm text-warning mb-2">
                Balance mismatch detected:{" "}
                {formatCurrency(Math.abs((userProfile?.currentBalance || 0) - computedBalance))}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRecalculateBalance}
                loading={isRecalculating}
                icon={<Icon name="sync" size={16} />}
                iconPosition="left"
              >
                Recalculate Balance
              </Button>
            </div>
          )}

          {/* Override Current Balance */}
          {isEditingCurrent ? (
            <Form methods={currentBalanceMethods} onSubmit={handleUpdateCurrentBalance}>
              <div className="space-y-3">
                <Alert variant="warning">
                  Warning: This will override the computed balance. Your starting balance is adjusted
                  to match, so your transaction history still adds up and nothing you recorded
                  changes. Use only for manual corrections.
                </Alert>
                <FormInput
                  inputName="newBalance"
                  type="number"
                  label="Override Current Balance"
                  prefix={currencySymbol}
                  placeholder="Enter new balance"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelCurrentBalance}
                    disabled={isSaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={isSaving}
                    disabled={isSaving}
                  >
                    Override Balance
                  </Button>
                </div>
              </div>
            </Form>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditingCurrent(true)}
              icon={<Icon name="edit" size={16} />}
              iconPosition="left"
            >
              Override Current Balance
            </Button>
          )}
        </div>

        {/* Initial Balance Section */}
        <div className="space-y-4 pt-6 border-t border-gray-800">
          <h4 className="text-sm font-semibold text-gray-300">Initial Balance</h4>
          <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <p className="text-sm text-gray-400 mb-1">Starting Balance (Baseline)</p>
            <p className="text-2xl font-bold text-white">
              {formatCurrency(userProfile?.initialBalance || 0)}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              This is your account balance when you started tracking
            </p>
          </div>

          {/* Confirmation Dialog */}
          {showConfirmation && pendingInitialBalance !== null && (
            <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg space-y-3">
              <div className="flex items-start gap-2">
                <Icon name="info" size={20} className="text-primary mt-0.5" />
                <div className="flex-1">
                  <h5 className="text-sm font-semibold text-white mb-2">
                    Confirm Initial Balance Update
                  </h5>
                  <p className="text-sm text-gray-300 mb-3">
                    You have {completedCount} completed transactions. Updating your initial balance
                    will recalculate your current balance.
                  </p>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">New initial balance:</span>
                      <span className="text-white font-semibold">
                        {formatCurrency(pendingInitialBalance)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">New computed balance:</span>
                      <span className="text-white font-semibold">
                        {formatCurrency(newComputedBalance || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-warning">
                      <span>Current balance will change from:</span>
                      <span>{formatCurrency(userProfile?.currentBalance || 0)}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelInitialBalance}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => applyInitialBalanceUpdate(pendingInitialBalance)}
                  loading={isSaving}
                  disabled={isSaving}
                >
                  Update & Recalculate
                </Button>
              </div>
            </div>
          )}

          {/* Edit Initial Balance */}
          {!showConfirmation &&
            (isEditingInitial ? (
              <Form methods={initialBalanceMethods} onSubmit={handleUpdateInitialBalance}>
                <div className="space-y-3">
                  <FormInput
                    inputName="initialBalance"
                    type="number"
                    label="Set Initial Balance"
                    prefix={currencySymbol}
                    placeholder="Enter initial balance"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelInitialBalance}
                      disabled={isSaving}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      loading={isSaving}
                      disabled={isSaving}
                    >
                      Update Initial Balance
                    </Button>
                  </div>
                </div>
              </Form>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsEditingInitial(true)}
                icon={<Icon name="edit" size={16} />}
                iconPosition="left"
              >
                Update Initial Balance
              </Button>
            ))}
        </div>
      </div>
    </Card>
  );
};

export default BalanceSection;
