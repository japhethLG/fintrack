"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface ScrollAnimationOptions {
  /** Threshold for intersection (0-1) */
  threshold?: number;
  /** Root margin for earlier/later trigger */
  rootMargin?: string;
  /** Only trigger animation once */
  triggerOnce?: boolean;
  /** Delay before animation starts (ms) */
  delay?: number;
}

export interface ScrollAnimationResult {
  ref: React.RefObject<HTMLDivElement | null>;
  isInView: boolean;
  hasAnimated: boolean;
}

/**
 * Custom hook for scroll-triggered animations using Intersection Observer
 */
export function useScrollAnimation(options: ScrollAnimationOptions = {}): ScrollAnimationResult {
  const {
    threshold = 0.1,
    rootMargin = "0px 0px -50px 0px",
    triggerOnce = true,
    delay = 0,
  } = options;

  const ref = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);

  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          if (delay > 0) {
            setTimeout(() => {
              setIsInView(true);
              setHasAnimated(true);
            }, delay);
          } else {
            setIsInView(true);
            setHasAnimated(true);
          }
        } else if (!triggerOnce) {
          setIsInView(false);
        }
      });
    },
    [delay, triggerOnce]
  );

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(handleIntersection, {
      threshold,
      rootMargin,
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [handleIntersection, threshold, rootMargin]);

  return { ref, isInView, hasAnimated };
}

export default useScrollAnimation;
