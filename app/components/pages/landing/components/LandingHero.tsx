"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Button, Icon } from "@/components/common";

// Feature highlights instead of fake metrics
const highlights = [
  { icon: "psychology", label: "AI-Powered", color: "text-purple-400" },
  { icon: "lock", label: "Private & Secure", color: "text-success" },
  { icon: "sync", label: "Real-Time Sync", color: "text-primary" },
];

// Mock chart data for visualization
const chartBars = [35, 52, 48, 65, 58, 72, 85, 78, 92, 88, 95, 100];

export const LandingHero: React.FC = () => {
  const { user } = useAuth();

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20 snap-start">
      {/* Animated Background */}
      <div className="absolute inset-0 bg-dark-900">
        {/* Gradient orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-pulse" />
        <div
          className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-500/15 rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: "1s" }}
        />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-primary/10 to-transparent rounded-full blur-3xl" />

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      {/* Dashboard Preview - Chart Mockup */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Main chart card - positioned to the right */}
        <div
          className="absolute top-32 right-[5%] lg:right-[10%] w-80 lg:w-96 bg-dark-800/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl shadow-black/50 animate-float hidden md:block"
          style={{ animationDuration: "8s" }}
        >
          <div className="p-5">
            {/* Card header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-success/20 flex items-center justify-center">
                  <Icon name="trending_up" size={18} className="text-success" />
                </div>
                <span className="text-sm font-medium text-white">Cash Flow</span>
              </div>
              <span className="text-xs text-success font-medium">+12.5%</span>
            </div>

            {/* Mini chart bars */}
            <div className="flex items-end gap-1.5 h-24 mb-3">
              {chartBars.map((height, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t transition-all duration-500"
                  style={{
                    height: `${height}%`,
                    background:
                      i >= 8
                        ? "linear-gradient(to top, #135bec, #3b82f6)"
                        : "rgba(255,255,255,0.1)",
                  }}
                />
              ))}
            </div>

            {/* Chart labels */}
            <div className="flex justify-between text-xs text-gray-500">
              <span>Jan</span>
              <span>Jun</span>
              <span>Dec</span>
            </div>
          </div>
        </div>

        {/* Balance card - left side */}
        <div
          className="absolute top-48 left-[5%] lg:left-[8%] w-52 bg-dark-800/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl animate-float hidden lg:block"
          style={{ animationDuration: "7s", animationDelay: "0.5s" }}
        >
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-lg bg-primary/20 flex items-center justify-center">
                <Icon name="account_balance" size={14} className="text-primary" />
              </div>
              <span className="text-xs text-gray-400">Total Balance</span>
            </div>
            <div className="text-2xl font-bold text-white">$24,580</div>
            <div className="text-xs text-success mt-1 flex items-center gap-1">
              <Icon name="arrow_upward" size={12} />
              +$2,340 this month
            </div>
          </div>
        </div>

        {/* AI Insight card - bottom left */}
        <div
          className="absolute bottom-36 left-[10%] w-56 bg-dark-800/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl animate-float hidden md:block"
          style={{ animationDuration: "9s", animationDelay: "1.5s" }}
        >
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Icon name="auto_awesome" size={14} className="text-purple-400" />
              </div>
              <span className="text-xs text-gray-400">AI Insight</span>
            </div>
            <p className="text-sm text-white leading-relaxed">
              "You could save $340/mo by optimizing subscriptions"
            </p>
          </div>
        </div>

        {/* Health score card - bottom right */}
        <div
          className="absolute bottom-40 right-[8%] w-44 bg-dark-800/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl animate-float hidden lg:block"
          style={{ animationDuration: "6s", animationDelay: "2s" }}
        >
          <div className="p-4 text-center">
            <div className="text-xs text-gray-400 mb-2">Financial Health</div>
            <div className="text-4xl font-bold text-success mb-1">A</div>
            <div className="text-xs text-gray-500">Excellent</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-8">
          <Icon name="auto_awesome" size={18} className="text-primary" />
          <span className="text-sm text-primary font-medium">Powered by Google Gemini AI</span>
        </div>

        {/* Main headline */}
        <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
          Take Control of Your{" "}
          <span className="relative">
            <span className="relative z-10 bg-gradient-to-r from-primary via-blue-400 to-cyan-400 bg-clip-text text-transparent">
              Financial Future
            </span>
            <span className="absolute bottom-2 left-0 right-0 h-3 bg-primary/20 -z-10 rounded" />
          </span>
        </h1>

        {/* Subheadline */}
        <p className="text-xl md:text-2xl text-gray-400 mb-10 max-w-3xl mx-auto leading-relaxed">
          AI-powered personal finance management with intelligent insights, flexible scheduling, and
          real-time cash flow projections.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <Link href={user ? "/dashboard" : "/signup"}>
            <Button
              variant="primary"
              size="lg"
              className="px-8 py-4 text-lg shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-shadow"
            >
              <Icon name="rocket_launch" size={22} className="mr-2" />
              Get Started Free
            </Button>
          </Link>
          <a href="#features">
            <Button variant="secondary" size="lg" className="px-8 py-4 text-lg">
              <Icon name="play_circle" size={22} className="mr-2" />
              See How It Works
            </Button>
          </a>
        </div>

        {/* Feature highlights instead of fake stats */}
        <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10">
          {highlights.map((item, index) => (
            <div key={index} className="flex items-center gap-2 text-gray-400">
              <Icon name={item.icon} size={20} className={item.color} />
              <span className="text-sm font-medium">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Scroll</span>
        <Icon name="keyboard_arrow_down" size={24} className="text-gray-500" />
      </div>

      {/* CSS for floating animation */}
      <style jsx>{`
        @keyframes float {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-15px);
          }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
      `}</style>
    </section>
  );
};
