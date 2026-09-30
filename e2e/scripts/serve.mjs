#!/usr/bin/env node
/**
 * Build (when stale) and statically serve the FINTRACK_E2E production export.
 *
 *   node e2e/scripts/serve.mjs            build if stale, then serve
 *   node e2e/scripts/serve.mjs --build    force a rebuild, then serve
 *   node e2e/scripts/serve.mjs --build-only
 *
 * Why a static server instead of `next dev`: see e2e/README.md ("Dev server vs
 * production build"). Short version: the shipped app is a static export under
 * basePath /fintrack; testing that artifact is the most faithful thing, it has
 * no compile-on-demand stalls, no dev overlay and no StrictMode double effects.
 *
 * The server binds 127.0.0.1 only. Never point it at anything else.
 */
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const distDir = join(root, ".next-e2e");
const stampFile = join(distDir, ".e2e-build-stamp");
const port = Number(process.env.E2E_PORT ?? 3100);
const BASE_PATH = "/fintrack";
const args = new Set(process.argv.slice(2));

// Single source of truth for the dummy NEXT_PUBLIC_* values: loading the config
// under FINTRACK_E2E=1 applies them to *this* process env, which the build
// child then inherits (process env beats .env.local in Next).
process.env.FINTRACK_E2E = "1";
process.env.NEXT_TELEMETRY_DISABLED = "1";
createRequire(import.meta.url)(join(root, "next.config.js"));

const SOURCES = ["app", "public", "e2e/fakes", "e2e/shared", "next.config.js", "package.json", "tailwind.config.ts", "postcss.config.js", "tsconfig.json"];

const newestMtime = (path) => {
  const full = join(root, path);
  if (!existsSync(full)) return 0;
  const st = statSync(full);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs;
  for (const entry of readdirSync(full)) newest = Math.max(newest, newestMtime(join(path, entry)));
  return newest;
};

const isStale = () => {
  if (!existsSync(join(distDir, "index.html")) || !existsSync(stampFile)) return true;
  const built = statSync(stampFile).mtimeMs;
  return SOURCES.some((s) => newestMtime(s) > built);
};

const build = () => {
  console.log("[e2e] building FINTRACK_E2E export into .next-e2e ...");
  const res = spawnSync("npx", ["next", "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (res.status !== 0) {
    console.error("[e2e] build failed");
    process.exit(res.status ?? 1);
  }
  writeFileSync(stampFile, new Date().toISOString());
};

/**
 * Belt and braces for the aliasing in next.config.js: scan the finished export
 * for anything that only the REAL Firebase / Gemini / ImgBB clients contain. If
 * an alias ever stops matching (renamed import, bundler change...) the server
 * refuses to start instead of silently testing against a real backend.
 */
const FORBIDDEN = [
  [/AIza[0-9A-Za-z_-]{35}/, "a Google API key"],
  [/firestore\.googleapis\.com/, "the Firestore endpoint"],
  [/identitytoolkit\.googleapis\.com/, "the Firebase Auth endpoint"],
  [/securetoken\.googleapis\.com/, "the Firebase token endpoint"],
  [/firebaseio\.com/, "the Realtime Database endpoint"],
  [/\.firebaseapp\.com/, "a firebaseapp.com auth domain"],
  [/generativelanguage\.googleapis\.com/, "the Gemini endpoint"],
  [/api\.imgbb\.com/, "the ImgBB endpoint"],
  [/apis\.google\.com\/js/, "Google's popup-auth script"],
];

const verifyNoRealBackends = () => {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs|html|txt|json|css)$/.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        for (const [re, what] of FORBIDDEN) if (re.test(text)) hits.push(`${full.slice(distDir.length + 1)}: ${what}`);
      }
    }
  };
  walk(distDir);
  if (!hasFakeMarker()) hits.push("(no fake-firebase marker found in the build)");
  if (hits.length > 0) {
    console.error("[e2e] REFUSING TO SERVE: the E2E build contains real-backend code:\n  " + hits.join("\n  "));
    process.exit(2);
  }
  console.log("[e2e] build verified: no real Firebase/Gemini/ImgBB client code, fake layer present");
};

const hasFakeMarker = () => {
  let found = false;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (found) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && readFileSync(full, "utf8").includes("__FINTRACK_FAKE_FIREBASE__")) found = true;
    }
  };
  walk(distDir);
  return found;
};

if (args.has("--build") || isStale()) build();
else console.log("[e2e] .next-e2e is up to date, skipping build");
verifyNoRealBackends();
if (args.has("--build-only")) process.exit(0);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
};

const resolveFile = (relative) => {
  const safe = normalize(relative).replace(/^(\.\.[/\\])+/, "");
  const candidates = [safe, `${safe}.html`, join(safe, "index.html")];
  for (const c of candidates) {
    const full = join(distDir, c);
    if (full.startsWith(distDir + sep) && existsSync(full) && statSync(full).isFile()) return full;
  }
  return null;
};

const send = (res, status, file) => {
  res.writeHead(status, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(res);
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/__e2e_health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("fintrack-e2e-static");
    return;
  }
  // Anything outside the basePath is a spec-author slip (page.goto("/dashboard")):
  // forward it so it still works.
  if (pathname !== BASE_PATH && !pathname.startsWith(`${BASE_PATH}/`)) {
    res.writeHead(302, { Location: `${BASE_PATH}${pathname === "/" ? "/" : pathname}${url.search}` });
    res.end();
    return;
  }
  const relative = pathname.slice(BASE_PATH.length).replace(/^\/+/, "");
  const file = relative === "" ? join(distDir, "index.html") : resolveFile(relative);
  if (file) return send(res, 200, file);
  send(res, 404, join(distDir, "404.html"));
}).listen(port, "127.0.0.1", () => {
  console.log(`[e2e] serving ${distDir} at http://127.0.0.1:${port}${BASE_PATH}/`);
});
