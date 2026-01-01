/**
 * ImageBB Upload Service
 * Handles image uploads to ImageBB for profile pictures
 */

const IMGBB_API_URL = "https://api.imgbb.com/1/upload";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_FILE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

export interface ImageBBResponse {
  data: {
    url: string;
    display_url: string;
    delete_url: string;
  };
  success: boolean;
  status: number;
}

export interface UploadError {
  message: string;
  code?: string;
}

/**
 * Convert file to base64 string
 */
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data:image/xxx;base64, prefix
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

/**
 * Validate image file before upload
 */
export const validateImageFile = (file: File): { valid: boolean; error?: string } => {
  // Check file type
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: "Invalid file type. Please upload a JPEG, PNG, or WebP image.",
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds 5MB. Please upload a smaller image.`,
    };
  }

  return { valid: true };
};

/**
 * Upload image to ImageBB
 * @param file - Image file to upload
 * @returns Promise with the hosted image URL
 * @throws Error if upload fails
 */
export const uploadToImageBB = async (file: File): Promise<string> => {
  // Validate file
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Get API key from environment
  const apiKey = process.env.NEXT_PUBLIC_IMAGE_BB_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ImageBB API key is not configured. Please add NEXT_PUBLIC_IMAGE_BB_API_KEY to your environment variables."
    );
  }

  try {
    // Convert file to base64
    const base64Image = await fileToBase64(file);

    // Create form data
    const formData = new FormData();
    formData.append("key", apiKey);
    formData.append("image", base64Image);

    // Upload to ImageBB
    const response = await fetch(IMGBB_API_URL, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData?.error?.message || `Upload failed with status ${response.status}`);
    }

    const data: ImageBBResponse = await response.json();

    if (!data.success || !data.data?.url) {
      throw new Error("Upload failed. Please try again.");
    }

    // Return the display URL
    return data.data.display_url || data.data.url;
  } catch (error) {
    // Handle network errors
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error("Network error. Please check your internet connection and try again.");
    }

    // Re-throw with original message
    throw error;
  }
};
