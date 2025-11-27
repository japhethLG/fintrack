"use client";

import React from "react";
import { PageHeader, LoadingSpinner } from "@/components/common";
import { useAuth } from "@/contexts/AuthContext";
import ProfileSection from "./components/ProfileSection";
import PreferencesSection from "./components/PreferencesSection";
import BalanceSection from "./components/BalanceSection";
import DangerZone from "./components/DangerZone";

const Settings: React.FC = () => {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="p-6 lg:p-10 flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" text="Loading settings..." />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-4xl mx-auto animate-fade-in">
      <PageHeader title="Settings" description="Manage your account settings and preferences" />

      <div className="space-y-6">
        {/* Profile Section */}
        <ProfileSection />

        {/* Balance Section */}
        <BalanceSection />

        {/* Preferences Section */}
        <PreferencesSection />

        {/* Danger Zone */}
        <DangerZone />
      </div>
    </div>
  );
};

export default Settings;
