"use client";

import React, { useState, useRef, ChangeEvent } from "react";
import { Icon } from "@/components/common";
import { uploadToImageBB } from "@/lib/services/imageBBService";
import { cn } from "@/lib/utils/cn";

export interface ProfilePictureUploadProps {
  /** Current profile picture URL */
  currentImageUrl?: string;
  /** User's display name for alt text */
  displayName?: string;
  /** Callback when image is successfully uploaded */
  onUploadComplete: (imageUrl: string) => Promise<void>;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Additional CSS classes */
  className?: string;
}

const SIZE_CONFIGS = {
  sm: {
    container: "w-16 h-16",
    icon: 32,
    uploadIcon: 14,
  },
  md: {
    container: "w-24 h-24",
    icon: 48,
    uploadIcon: 18,
  },
  lg: {
    container: "w-32 h-32",
    icon: 64,
    uploadIcon: 20,
  },
};

export const ProfilePictureUpload: React.FC<ProfilePictureUploadProps> = ({
  currentImageUrl,
  displayName = "User",
  onUploadComplete,
  size = "lg",
  className = "",
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(currentImageUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sizeConfig = SIZE_CONFIGS[size];

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Clear previous error
    setError(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload to ImageBB
    handleUpload(file);
  };

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setError(null);

    try {
      // Upload to ImageBB
      const imageUrl = await uploadToImageBB(file);

      // Call parent callback
      await onUploadComplete(imageUrl);

      // Update preview with final URL
      setPreviewUrl(imageUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      // Revert preview to original
      setPreviewUrl(currentImageUrl);
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={cn("flex flex-col items-center", className)}>
      {/* Avatar Container */}
      <div className="relative">
        <button
          type="button"
          onClick={handleClick}
          disabled={isUploading}
          className={cn(
            sizeConfig.container,
            "relative rounded-full overflow-hidden",
            "ring-2 ring-gray-700 hover:ring-primary transition-all duration-200",
            "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-gray-900",
            isUploading && "opacity-50 cursor-not-allowed",
            !isUploading && "cursor-pointer group"
          )}
          aria-label="Upload profile picture"
        >
          {/* Image or Default Icon */}
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={`${displayName}'s profile picture`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gray-800 flex items-center justify-center">
              <Icon name="person" size={sizeConfig.icon} className="text-gray-500" />
            </div>
          )}

          {/* Upload Overlay */}
          {!isUploading && (
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
              <div className="text-center">
                <Icon
                  name="photo_camera"
                  size={sizeConfig.uploadIcon}
                  className="text-white mb-1"
                />
                <p className="text-xs text-white font-medium">Upload</p>
              </div>
            </div>
          )}

          {/* Loading Spinner */}
          {isUploading && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
              <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </button>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        onChange={handleFileSelect}
        className="hidden"
        disabled={isUploading}
      />

      {/* Upload Instructions */}
      {!error && (
        <p className="text-xs text-gray-400 mt-2 text-center max-w-[200px]">
          {isUploading ? "Uploading..." : "Click to upload or change"}
        </p>
      )}

      {/* Error Message */}
      {error && (
        <div className="mt-2 px-3 py-1.5 bg-danger/20 border border-danger/30 rounded-lg">
          <p className="text-xs text-danger text-center">{error}</p>
        </div>
      )}
    </div>
  );
};
