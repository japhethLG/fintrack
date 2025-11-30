/**
 * Firestore Helper Utilities
 * Common utility functions used across firestore operations
 */

/**
 * Remove undefined values from an object before writing to Firestore.
 * Firestore doesn't allow undefined values - use null or omit the field.
 */
export const removeUndefined = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
  const cleaned: Record<string, unknown> = {};
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (value !== undefined) {
      cleaned[key] = value;
    }
  });
  return cleaned as Partial<T>;
};

