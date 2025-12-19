"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Button, Input, Alert, LoadingSpinner, Divider } from "@/components/common";
import { getAssetPath } from "@/lib/utils/assetPath";
import Link from "next/link";

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
  const { user, loading: authLoading, signup, loginWithGoogle } = useAuth();
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

  const handleGoogleSignup = async () => {
    setError("");
    setLoading(true);

    try {
      await loginWithGoogle();
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign up with Google.");
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="bg-dark-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-8 shadow-2xl">
        <div className="flex flex-col items-center justify-center py-10">
          <LoadingSpinner size="md" color="primary" text="Loading..." />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-dark-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-8 shadow-2xl shadow-black/50">
      {/* Header */}
      <div className="text-center mb-8">
        <Link href="/" className="inline-block">
          <div className="w-16 h-16 rounded-2xl mx-auto overflow-hidden mb-4 shadow-lg shadow-primary/30 hover:shadow-primary/50 transition-shadow">
            <img
              src={getAssetPath("/logo.png")}
              alt="FinTrack"
              className="w-full h-full object-cover"
            />
          </div>
        </Link>
        <h1 className="text-3xl font-bold mb-2">
          <span className="bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
            Create Account
          </span>
        </h1>
        <p className="text-gray-400">Start managing your finances today</p>
      </div>

      {error && (
        <div className="mb-6">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {/* Google Sign-Up Button */}
      <button
        onClick={handleGoogleSignup}
        disabled={loading}
        className="w-full mb-6 flex items-center justify-center gap-3 px-4 py-3.5 bg-white text-gray-900 rounded-xl font-semibold hover:bg-gray-100 hover:shadow-lg hover:shadow-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        Sign up with Google
      </button>

      <Divider text="Or continue with email" className="mb-6" />

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
          className="shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-shadow"
        >
          {loading ? "Creating account..." : "Sign Up"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-400">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-primary hover:text-primary/80 font-medium transition-colors"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
