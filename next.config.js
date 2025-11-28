/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",

  // Next.js 16: Updated image configuration
  images: {
    unoptimized: true,
    // New in v16: Default minimumCacheTTL is now 4 hours (14400 seconds)
    minimumCacheTTL: 14400,
    // New in v16: Default qualities is now [75]
    formats: ["image/webp"],
  },

  // Use base path for GitHub Pages (repository name)
  basePath: process.env.NODE_ENV === "production" ? "/fintrack" : "",
  assetPrefix: process.env.NODE_ENV === "production" ? "/fintrack" : "",

  // Next.js 16: Turbopack is now the default bundler (no config needed)
  // For faster development and production builds
};

module.exports = nextConfig;
