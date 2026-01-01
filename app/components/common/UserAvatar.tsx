"use client";

import React from "react";
import { Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";

export interface UserAvatarProps {
  /** Profile picture URL (from ImageBB) */
  imageUrl?: string | null;
  /** Display name to extract initial from */
  name?: string | null;
  /** Email to use as fallback for initial */
  email?: string | null;
  /** Size of the avatar */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Additional class names */
  className?: string;
  /** Show online indicator */
  showOnline?: boolean;
}

const sizeClasses = {
  xs: "w-5 h-5 text-xs",
  sm: "w-7 h-7 text-sm",
  md: "w-10 h-10 text-base",
  lg: "w-12 h-12 text-lg",
  xl: "w-16 h-16 text-xl",
};

const iconSizes = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
};

/**
 * UserAvatar component that displays user's profile picture or initials
 * Falls back to person icon if no image or initials available
 */
export const UserAvatar: React.FC<UserAvatarProps> = ({
  imageUrl,
  name,
  email,
  size = "md",
  className,
  showOnline = false,
}) => {
  // If user has a profile picture, show it
  if (imageUrl) {
    return (
      <div className={cn("relative shrink-0", className)}>
        <img
          src={imageUrl}
          alt={name || "User"}
          className={cn("rounded-full object-cover border-2 border-gray-700", sizeClasses[size])}
        />
        {showOnline && (
          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-success rounded-full border-2 border-gray-900" />
        )}
      </div>
    );
  }

  // Fall back to initials if name or email exists
  const initial = name?.charAt(0).toUpperCase() || email?.charAt(0).toUpperCase();

  if (initial) {
    return (
      <div className={cn("relative shrink-0", className)}>
        <div
          className={cn(
            "rounded-full bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center text-white font-semibold border-2 border-gray-700",
            sizeClasses[size]
          )}
        >
          {initial}
        </div>
        {showOnline && (
          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-success rounded-full border-2 border-gray-900" />
        )}
      </div>
    );
  }

  // Final fallback to person icon
  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "rounded-full bg-gray-800 flex items-center justify-center text-gray-500 border-2 border-gray-700",
          sizeClasses[size]
        )}
      >
        <Icon name="person" size={iconSizes[size]} />
      </div>
      {showOnline && (
        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-success rounded-full border-2 border-gray-900" />
      )}
    </div>
  );
};

export default UserAvatar;
