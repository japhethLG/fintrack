"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { Button, Icon, Avatar } from "@/components/common";
import { getAssetPath } from "@/lib/utils/assetPath";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#faq", label: "FAQ" },
];

export const LandingNavbar: React.FC = () => {
  const { user, userProfile, loading, logout } = useAuth();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setIsDropdownOpen(false);
    await logout();
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50">
      <div className="absolute inset-0 bg-dark-900/70 backdrop-blur-xl border-b border-white/5" />
      <div className="relative max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative w-10 h-10 rounded-xl overflow-hidden shadow-lg shadow-primary/20 group-hover:shadow-primary/40 transition-shadow">
              <Image src={getAssetPath("/logo.png")} alt="FinTrack" fill className="object-cover" />
            </div>
            <span className="text-xl font-bold text-white">FinTrack</span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-gray-400 hover:text-white transition-colors text-sm font-medium relative group cursor-pointer"
              >
                {link.label}
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-primary transition-all duration-300 group-hover:w-full" />
              </a>
            ))}
          </div>

          {/* Auth Section */}
          <div className="flex items-center gap-3">
            {loading ? (
              <div className="w-8 h-8 rounded-full bg-dark-700 animate-pulse" />
            ) : user ? (
              <div className="flex items-center gap-3">
                {/* User Profile Dropdown */}
                <div className="relative" ref={dropdownRef}>
                  <Button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    startIcon={
                      <Avatar name={userProfile?.displayName} email={user.email} size="sm" />
                    }
                    variant="ghost"
                    className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-full bg-dark-800 border border-white/10 hover:border-white/20 hover:bg-dark-700"
                  >
                    <span className="text-sm text-gray-300 font-medium max-w-[120px] truncate">
                      {userProfile?.displayName || user.email?.split("@")[0]}
                    </span>
                    <Icon
                      name="expand_more"
                      size={18}
                      className={`text-gray-400 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
                    />
                  </Button>

                  {/* Dropdown Menu */}
                  {isDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-48 py-2 bg-dark-800 border border-white/10 rounded-xl shadow-xl shadow-black/50 animate-in fade-in slide-in-from-top-2 duration-200">
                      {/* Dashboard - only visible in dropdown on mobile */}
                      <Link
                        href="/dashboard"
                        onClick={() => setIsDropdownOpen(false)}
                        className="sm:hidden flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-dark-700 transition-colors"
                      >
                        <Icon name="dashboard" size={18} className="text-gray-400" />
                        Dashboard
                      </Link>
                      <Link
                        href="/settings"
                        onClick={() => setIsDropdownOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-dark-700 transition-colors"
                      >
                        <Icon name="settings" size={18} className="text-gray-400" />
                        Settings
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-dark-700 transition-colors"
                      >
                        <Icon name="logout" size={18} className="text-gray-400" />
                        Logout
                      </button>
                    </div>
                  )}
                </div>

                {/* Dashboard button - hidden on mobile, visible on desktop */}
                <Link href="/dashboard" className="hidden sm:block">
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
