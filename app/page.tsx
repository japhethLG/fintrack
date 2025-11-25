"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { LoadingSpinner } from "@/components/common";

export default function Page() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.push("/dashboard");
      } else {
        router.push("/login");
      }
    }
  }, [user, loading, router]);

  // Show loading state while checking auth
  return (
    <div className="flex h-screen items-center justify-center bg-[#101622]">
      <LoadingSpinner size="md" color="primary" text="Loading..." />
    </div>
  );
}
