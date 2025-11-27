/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Use base path for GitHub Pages (repository name)
  basePath: process.env.NODE_ENV === 'production' ? '/fintrack' : '',
  assetPrefix: process.env.NODE_ENV === 'production' ? '/fintrack' : '',
};

module.exports = nextConfig;
