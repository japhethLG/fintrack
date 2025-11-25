import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines clsx and tailwind-merge to intelligently merge Tailwind CSS classes.
 * Handles conditional classes and resolves conflicts (e.g., px-4 + px-8 = px-8).
 *
 * @param inputs - Class values (strings, arrays, objects, undefined/null)
 * @returns Merged className string
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

