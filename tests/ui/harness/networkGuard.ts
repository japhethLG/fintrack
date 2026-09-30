/**
 * Hard guarantee that no test can reach a real backend.
 *
 * Layers (outermost to innermost):
 *   1. `fetch`          -> throws, and records the attempt
 *   2. `XMLHttpRequest` -> `send`/`open` throw
 *   3. `WebSocket` / `EventSource` / `sendBeacon` -> throw
 *   4. Node `net.Socket#connect` -> throws for any non-loopback host
 *
 * The first three are what browser code can call; layer 4 is the backstop for
 * a library that reaches for Node's sockets directly (jsdom resource loader,
 * undici). Loopback stays open because Vitest's own worker channel may use it.
 *
 * `blockedRequests` records every attempt so a test (or the afterEach in
 * setup.ts) can assert nothing escaped.
 */
import net from "node:net";

export interface BlockedRequest {
  kind: "fetch" | "xhr" | "websocket" | "eventsource" | "beacon" | "socket";
  target: string;
}

export const blockedRequests: BlockedRequest[] = [];

const block = (kind: BlockedRequest["kind"], target: unknown): never => {
  const label =
    typeof target === "string" ? target : String((target as { url?: string })?.url ?? target);
  blockedRequests.push({ kind, target: label });
  throw new Error(
    `NETWORK BLOCKED (${kind}): ${label}. UI tests must never touch the network — ` +
      "mock the service module or seed the in-memory Firestore instead."
  );
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", ""]);

let installed = false;

export function installNetworkGuard(): void {
  if (installed) return;
  installed = true;

  const guardedFetch = (input: unknown) => {
    // Async rejection, like a real failed fetch — but recorded.
    try {
      block("fetch", input);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.reject(new Error("unreachable"));
  };
  globalThis.fetch = guardedFetch as unknown as typeof fetch;
  if (typeof window !== "undefined") window.fetch = guardedFetch as unknown as typeof fetch;

  if (typeof XMLHttpRequest !== "undefined") {
    XMLHttpRequest.prototype.open = function (_method: string, url: string | URL) {
      block("xhr", String(url));
    } as never;
    XMLHttpRequest.prototype.send = function () {
      block("xhr", "send()");
    };
  }

  const denyCtor = (kind: BlockedRequest["kind"]) =>
    class {
      constructor(url?: unknown) {
        block(kind, url);
      }
    };
  (globalThis as Record<string, unknown>).WebSocket = denyCtor("websocket");
  (globalThis as Record<string, unknown>).EventSource = denyCtor("eventsource");
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).WebSocket = (globalThis as never)["WebSocket"];
    (window as unknown as Record<string, unknown>).EventSource = (globalThis as never)[
      "EventSource"
    ];
    Object.defineProperty(window.navigator, "sendBeacon", {
      configurable: true,
      value: (url: string) => block("beacon", url),
    });
  }

  const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    // Node normalises `net.connect(opts, cb)` into `socket.connect([opts, cb])`.
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    let host: string | undefined;
    if (first && typeof first === "object") {
      const opts = first as { path?: string; host?: string };
      if (opts.path) return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args); // IPC / unix socket
      host = opts.host ?? "localhost";
    } else if (typeof first === "string") {
      return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args); // pipe path
    } else {
      host = typeof args[1] === "string" ? (args[1] as string) : "localhost";
    }
    if (!LOOPBACK.has(host)) block("socket", host);
    return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
}
