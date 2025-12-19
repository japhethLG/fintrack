"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Button, Icon, AnimatedElement } from "@/components/common";

const steps = [
  {
    number: "01",
    icon: "person_add",
    title: "Create Your Account",
    description: "Sign up for free in seconds. No credit card required.",
  },
  {
    number: "02",
    icon: "account_balance_wallet",
    title: "Set Up Your Finances",
    description: "Add your income sources, expenses, loans, and credit cards.",
  },
  {
    number: "03",
    icon: "calendar_month",
    title: "Track & Project",
    description: "View your financial calendar with daily balance projections.",
  },
  {
    number: "04",
    icon: "psychology",
    title: "Get AI Insights",
    description: "Receive personalized recommendations powered by Google Gemini.",
  },
];

export const LandingHowItWorks: React.FC = () => {
  const { user } = useAuth();

  return (
    <section id="how-it-works" className="relative py-32 overflow-hidden scroll-mt-20">
      {/* Background */}
      <div className="absolute inset-0 bg-dark-800">
        <div className="absolute bottom-0 left-0 w-[600px] h-[300px] bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6">
        {/* Section Header */}
        <AnimatedElement animation="fade-up" className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-dark-700 border border-white/10 mb-6">
            <Icon name="route" size={18} className="text-primary" />
            <span className="text-sm text-gray-400 font-medium">Simple Process</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Get Started in{" "}
            <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
              4 Easy Steps
            </span>
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Start managing your finances like a pro in just minutes.
          </p>
        </AnimatedElement>

        {/* Steps */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
          {steps.map((step, index) => (
            <AnimatedElement
              key={index}
              animation={index % 2 === 0 ? "fade-up" : "fade-down"}
              delay={index * 150}
              className="relative group"
            >
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-12 left-[60%] w-full h-[2px] bg-gradient-to-r from-primary/30 to-transparent" />
              )}

              <div className="relative p-6 rounded-2xl bg-dark-900/50 border border-white/5 hover:border-primary/30 transition-all duration-300">
                {/* Step number */}
                <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white shadow-lg shadow-primary/30">
                  {step.number}
                </div>

                {/* Icon */}
                <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-5 group-hover:bg-primary/20 transition-colors">
                  <Icon name={step.icon} size={28} className="text-primary" />
                </div>

                {/* Content */}
                <h3 className="text-lg font-semibold text-white mb-2">{step.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{step.description}</p>
              </div>
            </AnimatedElement>
          ))}
        </div>

        {/* CTA */}
        <AnimatedElement animation="zoom-in" delay={600} className="text-center">
          <Link href={user ? "/dashboard" : "/signup"}>
            <Button
              variant="primary"
              size="lg"
              className="px-10 py-4 text-lg shadow-lg shadow-primary/25"
            >
              <Icon name="rocket_launch" size={22} className="mr-2" />
              Start Your Free Account
            </Button>
          </Link>
          <p className="mt-4 text-sm text-gray-500">No credit card required</p>
        </AnimatedElement>
      </div>
    </section>
  );
};
