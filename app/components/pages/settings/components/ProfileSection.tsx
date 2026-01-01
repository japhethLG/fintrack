"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { Button, Card, Icon, Alert, ProfilePictureUpload } from "@/components/common";
import { Form, FormInput } from "@/components/formElements";
import { useAuth } from "@/contexts/AuthContext";
import { useFinancial } from "@/contexts/FinancialContext";
import { updateUserProfile } from "@/lib/firebase/firestore";
import { reauthenticateUser, updateUserEmail, updateUserPassword } from "@/lib/firebase/auth";

type EditMode = "none" | "displayName" | "email" | "password";

// Form schemas
const displayNameSchema = yup.object({
  displayName: yup.string().required("Display name is required").min(1, "Display name is required"),
});

const emailSchema = yup.object({
  newEmail: yup.string().required("Email is required").email("Please enter a valid email"),
  currentPassword: yup.string().required("Current password is required"),
});

const passwordSchema = yup.object({
  currentPassword: yup.string().required("Current password is required"),
  newPassword: yup
    .string()
    .required("New password is required")
    .min(6, "Password must be at least 6 characters"),
  confirmPassword: yup
    .string()
    .required("Please confirm your password")
    .oneOf([yup.ref("newPassword")], "Passwords do not match"),
});

type DisplayNameForm = yup.InferType<typeof displayNameSchema>;
type EmailForm = yup.InferType<typeof emailSchema>;
type PasswordForm = yup.InferType<typeof passwordSchema>;

const getAuthErrorMessage = (error: unknown): string => {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (errorMessage.includes("auth/requires-recent-login")) {
    return "Please enter your current password to make this change.";
  }
  if (
    errorMessage.includes("auth/wrong-password") ||
    errorMessage.includes("auth/invalid-credential")
  ) {
    return "Current password is incorrect.";
  }
  if (errorMessage.includes("auth/email-already-in-use")) {
    return "This email is already in use by another account.";
  }
  if (errorMessage.includes("auth/invalid-email")) {
    return "Please enter a valid email address.";
  }
  if (errorMessage.includes("auth/weak-password")) {
    return "Password is too weak. Please use at least 6 characters.";
  }

  return errorMessage;
};

const ProfileSection: React.FC = () => {
  const { user, userProfile } = useAuth();
  const { updateProfilePicture } = useFinancial();
  const [editMode, setEditMode] = useState<EditMode>("none");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form methods
  const displayNameMethods = useForm<DisplayNameForm>({
    defaultValues: { displayName: userProfile?.displayName || "" },
    resolver: yupResolver(displayNameSchema),
  });

  const emailMethods = useForm<EmailForm>({
    defaultValues: { newEmail: "", currentPassword: "" },
    resolver: yupResolver(emailSchema),
  });

  const passwordMethods = useForm<PasswordForm>({
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
    resolver: yupResolver(passwordSchema),
  });

  const resetForms = () => {
    displayNameMethods.reset({ displayName: userProfile?.displayName || "" });
    emailMethods.reset({ newEmail: "", currentPassword: "" });
    passwordMethods.reset({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setEditMode("none");
    setError(null);
  };

  const handleProfilePictureUpload = async (imageUrl: string) => {
    setError(null);
    setSuccess(null);

    try {
      await updateProfilePicture(imageUrl);
      setSuccess("Profile picture updated successfully!");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      throw new Error(getAuthErrorMessage(err));
    }
  };

  const handleSaveDisplayName = async (values: DisplayNameForm) => {
    if (!user) return;

    setError(null);
    setSuccess(null);
    setIsSaving(true);

    try {
      await updateUserProfile(user.uid, { displayName: values.displayName.trim() });
      setSuccess("Display name updated successfully!");
      setEditMode("none");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEmail = async (values: EmailForm) => {
    if (!user) return;

    setError(null);
    setSuccess(null);
    setIsSaving(true);

    try {
      await reauthenticateUser(values.currentPassword);
      await updateUserEmail(values.newEmail.trim());
      await updateUserProfile(user.uid, { email: values.newEmail.trim() });

      setSuccess("Email updated successfully!");
      resetForms();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePassword = async (values: PasswordForm) => {
    setError(null);
    setSuccess(null);
    setIsSaving(true);

    try {
      await reauthenticateUser(values.currentPassword);
      await updateUserPassword(values.newPassword);

      setSuccess("Password updated successfully!");
      resetForms();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (mode: EditMode) => {
    resetForms();
    setEditMode(mode);
  };

  return (
    <Card padding="lg">
      {/* Header with Profile Picture */}
      <div className="flex flex-col items-center gap-4 mb-6 pb-6 border-b border-gray-800">
        {/* Profile Picture */}
        <ProfilePictureUpload
          currentImageUrl={userProfile?.profilePictureUrl}
          displayName={userProfile?.displayName}
          onUploadComplete={handleProfilePictureUpload}
          size="lg"
        />

        {/* Header Text */}
        <div className="text-center">
          <h3 className="text-xl font-bold text-white mb-1">Profile</h3>
          <p className="text-sm text-gray-400">Manage your account information</p>
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
        {/* Display Name */}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">Display Name</label>
          {editMode === "displayName" ? (
            <Form methods={displayNameMethods} onSubmit={handleSaveDisplayName}>
              <div className="space-y-3">
                <FormInput inputName="displayName" placeholder="Enter your display name" />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={resetForms}
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
                    Save
                  </Button>
                </div>
              </div>
            </Form>
          ) : (
            <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
              <span className="text-white">{userProfile?.displayName || "Not set"}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startEdit("displayName")}
                icon={<Icon name="edit" size={16} />}
              >
                Edit
              </Button>
            </div>
          )}
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">Email</label>
          {editMode === "email" ? (
            <Form methods={emailMethods} onSubmit={handleSaveEmail}>
              <div className="space-y-3">
                <FormInput inputName="newEmail" type="email" placeholder="Enter new email" />
                <FormInput
                  inputName="currentPassword"
                  type="password"
                  placeholder="Enter current password to confirm"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={resetForms}
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
                    Update Email
                  </Button>
                </div>
              </div>
            </Form>
          ) : (
            <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
              <div className="flex items-center gap-2">
                <Icon name="mail" size={18} className="text-gray-500" />
                <span className="text-white">{user?.email || "No email"}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startEdit("email")}
                icon={<Icon name="edit" size={16} />}
              >
                Change
              </Button>
            </div>
          )}
        </div>

        {/* Password */}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">Password</label>
          {editMode === "password" ? (
            <Form methods={passwordMethods} onSubmit={handleSavePassword}>
              <div className="space-y-3">
                <FormInput
                  inputName="currentPassword"
                  type="password"
                  placeholder="Current password"
                />
                <FormInput
                  inputName="newPassword"
                  type="password"
                  placeholder="New password (min 6 characters)"
                />
                <FormInput
                  inputName="confirmPassword"
                  type="password"
                  placeholder="Confirm new password"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={resetForms}
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
                    Update Password
                  </Button>
                </div>
              </div>
            </Form>
          ) : (
            <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
              <div className="flex items-center gap-2">
                <Icon name="lock" size={18} className="text-gray-500" />
                <span className="text-gray-400">••••••••</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startEdit("password")}
                icon={<Icon name="edit" size={16} />}
              >
                Change
              </Button>
            </div>
          )}
        </div>

        {/* Account Created */}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">Member Since</label>
          <div className="flex items-center gap-2 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
            <Icon name="calendar_today" size={18} className="text-gray-500" />
            <span className="text-gray-300">
              {userProfile?.createdAt
                ? new Date(userProfile.createdAt.toDate()).toLocaleDateString()
                : "Unknown"}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default ProfileSection;
