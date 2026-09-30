/**
 * Firestore Helper Utilities
 * Common utility functions used across firestore operations
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

const stripUndefinedDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripUndefinedDeep);
  if (isPlainObject(value)) {
    const cleaned: Record<string, unknown> = {};
    Object.keys(value).forEach((key) => {
      const inner = value[key];
      if (inner !== undefined) cleaned[key] = stripUndefinedDeep(inner);
    });
    return cleaned;
  }
  return value; // primitives, Timestamp, FieldValue sentinels: passed through untouched
};

/**
 * Remove undefined values from an object before writing to Firestore.
 * Firestore doesn't allow undefined values (at any depth) - use null or omit the field.
 * Only plain objects and arrays are walked; class instances (Timestamp, FieldValue
 * sentinels) are left exactly as they are.
 */
export const removeUndefined = <T extends Record<string, unknown>>(obj: T): Partial<T> =>
  stripUndefinedDeep(obj) as Partial<T>;
