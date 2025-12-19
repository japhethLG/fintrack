"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";

export interface AvatarProps {
  /** Display name to extract initial from */
  name?: string | null;
  /** Email to use as fallback for initial */
  email?: string | null;
  /** Size of the avatar */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Additional class names */
  className?: string;
}

const sizeClasses = {
  xs: "w-5 h-5 text-xs",
  sm: "w-7 h-7 text-sm",
  md: "w-10 h-10 text-base",
  lg: "w-12 h-12 text-lg",
  xl: "w-16 h-16 text-xl",
};

/**
 * Avatar component that displays a user's initial on a gradient background.
 * Falls back to "U" if no name or email is provided.
 */
export const Avatar: React.FC<AvatarProps> = ({ name, email, size = "sm", className }) => {
  const initial = name?.charAt(0).toUpperCase() || email?.charAt(0).toUpperCase() || "U";

  return (
    <div
      className={cn(
        "rounded-full bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center text-white font-semibold shrink-0",
        sizeClasses[size],
        className
      )}
    >
      {initial}
    </div>
  );
};

export default Avatar;
