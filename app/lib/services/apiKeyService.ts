/**
 * API Key Service
 *
 * Manages user-provided API keys for external services like Gemini.
 * Keys are encrypted before storage using Web Crypto API (AES-GCM).
 *
 * In production: user key is required
 * In development: user key is optional, falls back to environment variable
 */

const API_KEY_STORAGE_KEY = "fintrack_gemini_api_key_v2";
const ENCRYPTION_SALT = "fintrack-api-key-encryption-salt";

// ============================================================================
// ENCRYPTION UTILITIES
// ============================================================================

/**
 * Generate a cryptographic key from a password/salt using PBKDF2
 */
async function deriveKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  // Use a combination of domain and salt for key derivation
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(ENCRYPTION_SALT + window.location.origin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(ENCRYPTION_SALT),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a string using AES-GCM
 */
async function encrypt(plaintext: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await deriveKey();

  // Generate a random IV for each encryption
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );

  // Combine IV and encrypted data, then base64 encode
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a string using AES-GCM
 */
async function decrypt(ciphertext: string): Promise<string | null> {
  try {
    const decoder = new TextDecoder();
    const key = await deriveKey();

    // Decode base64 and split IV from encrypted data
    const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);

    return decoder.decode(decrypted);
  } catch (error) {
    console.error("Failed to decrypt API key:", error);
    return null;
  }
}

// ============================================================================
// CACHE FOR DECRYPTED KEY (avoid repeated decryption)
// ============================================================================

let cachedApiKey: string | null = null;
let cacheInitialized = false;

/**
 * Initialize the cache by decrypting stored key
 */
async function initCache(): Promise<void> {
  if (cacheInitialized || typeof window === "undefined") return;

  const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (stored) {
    cachedApiKey = await decrypt(stored);
  }
  cacheInitialized = true;
}

// Initialize cache on module load (async)
if (typeof window !== "undefined") {
  initCache();
}

// ============================================================================
// PUBLIC API
// ============================================================================

export interface ApiKeyConfig {
  /** User-provided API key stored in localStorage */
  userKey: string | null;
  /** Whether an environment variable key is available */
  envKeyAvailable: boolean;
  /** The effective key to use (user key takes precedence) */
  effectiveKey: string | null;
  /** Whether we're running in production */
  isProduction: boolean;
}

/**
 * Check if we're running in production
 */
export const isProduction = (): boolean => {
  return process.env.NODE_ENV === "production";
};

/**
 * Get the user-provided API key (synchronous, uses cache)
 * Note: Returns null until cache is initialized
 */
export const getUserApiKey = (): string | null => {
  if (typeof window === "undefined") return null;
  return cachedApiKey;
};

/**
 * Get the user-provided API key (async, ensures decryption)
 */
export const getUserApiKeyAsync = async (): Promise<string | null> => {
  if (typeof window === "undefined") return null;

  if (!cacheInitialized) {
    await initCache();
  }

  return cachedApiKey;
};

/**
 * Set the user-provided API key (encrypted in localStorage)
 */
export const setUserApiKey = async (key: string): Promise<void> => {
  if (typeof window === "undefined") return;

  const encrypted = await encrypt(key);
  localStorage.setItem(API_KEY_STORAGE_KEY, encrypted);
  cachedApiKey = key;
  cacheInitialized = true;
};

/**
 * Clear the user-provided API key from localStorage
 */
export const clearUserApiKey = (): void => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(API_KEY_STORAGE_KEY);
  cachedApiKey = null;
};

/**
 * Get the full API key configuration
 */
export const getApiKeyConfig = (): ApiKeyConfig => {
  const userKey = getUserApiKey();
  const envKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || null;
  const isProd = isProduction();

  return {
    userKey,
    envKeyAvailable: !!envKey,
    effectiveKey: userKey || envKey,
    isProduction: isProd,
  };
};

/**
 * Get the API key to use for requests
 * In production: only returns user-provided key
 * In development: user key takes precedence, falls back to env var
 */
export const getEffectiveApiKey = (): string | null => {
  const config = getApiKeyConfig();
  return config.effectiveKey;
};

/**
 * Check if the API key is properly configured
 * In production: user must have provided a key
 * In development: either user key or env var works
 */
export const isApiKeyConfigured = (): boolean => {
  const config = getApiKeyConfig();

  if (config.isProduction) {
    // In production, require user-provided key
    return !!config.userKey;
  }

  // In development, either works
  return !!config.effectiveKey;
};

/**
 * Check if user needs to configure an API key
 */
export const needsApiKeyConfiguration = (): boolean => {
  const config = getApiKeyConfig();

  if (config.isProduction) {
    return !config.userKey;
  }

  // In dev, if no env var and no user key, they need to configure
  return !config.effectiveKey;
};

/**
 * Ensure the API key cache is initialized (call before using sync methods)
 */
export const ensureInitialized = async (): Promise<void> => {
  await initCache();
};
