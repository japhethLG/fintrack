// E2E mode (Playwright): swap the Firebase SDK, Gemini and ImgBB for in-browser
// fakes/stubs so no test can ever reach a real backend. With the flag unset
// NOTHING below the `isE2E` guard runs and this config is identical to before.
const isE2E = process.env.FINTRACK_E2E === "1";

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

if (isE2E) {
  // Real keys from .env.local must never be inlined into the E2E bundle.
  // Process env wins over .env* files in Next, so overriding here (and in the
  // e2e webServer command, see playwright.config.ts) is enough.
  const dummyEnv = {
    NEXT_PUBLIC_FIREBASE_API_KEY: "e2e-fake-api-key",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "e2e-fake.invalid",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "e2e-fake-project",
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "e2e-fake.invalid",
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "0",
    NEXT_PUBLIC_FIREBASE_APP_ID: "e2e-fake-app-id",
    NEXT_PUBLIC_GEMINI_API_KEY: "e2e-fake-gemini-key",
    NEXT_PUBLIC_IMAGE_BB_API_KEY: "e2e-fake-imgbb-key",
  };
  Object.assign(process.env, dummyEnv);

  // module specifier -> fake, relative to the project root (Turbopack) ...
  const relAliases = {
    "firebase/app": "./e2e/fakes/firebase-app.ts",
    "firebase/auth": "./e2e/fakes/firebase-auth.ts",
    "firebase/firestore": "./e2e/fakes/firebase-firestore.ts",
    "@/lib/services/geminiService": "./e2e/fakes/stubs/geminiService.ts",
    "@/lib/services/imageBBService": "./e2e/fakes/stubs/imageBBService.ts",
    // defence in depth: the real Gemini SDK can never be bundled either
    "@google/genai": "./e2e/fakes/stubs/genai.ts",
  };

  nextConfig.env = { ...(nextConfig.env || {}), ...dummyEnv };
  // Separate build dir so an E2E build never clobbers a normal `.next`.
  nextConfig.distDir = ".next-e2e";
  // The E2E build must not depend on the type-cleanliness of test/tooling dirs
  // (tsconfig includes **/*.ts, e.g. remotion/ needs packages that are not
  // installed). App types are checked by `npx tsc --noEmit`, not by this build.
  nextConfig.typescript = { ...(nextConfig.typescript || {}), ignoreBuildErrors: true };
  nextConfig.turbopack = {
    ...(nextConfig.turbopack || {}),
    resolveAlias: { ...((nextConfig.turbopack || {}).resolveAlias || {}), ...relAliases },
  };

  // ... and the webpack fallback (`FINTRACK_E2E_BUNDLER=webpack next build --webpack`).
  // Only registered on request, so the default (Turbopack) E2E build is not
  // influenced by a webpack() hook. Firebase/genai use exact-match aliases;
  // the app services are replaced by resolved path (the "@/..." tsconfig alias
  // is rewritten before webpack's resolve.alias would see it).
  if (process.env.FINTRACK_E2E_BUNDLER === "webpack") {
    const path = require("path");
    nextConfig.webpack = (config, { webpack }) => {
      const exact = {};
      for (const [request, target] of Object.entries(relAliases)) {
        if (request.startsWith("@/")) continue;
        exact[`${request}$`] = path.resolve(__dirname, target);
      }
      config.resolve.alias = { ...(config.resolve.alias || {}), ...exact };
      for (const name of ["geminiService", "imageBBService"]) {
        config.plugins.push(
          new webpack.NormalModuleReplacementPlugin(
            new RegExp(`services[\\\\/]${name}(\\.tsx?)?$`),
            path.resolve(__dirname, `e2e/fakes/stubs/${name}.ts`)
          )
        );
      }
      return config;
    };
  }
}

module.exports = nextConfig;
