/**
 * Controllable stand-in for `next/navigation`.
 *
 * `useRouter()` returns a stable object whose methods are spies; `push` and
 * `replace` also update the pathname/search params the hooks report, so a
 * component that reads `usePathname()` after navigating sees the new route
 * (the mounted page component itself does NOT change — this is a component
 * harness, not a router. Assert on `router.push` instead).
 *
 * Registered by `tests/ui/setup.ts`:
 *   vi.mock("next/navigation", () => import("./harness/router"));
 */
import { vi } from "vitest";

let pathname = "/";
let search = new URLSearchParams();

export const router = {
  push: vi.fn((href: string) => applyHref(href)),
  replace: vi.fn((href: string) => applyHref(href)),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

function applyHref(href: string): void {
  const [path, query = ""] = href.split("?");
  pathname = path || "/";
  search = new URLSearchParams(query);
}

/** Point the fake router at a route (does not record a `push`). */
export const __setRoute = (href: string): void => applyHref(href);

/** Reset location and spy history. */
export const __resetRouter = (): void => {
  pathname = "/";
  search = new URLSearchParams();
  Object.values(router).forEach((fn) => fn.mockClear());
};

export const useRouter = () => router;
export const usePathname = () => pathname;
export const useSearchParams = () => new URLSearchParams(search);
export const useParams = () => ({});
export const redirect = vi.fn();
export const notFound = vi.fn();
