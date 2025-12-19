"use client";

import React, { useState, useCallback, useEffect } from "react";
import Image from "next/image";
import { Icon } from "@/components/common";

interface TourSlide {
  id: string;
  title: string;
  description: string;
  imageSrc: string;
  gradient: string;
  icon: string;
}

const tourSlides: TourSlide[] = [
  {
    id: "dashboard",
    title: "Smart Dashboard",
    description:
      "Get a complete overview of your finances with real-time cash flow projections, financial health scores, and spending insights.",
    imageSrc: "/tour/dashboard.png",
    gradient: "from-primary to-cyan-400",
    icon: "dashboard",
  },
  {
    id: "income",
    title: "Income Management",
    description:
      "Track multiple income sources with flexible pay schedules - salary, freelance, semi-monthly, bi-weekly, and more.",
    imageSrc: "/tour/income.png",
    gradient: "from-success to-emerald-400",
    icon: "payments",
  },
  {
    id: "expenses",
    title: "Expense Tracking",
    description:
      "Organize recurring expenses by category with priority flags for essential bills. Never miss a payment again.",
    imageSrc: "/tour/expenses.png",
    gradient: "from-warning to-orange-400",
    icon: "receipt_long",
  },
  {
    id: "calendar",
    title: "Financial Calendar",
    description:
      "Visualize your cash flow with an interactive calendar showing daily balances, income, and expenses at a glance.",
    imageSrc: "/tour/calendar.png",
    gradient: "from-cyan-500 to-teal-400",
    icon: "calendar_month",
  },
  {
    id: "ai-forecast",
    title: "AI Financial Advisor",
    description:
      "Get personalized insights and recommendations powered by Google Gemini AI to optimize your spending and savings.",
    imageSrc: "/tour/ai-forecast.png",
    gradient: "from-purple-500 to-pink-500",
    icon: "psychology",
  },
];

export const LandingProductTour: React.FC = () => {
  const [activeSlide, setActiveSlide] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  const handlePrevious = useCallback(() => {
    setIsAutoPlaying(false);
    setActiveSlide((prev) => (prev === 0 ? tourSlides.length - 1 : prev - 1));
  }, []);

  const handleNext = useCallback(() => {
    setIsAutoPlaying(false);
    setActiveSlide((prev) => (prev === tourSlides.length - 1 ? 0 : prev + 1));
  }, []);

  const handleSlideClick = useCallback((index: number) => {
    setIsAutoPlaying(false);
    setActiveSlide(index);
  }, []);

  // Auto-advance slides
  useEffect(() => {
    if (!isAutoPlaying) return;

    const interval = setInterval(() => {
      setActiveSlide((prev) => (prev === tourSlides.length - 1 ? 0 : prev + 1));
    }, 5000);

    return () => clearInterval(interval);
  }, [isAutoPlaying]);

  const currentSlide = tourSlides[activeSlide];

  return (
    <section id="product-tour" className="relative py-24 overflow-hidden scroll-mt-20">
      {/* Background */}
      <div className="absolute inset-0 bg-dark-800">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1200px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-6">
        {/* Section Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-dark-700 border border-white/10 mb-6">
            <Icon name="play_circle" size={18} className="text-primary" />
            <span className="text-sm text-gray-400 font-medium">Product Tour</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
            See FinTrack{" "}
            <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
              In Action
            </span>
          </h2>
          <p className="text-lg text-gray-400 max-w-xl mx-auto">
            Explore the powerful features that help you manage finances smarter.
          </p>
        </div>

        {/* Main Content - Centered Layout */}
        <div className="relative group">
          {/* Browser Frame */}
          <div className="relative rounded-2xl overflow-hidden bg-dark-900 border border-white/10 shadow-2xl shadow-black/50 max-w-4xl mx-auto">
            {/* Browser Top Bar */}
            <div className="flex items-center gap-2 px-4 py-3 bg-dark-800 border-b border-white/5">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-danger/80" />
                <div className="w-3 h-3 rounded-full bg-warning/80" />
                <div className="w-3 h-3 rounded-full bg-success/80" />
              </div>
              <div className="flex-1 mx-4">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-700 text-xs text-gray-400 max-w-xs mx-auto">
                  <Icon name="lock" size={12} className="text-success" />
                  <span>app.fintrack.ai/{currentSlide.id}</span>
                </div>
              </div>
              {/* Auto-play indicator */}
              <button
                onClick={() => setIsAutoPlaying(!isAutoPlaying)}
                className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-primary transition-colors"
                title={isAutoPlaying ? "Pause auto-play" : "Resume auto-play"}
              >
                <Icon name={isAutoPlaying ? "pause" : "play_arrow"} size={16} />
              </button>
            </div>

            {/* Image Container */}
            <div className="relative aspect-[16/9] bg-dark-900">
              <Image
                src={currentSlide.imageSrc}
                alt={currentSlide.title}
                fill
                className="object-cover object-top transition-all duration-500"
                priority
              />
            </div>
          </div>

          {/* Navigation Arrows */}
          <button
            onClick={handlePrevious}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-12 h-12 rounded-full bg-dark-800/90 border border-white/10 flex items-center justify-center text-white hover:bg-dark-700 hover:border-primary/50 transition-all opacity-0 group-hover:opacity-100 shadow-xl"
            aria-label="Previous slide"
          >
            <Icon name="chevron_left" size={28} />
          </button>
          <button
            onClick={handleNext}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-12 h-12 rounded-full bg-dark-800/90 border border-white/10 flex items-center justify-center text-white hover:bg-dark-700 hover:border-primary/50 transition-all opacity-0 group-hover:opacity-100 shadow-xl"
            aria-label="Next slide"
          >
            <Icon name="chevron_right" size={28} />
          </button>
        </div>

        {/* Horizontal Icon Navigation */}
        <div className="mt-8 max-w-3xl mx-auto">
          <div className="flex justify-center gap-3">
            {tourSlides.map((slide, index) => (
              <button
                key={slide.id}
                onClick={() => handleSlideClick(index)}
                className={`group/tab relative flex flex-col items-center gap-2 p-3 rounded-xl transition-all duration-300 ${
                  activeSlide === index
                    ? "bg-dark-700 border border-primary/30"
                    : "bg-dark-900/50 border border-transparent hover:border-white/10"
                }`}
              >
                {/* Icon */}
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 ${
                    activeSlide === index
                      ? `bg-gradient-to-br ${slide.gradient} shadow-lg`
                      : "bg-dark-700 group-hover/tab:bg-dark-600"
                  }`}
                >
                  <Icon
                    name={slide.icon}
                    size={22}
                    className={activeSlide === index ? "text-white" : "text-gray-400"}
                  />
                </div>

                {/* Label - Only show on active or hover */}
                <span
                  className={`text-xs font-medium whitespace-nowrap transition-all duration-300 ${
                    activeSlide === index
                      ? "text-white opacity-100"
                      : "text-gray-500 opacity-0 group-hover/tab:opacity-100"
                  }`}
                >
                  {slide.title.split(" ")[0]}
                </span>

                {/* Active indicator line */}
                {activeSlide === index && (
                  <div
                    className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-gradient-to-r ${slide.gradient}`}
                  />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Active Slide Info */}
        <div className="mt-8 text-center max-w-2xl mx-auto">
          <h3
            className={`text-2xl font-bold text-white mb-3 bg-gradient-to-r ${currentSlide.gradient} bg-clip-text text-transparent`}
          >
            {currentSlide.title}
          </h3>
          <p className="text-gray-400 leading-relaxed">{currentSlide.description}</p>
        </div>

        {/* Progress Dots */}
        <div className="flex justify-center gap-2 mt-6">
          {tourSlides.map((_, index) => (
            <button
              key={index}
              onClick={() => handleSlideClick(index)}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                activeSlide === index ? "w-8 bg-primary" : "w-1.5 bg-dark-600 hover:bg-dark-500"
              }`}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
};
