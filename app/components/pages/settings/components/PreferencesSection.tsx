"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { Button, Card, Icon, Alert } from "@/components/common";
import { Form, FormInput, FormSelect } from "@/components/formElements";
import { useAuth } from "@/contexts/AuthContext";
import { updateUserProfile } from "@/lib/firebase/firestore";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { resolveCurrency } from "@/lib/utils/currency";
import type { UserProfile } from "@/lib/types";
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

const DEFAULT_WARNING_THRESHOLD = 500;

/** Form values for the stored preferences; a stored 0 is a real threshold, not "missing". */
const valuesFrom = (preferences: Partial<UserProfile["preferences"]> | undefined): PreferencesForm => ({
  currency: resolveCurrency(preferences?.currency),
  dateFormat: preferences?.dateFormat || "MM/DD/YYYY",
  startOfWeek: String(preferences?.startOfWeek ?? 0),
  theme: preferences?.theme || "dark",
  defaultWarningThreshold: String(preferences?.defaultWarningThreshold ?? DEFAULT_WARNING_THRESHOLD),
});

const PreferencesSection: React.FC = () => {
  const { user, userProfile } = useAuth();
  const { currencySymbol } = useCurrency();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const methods = useForm<PreferencesForm>({
    defaultValues: valuesFrom(userProfile?.preferences),
    resolver: yupResolver(preferencesSchema),
  });

  const { reset, formState } = methods;
  const { isDirty } = formState;

  // Re-sync the form only when the STORED PREFERENCES change (another device, or our own save).
  // Keyed on their value, not on the profile object: any other profile update (a balance
  // override, a new display name, a profile picture) used to re-run this and throw away
  // unsaved edits (UI-BAL-46). Fields the user has edited keep their values either way.
  const storedPreferences = JSON.stringify(userProfile?.preferences ?? null);
  useEffect(() => {
    const stored = JSON.parse(storedPreferences) as UserProfile["preferences"] | null;
    if (stored) reset(valuesFrom(stored), { keepDirtyValues: true });
  }, [storedPreferences, reset]);

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
          // `|| 500` turned a threshold of 0 into 500 (UI-OBS-03, UI-BAL-24/25); only a
          // non-number falls back to the default
          defaultWarningThreshold: Number.isFinite(parseFloat(values.defaultWarningThreshold))
            ? parseFloat(values.defaultWarningThreshold)
            : DEFAULT_WARNING_THRESHOLD,
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
              prefix={currencySymbol}
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
