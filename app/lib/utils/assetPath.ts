/**
 * Get the correct path for public assets considering basePath
 * This is needed for GitHub Pages deployment where the app is hosted at /fintrack/
 */
export const getAssetPath = (path: string): string => {
  // In production, prefix with basePath
  const basePath = process.env.NODE_ENV === "production" ? "/fintrack" : "";
  return `${basePath}${path}`;
};
