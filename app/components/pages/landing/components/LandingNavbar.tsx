"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { Button, Icon } from "@/components/common";

export const LandingNavbar: React.FC = () => {
  const { user, userProfile, loading } = useAuth();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50">
      <div className="absolute inset-0 bg-dark-900/70 backdrop-blur-xl border-b border-white/5" />
      <div className="relative max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative w-10 h-10 rounded-xl overflow-hidden shadow-lg shadow-primary/20 group-hover:shadow-primary/40 transition-shadow">
              <Image src="/logo.png" alt="FinTrack" fill className="object-cover" />
            </div>
            <span className="text-xl font-bold text-white">FinTrack</span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-8">
            <a
              href="#features"
              className="text-gray-400 hover:text-white transition-colors text-sm font-medium"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="text-gray-400 hover:text-white transition-colors text-sm font-medium"
            >
              How It Works
            </a>
          </div>

          {/* Auth Section */}
          <div className="flex items-center gap-3">
            {loading ? (
              <div className="w-8 h-8 rounded-full bg-dark-700 animate-pulse" />
            ) : user ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-dark-800 border border-white/10">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center text-white text-sm font-semibold">
                    {userProfile?.displayName?.charAt(0).toUpperCase() ||
                      user.email?.charAt(0).toUpperCase() ||
                      "U"}
                  </div>
                  <span className="text-sm text-gray-300 font-medium max-w-[120px] truncate">
                    {userProfile?.displayName || user.email?.split("@")[0]}
                  </span>
                </div>
                <Link href="/dashboard">
                  <Button variant="primary" size="sm">
                    <Icon name="dashboard" size={18} className="mr-1.5" />
                    Dashboard
                  </Button>
                </Link>
              </div>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost" size="sm">
                    Log In
                  </Button>
                </Link>
                <Link href="/signup">
                  <Button variant="primary" size="sm">
                    Sign Up Free
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};
