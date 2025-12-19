"use client";

import React from "react";
import { useScrollAnimation, ScrollAnimationOptions } from "@/lib/hooks/useScrollAnimation";

export type AnimationType =
  | "fade"
  | "fade-up"
  | "fade-down"
  | "fade-left"
  | "fade-right"
  | "flip-up"
  | "flip-down"
  | "zoom-in"
  | "bounce"
  | "slide-up"
  | "slide-down"
  | "slide-left"
  | "slide-right";

export type AnimationDuration = "faster" | "fast" | "normal" | "slow" | "slower";
export type AnimationEase = "linear" | "in" | "out" | "in-out";

interface AnimatedElementProps extends ScrollAnimationOptions {
  children: React.ReactNode;
  animation?: AnimationType;
  duration?: AnimationDuration;
  ease?: AnimationEase;
  className?: string;
}

// Map animation types to tailwindcss-animated classes
const animationClasses: Record<AnimationType, string> = {
  fade: "animate-fade",
  "fade-up": "animate-fade-up",
  "fade-down": "animate-fade-down",
  "fade-left": "animate-fade-left",
  "fade-right": "animate-fade-right",
  "flip-up": "animate-flip-up",
  "flip-down": "animate-flip-down",
  "zoom-in": "animate-jump-in",
  bounce: "animate-bounce",
  "slide-up": "animate-fade-up",
  "slide-down": "animate-fade-down",
  "slide-left": "animate-fade-left",
  "slide-right": "animate-fade-right",
};

const durationClasses: Record<AnimationDuration, string> = {
  faster: "animate-duration-300",
  fast: "animate-duration-500",
  normal: "animate-duration-700",
  slow: "animate-duration-1000",
  slower: "animate-duration-[1500ms]",
};

const easeClasses: Record<AnimationEase, string> = {
  linear: "animate-ease-linear",
  in: "animate-ease-in",
  out: "animate-ease-out",
  "in-out": "animate-ease-in-out",
};

/**
 * Wrapper component that animates children when they enter the viewport
 */
export const AnimatedElement: React.FC<AnimatedElementProps> = ({
  children,
  animation = "fade-up",
  duration = "normal",
  ease = "out",
  className = "",
  ...scrollOptions
}) => {
  const { ref, isInView } = useScrollAnimation(scrollOptions);

  const animationClass = animationClasses[animation];
  const durationClass = durationClasses[duration];
  const easeClass = easeClasses[ease];

  return (
    <div
      ref={ref}
      className={`${className} ${isInView ? `${animationClass} ${durationClass} ${easeClass} animate-fill-both` : "opacity-0"}`.trim()}
    >
      {children}
    </div>
  );
};

export default AnimatedElement;
