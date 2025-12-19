"use client";

import React, { useState } from "react";
import { Icon } from "@/components/common";

const faqs = [
  {
    question: "Is FinTrack really free?",
    answer:
      "Yes! FinTrack is completely free to use. There are no hidden fees, premium tiers, or credit card requirements. We believe everyone deserves access to great financial tools.",
  },
  {
    question: "Is my financial data secure?",
    answer:
      "Absolutely. Your data is stored securely in Firebase with enterprise-grade encryption. We never share your information with third parties, and you can delete all your data at any time from the settings page.",
  },
  {
    question: "Do I need to connect my bank account?",
    answer:
      "No! FinTrack works without bank connections. You manually add your income sources and expenses, giving you full control over your financial data. This also means better privacy.",
  },
  {
    question: "How does the AI feature work?",
    answer:
      "FinTrack uses Google's Gemini AI to analyze your financial patterns and provide personalized insights. The AI looks at your income, expenses, savings rate, and cash flow to give you actionable recommendations.",
  },
  {
    question: "Can I track loans and credit cards?",
    answer:
      "Yes! FinTrack supports multiple expense types including cash loans (with amortization schedules), credit cards (with APR and payoff projections), installments, and recurring bills.",
  },
  {
    question: "How do financial projections work?",
    answer:
      "FinTrack automatically generates projected transactions based on your income sources and expense rules. It calculates when each payment will occur using your configured frequency (daily, weekly, monthly, etc.) and creates a day-by-day balance forecast. For loans, it computes full amortization schedules; for credit cards, it projects payoff timelines based on your payment strategy. The system then shows you your expected cash flow and future balance on the calendar and dashboard.",
  },
  {
    question: "What happens to my data if I delete my account?",
    answer:
      "When you delete your account, all your data is permanently removed from our servers. This includes your profile, income sources, expenses, transactions, and any other information you've entered.",
  },
];

export const LandingFAQ: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="relative py-32 overflow-hidden scroll-mt-20 snap-start">
      {/* Background */}
      <div className="absolute inset-0 bg-dark-900" />

      <div className="relative z-10 max-w-4xl mx-auto px-6">
        {/* Section Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-dark-800 border border-white/10 mb-6">
            <Icon name="help" size={18} className="text-primary" />
            <span className="text-sm text-gray-400 font-medium">FAQ</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Frequently Asked{" "}
            <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
              Questions
            </span>
          </h2>
          <p className="text-xl text-gray-400">Everything you need to know about FinTrack.</p>
        </div>

        {/* FAQ Items */}
        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div
              key={index}
              className="rounded-2xl border border-white/5 bg-dark-800/50 overflow-hidden transition-all duration-300 hover:border-white/10"
            >
              <button
                onClick={() => toggleFAQ(index)}
                className="w-full flex items-center justify-between p-6 text-left"
              >
                <span className="text-lg font-medium text-white pr-4">{faq.question}</span>
                <div
                  className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                    openIndex === index
                      ? "bg-primary text-white rotate-180"
                      : "bg-dark-700 text-gray-400"
                  }`}
                >
                  <Icon name="expand_more" size={20} />
                </div>
              </button>
              <div
                className={`overflow-hidden transition-all duration-300 ${
                  openIndex === index ? "max-h-96" : "max-h-0"
                }`}
              >
                <p className="px-6 pb-6 text-gray-400 leading-relaxed">{faq.answer}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
