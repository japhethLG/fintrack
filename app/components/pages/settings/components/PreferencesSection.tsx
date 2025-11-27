"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { Button, Card, Icon, Alert } from "@/components/common";
import { Form, FormInput, FormSelect } from "@/components/formElements";
import { useAuth } from "@/contexts/AuthContext";
import { updateUserProfile } from "@/lib/firebase/firestore";
import {
  CURRENCY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  START_OF_WEEK_OPTIONS,
  THEME_OPTIONS,
} from "../constants";

const preferencesSchema = yup.object({
  currency: yup.string().required("Currency is required"),
  dateFormat: yup.string().required("Date format is required"),
  startOfWeek: yup.string().required("Start of week is required"),
  theme: yup.string().required("Theme is required"),
  defaultWarningThreshold: yup.string().required("Warning threshold is required"),
});

type PreferencesForm = yup.InferType<typeof preferencesSchema>;

const PreferencesSection: React.FC = () => {
  const { user, userProfile } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const methods = useForm<PreferencesForm>({
    defaultValues: {
      currency: userProfile?.preferences?.currency || "PHP",
      dateFormat: userProfile?.preferences?.dateFormat || "MM/DD/YYYY",
      startOfWeek: String(userProfile?.preferences?.startOfWeek ?? 0),
      theme: userProfile?.preferences?.theme || "dark",
      defaultWarningThreshold: String(userProfile?.preferences?.defaultWarningThreshold || 500),
    },
    resolver: yupResolver(preferencesSchema),
  });

  const { reset, formState } = methods;
  const { isDirty } = formState;

  useEffect(() => {
    if (userProfile?.preferences) {
      reset({
        currency: userProfile.preferences.currency || "PHP",
        dateFormat: userProfile.preferences.dateFormat || "MM/DD/YYYY",
        startOfWeek: String(userProfile.preferences.startOfWeek ?? 0),
        theme: userProfile.preferences.theme || "dark",
        defaultWarningThreshold: String(userProfile.preferences.defaultWarningThreshold || 500),
      });
    }
  }, [userProfile, reset]);

  const handleSave = async (values: PreferencesForm) => {
    if (!user) return;

    setError(null);
    setSuccess(false);
    setIsSaving(true);

    try {
      await updateUserProfile(user.uid, {
        preferences: {
          currency: values.currency,
          dateFormat: values.dateFormat,
          startOfWeek: parseInt(values.startOfWeek) as 0 | 1,
          theme: values.theme as "dark" | "light",
          defaultWarningThreshold: parseFloat(values.defaultWarningThreshold) || 500,
        },
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update preferences");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card padding="lg">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
          <Icon name="tune" size={20} className="text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Preferences</h3>
          <p className="text-sm text-gray-400">Customize your experience</p>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {success && (
        <div className="mb-4">
          <Alert variant="success">Preferences saved successfully!</Alert>
        </div>
      )}

      <Form methods={methods} onSubmit={handleSave}>
        <div className="space-y-4">
          <FormSelect inputName="currency" label="Currency" options={CURRENCY_OPTIONS} />

          <FormSelect inputName="dateFormat" label="Date Format" options={DATE_FORMAT_OPTIONS} />

          <FormSelect
            inputName="startOfWeek"
            label="Start of Week"
            options={START_OF_WEEK_OPTIONS}
          />

          <FormSelect inputName="theme" label="Theme" options={THEME_OPTIONS} />

          <div>
            <FormInput
              inputName="defaultWarningThreshold"
              type="number"
              label="Low Balance Warning Threshold"
              prefix="₱"
              placeholder="500"
            />
            <p className="text-xs text-gray-500 mt-1">
              You&apos;ll be warned when your balance falls below this amount
            </p>
          </div>

          {isDirty && (
            <div className="pt-4 border-t border-gray-800">
              <Button type="submit" variant="primary" loading={isSaving} disabled={isSaving}>
                Save Preferences
              </Button>
            </div>
          )}
        </div>
      </Form>
    </Card>
  );
};

export default PreferencesSection;
