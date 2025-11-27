"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { Button, Card, Icon, Alert } from "@/components/common";
import { Form, FormInput } from "@/components/formElements";
import { useAuth } from "@/contexts/AuthContext";
import { updateUserBalance } from "@/lib/firebase/firestore";

const balanceSchema = yup.object({
  newBalance: yup
    .string()
    .required("Balance is required")
    .test("is-number", "Please enter a valid number", (value) => !isNaN(parseFloat(value || ""))),
});

type BalanceForm = yup.InferType<typeof balanceSchema>;

const BalanceSection: React.FC = () => {
  const { user, userProfile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const methods = useForm<BalanceForm>({
    defaultValues: { newBalance: "" },
    resolver: yupResolver(balanceSchema),
  });

  const handleSave = async (values: BalanceForm) => {
    if (!user) return;

    setError(null);
    setSuccess(false);
    setIsSaving(true);

    try {
      await updateUserBalance(user.uid, parseFloat(values.newBalance));
      setSuccess(true);
      setIsEditing(false);
      methods.reset({ newBalance: "" });
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update balance");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    methods.reset({ newBalance: "" });
    setIsEditing(false);
    setError(null);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: userProfile?.preferences?.currency || "PHP",
    }).format(amount);
  };

  return (
    <Card padding="lg">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-success/20 flex items-center justify-center">
          <Icon name="account_balance_wallet" size={20} className="text-success" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Current Balance</h3>
          <p className="text-sm text-gray-400">Update your account balance</p>
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

      <div className="space-y-4">
        {/* Current Balance Display */}
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <p className="text-sm text-gray-400 mb-1">Current Balance</p>
          <p className="text-3xl font-bold text-white">
            {formatCurrency(userProfile?.currentBalance || 0)}
          </p>
          {userProfile?.balanceLastUpdatedAt && (
            <p className="text-xs text-gray-500 mt-2">
              Last updated: {userProfile.balanceLastUpdatedAt}
            </p>
          )}
        </div>

        {/* Edit Balance */}
        {isEditing ? (
          <Form methods={methods} onSubmit={handleSave}>
            <div className="space-y-3">
              <FormInput
                inputName="newBalance"
                type="number"
                label="New Balance"
                prefix="₱"
                placeholder="Enter new balance"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
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
                  Update Balance
                </Button>
              </div>
            </div>
          </Form>
        ) : (
          <Button
            variant="secondary"
            onClick={() => setIsEditing(true)}
            icon={<Icon name="edit" size={16} />}
            iconPosition="left"
          >
            Update Balance
          </Button>
        )}
      </div>
    </Card>
  );
};

export default BalanceSection;
