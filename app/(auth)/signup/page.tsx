"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Button, Input, Alert, LoadingSpinner, Card, Icon } from "@/components/common";
import { getAssetPath } from "@/lib/utils/assetPath";

const getAuthErrorMessage = (error: unknown): string => {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Parse Firebase error codes
  if (errorMessage.includes("auth/email-already-in-use")) {
    return "An account with this email already exists. Please sign in instead.";
  }
  if (errorMessage.includes("auth/invalid-email")) {
    return "Please enter a valid email address.";
  }
  if (errorMessage.includes("auth/weak-password")) {
    return "Password is too weak. Please use at least 6 characters.";
  }
  if (errorMessage.includes("auth/operation-not-allowed")) {
    return "Email/password sign up is not enabled. Please contact support.";
  }

  return errorMessage;
};

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { user, loading: authLoading, signup } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && user) {
      router.push("/dashboard");
    }
  }, [user, authLoading, router]);

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signup(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <Card variant="elevated" padding="lg">
        <div className="flex flex-col items-center justify-center py-10">
          <LoadingSpinner size="md" color="primary" text="Loading..." />
        </div>
      </Card>
    );
  }

  return (
    <Card variant="elevated" padding="lg">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl mx-auto overflow-hidden mb-4 shadow-lg shadow-primary/20">
          <img
            src={getAssetPath("/logo.png")}
            alt="FinTrack"
            className="w-full h-full object-cover"
          />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">Create Your Account</h1>
        <p className="text-gray-400">Sign up to start managing your finances</p>
      </div>

      {error && (
        <div className="mb-6">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {/* Email/Password Form */}
      <form onSubmit={handleSignup} className="space-y-4">
        <Input
          id="email"
          type="email"
          label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="you@example.com"
        />

        <Input
          id="password"
          type="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="••••••••"
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={loading}
          disabled={loading}
        >
          {loading ? "Creating account..." : "Sign Up"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-400">
        Already have an account?{" "}
        <a href="/login" className="text-primary hover:text-primary/80 font-medium">
          Sign in
        </a>
      </p>
    </Card>
  );
}
