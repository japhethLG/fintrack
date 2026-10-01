"use client";

import { useEffect, useState } from "react";

/**
 * Whether a CSS media query currently matches. `false` on the server and on the first client render
 * (so a static export hydrates cleanly), then follows the viewport.
 */
export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);

  return matches;
};

export default useMediaQuery;
