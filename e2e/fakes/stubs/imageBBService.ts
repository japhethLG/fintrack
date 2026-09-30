/**
 * Deterministic stand-in for app/lib/services/imageBBService.ts (aliased in
 * when FINTRACK_E2E=1). No network: "uploads" resolve to a data: URL (a remote
 * URL would make the browser fetch it and trip the network guard).
 *
 * Validation mirrors the real module so validation-error UI still works.
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_FILE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

export interface ImageBBResponse {
  data: { url: string; display_url: string; delete_url: string };
  success: boolean;
  status: number;
}

export interface UploadError {
  message: string;
  code?: string;
}

/** 1x1 transparent PNG. */
export const FAKE_UPLOAD_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export const validateImageFile = (file: File): { valid: boolean; error?: string } => {
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return { valid: false, error: "Invalid file type. Please upload a JPEG, PNG, or WebP image." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File size exceeds 5MB. Please upload a smaller image.` };
  }
  return { valid: true };
};

export const uploadToImageBB = async (file: File): Promise<string> => {
  const validation = validateImageFile(file);
  if (!validation.valid) throw new Error(validation.error);
  return FAKE_UPLOAD_URL;
};
