"use client";

import React from "react";
import { Icon } from "@/components/common";

const features = [
  {
    icon: "psychology",
    title: "AI-Powered Insights",
    description:
      "Get personalized financial advice and spending pattern analysis powered by Google Gemini AI.",
    gradient: "from-purple-500 to-pink-500",
  },
  {
    icon: "account_balance_wallet",
    title: "Income & Expense Tracking",
    description:
      "Flexible scheduling for salary, freelance, loans, credit cards, and recurring bills.",
    gradient: "from-primary to-blue-400",
  },
  {
    icon: "calendar_month",
    title: "Financial Calendar",
    description:
      "Interactive month view with color-coded transactions and daily balance indicators.",
    gradient: "from-cyan-500 to-teal-400",
  },
  {
    icon: "credit_card",
    title: "Credit Card Payoff",
    description:
      "Compare payment strategies, see payoff timelines, and calculate interest savings.",
    gradient: "from-orange-500 to-amber-400",
  },
  {
    icon: "monitor_heart",
    title: "Financial Health Score",
    description:
      "Track your financial wellness with A-F grades based on cash runway, savings rate, and more.",
    gradient: "from-success to-emerald-400",
  },
  {
    icon: "trending_up",
    title: "Real-Time Projections",
    description:
      "See your financial future with 30-day cash flow forecasting and balance predictions.",
    gradient: "from-blue-500 to-indigo-500",
  },
];

export const LandingFeatures: React.FC = () => {
  return (
    <section id="features" className="relative py-32 overflow-hidden scroll-mt-20 snap-start">
      {/* Background */}
      <div className="absolute inset-0 bg-dark-900">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6">
        {/* Section Header */}
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-dark-800 border border-white/10 mb-6">
            <Icon name="star" size={18} className="text-warning" />
            <span className="text-sm text-gray-400 font-medium">Powerful Features</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Everything You Need to{" "}
            <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
              Master Your Money
            </span>
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Comprehensive tools for tracking, analyzing, and optimizing your personal finances.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <div
              key={index}
              className="group relative p-6 rounded-2xl bg-dark-800/50 border border-white/5 hover:border-white/10 transition-all duration-300 hover:-translate-y-1"
            >
              {/* Gradient glow on hover */}
              <div
                className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`}
              />

              <div className="relative">
                {/* Icon */}
                <div
                  className={`w-14 h-14 rounded-xl bg-gradient-to-br ${feature.gradient} p-[1px] mb-5`}
                >
                  <div className="w-full h-full rounded-xl bg-dark-800 flex items-center justify-center">
                    <Icon name={feature.icon} size={28} className="text-white" />
                  </div>
                </div>

                {/* Content */}
                <h3 className="text-xl font-semibold text-white mb-3 group-hover:text-primary transition-colors">
                  {feature.title}
                </h3>
                <p className="text-gray-400 leading-relaxed">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
