"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { Icon } from "@/components/common";
import { getAssetPath } from "@/lib/utils/assetPath";

export const LandingFooter: React.FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative py-16 border-t border-white/5 snap-start">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          {/* Logo & Description */}
          <div className="flex flex-col items-center md:items-start gap-4">
            <Link href="/" className="flex items-center gap-3">
              <div className="relative w-10 h-10 rounded-xl overflow-hidden">
                <Image
                  src={getAssetPath("/logo.png")}
                  alt="FinTrack"
                  fill
                  className="object-cover"
                />
              </div>
              <span className="text-xl font-bold text-white">FinTrack</span>
            </Link>
            <p className="text-sm text-gray-500 text-center md:text-left max-w-xs">
              AI-powered personal finance management for a smarter financial future.
            </p>
          </div>

          {/* Links */}
          <div className="flex items-center gap-8">
            <Link
              href="/login"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Login
            </Link>
            <Link
              href="/signup"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Sign Up
            </Link>
            <a
              href="https://github.com/JaphethLG/fintrack"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              <Icon name="code" size={18} />
              GitHub
            </a>
          </div>
        </div>

        {/* Divider */}
        <div className="my-8 border-t border-white/5" />

        {/* Bottom */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <p>© {currentYear} FinTrack. All rights reserved.</p>
          <p className="flex items-center gap-1">
            Built with <Icon name="favorite" size={14} className="text-danger" /> using Next.js &
            Firebase
          </p>
        </div>
      </div>
    </footer>
  );
};
