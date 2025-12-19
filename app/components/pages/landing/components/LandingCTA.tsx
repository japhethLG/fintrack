"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Button, Icon } from "@/components/common";

export const LandingCTA: React.FC = () => {
  const { user } = useAuth();

  return (
    <section className="relative py-24 overflow-hidden">
      {/* Background with gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-dark-800 to-dark-900" />
      <div className="absolute inset-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-primary/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
        <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
          Ready to Take Control of Your{" "}
          <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
            Financial Future?
          </span>
        </h2>
        <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
          Join thousands of users who are already managing their money smarter with AI-powered
          insights.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href={user ? "/dashboard" : "/signup"}>
            <Button
              variant="primary"
              size="lg"
              className="px-10 py-4 text-lg shadow-lg shadow-primary/30 hover:shadow-primary/50 transition-shadow"
            >
              <Icon name="rocket_launch" size={22} className="mr-2" />
              Get Started Free
            </Button>
          </Link>
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <span className="flex items-center gap-1.5">
              <Icon name="check_circle" size={18} className="text-success" />
              Start for free
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="check_circle" size={18} className="text-success" />
              No credit card
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
