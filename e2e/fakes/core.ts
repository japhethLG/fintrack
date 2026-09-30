/**
 * Shared in-browser backend for the Firebase fakes (firebase-app / -auth /
 * -firestore). One module instance per page load => one store.
 *
 * Responsibilities:
 *  - the document store, persisted to localStorage under STORE_KEY on every
 *    write (survives reloads / client navigations; shared across tabs of one
 *    browser context, kept in sync via the `storage` event)
 *  - the Timestamp class + JSON encoding of it
 *  - listener registry (onSnapshot / onAuthStateChanged)
 *  - `window.__fintrackE2E` bridge and `window.__FINTRACK_FAKE_FIREBASE__`
 *
 * NOTHING in here may touch the network.
 */
import {
  STORE_KEY,
  TIMESTAMP_TAG,
  emptyState,
  type AuthAccount,
  type AuthConfig,
  type DocJSON,
  type E2EBridge,
  type E2EUser,
  type FirestoreFault,
  type OpLogEntry,
  type PersistedState,
  type SeedState,
} from "../shared/protocol";

export type { AuthAccount, AuthConfig, E2EUser, FirestoreFault };

// ============================================================================
// ERRORS
// ============================================================================

export class FirebaseError extends Error {
  readonly code: string;
  readonly customData: Record<string, unknown> = {};
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "FirebaseError";
  }
}

/** Mirrors the message shape of the real SDK: "Firebase: Error (auth/xyz)." */
export const authError = (code: string): FirebaseError =>
  new FirebaseError(code, `Firebase: Error (${code}).`);

// ============================================================================
// TIMESTAMP
// ============================================================================

export class Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;

  constructor(seconds: number, nanoseconds: number) {
    if (nanoseconds < 0 || nanoseconds >= 1e9) {
      throw new FirebaseError(
        "invalid-argument",
        `Timestamp nanoseconds out of range: ${nanoseconds}`
      );
    }
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  static now(): Timestamp {
    return Timestamp.fromMillis(Date.now());
  }
  static fromDate(date: Date): Timestamp {
    return Timestamp.fromMillis(date.getTime());
  }
  static fromMillis(millis: number): Timestamp {
    const seconds = Math.floor(millis / 1000);
    const nanos = Math.floor((millis - seconds * 1000) * 1e6);
    return new Timestamp(seconds, nanos);
  }

  toDate(): Date {
    return new Date(this.toMillis());
  }
  toMillis(): number {
    return this.seconds * 1000 + this.nanoseconds / 1e6;
  }
  isEqual(other: Timestamp): boolean {
    return other instanceof Timestamp && other.seconds === this.seconds && other.nanoseconds === this.nanoseconds;
  }
  compareTo(other: Timestamp): number {
    return this.seconds - other.seconds || this.nanoseconds - other.nanoseconds;
  }
  /** Same trick as the real SDK: lexicographically sortable string. */
  valueOf(): string {
    const adjusted = this.seconds + 62135596800;
    return String(adjusted).padStart(12, "0") + "." + String(this.nanoseconds).padStart(9, "0");
  }
  toString(): string {
    return `Timestamp(seconds=${this.seconds}, nanoseconds=${this.nanoseconds})`;
  }
  toJSON(): { __type: string; seconds: number; nanoseconds: number } {
    return { __type: TIMESTAMP_TAG, seconds: this.seconds, nanoseconds: this.nanoseconds };
  }
}

// ============================================================================
// SENTINELS (FieldValue)
// ============================================================================

export type FieldValueKind = "delete" | "serverTimestamp" | "increment" | "arrayUnion" | "arrayRemove";

export class FieldValue {
  constructor(
    readonly kind: FieldValueKind,
    readonly operand?: unknown
  ) {}
}

// ============================================================================
// VALUE HELPERS
// ============================================================================

type Data = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Data =>
  v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;

/** Deep clone that shares (immutable) Timestamp instances. */
export const clone = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(clone) as unknown as T;
  if (isPlainObject(value)) {
    const out: Data = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out as T;
  }
  return value;
};

/** Turn `{__type:"timestamp",...}` tags (from JSON) back into Timestamps. */
export const revive = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(revive);
  if (value !== null && typeof value === "object") {
    const rec = value as Data;
    if (rec.__type === TIMESTAMP_TAG && typeof rec.seconds === "number") {
      return new Timestamp(rec.seconds, (rec.nanoseconds as number) ?? 0);
    }
    const out: Data = {};
    for (const [k, v] of Object.entries(rec)) out[k] = revive(v);
    return out;
  }
  return value;
};

/** Encode for JSON. `withIso` adds a human readable `iso` to timestamps. */
const encode = (value: unknown, withIso: boolean): unknown => {
  if (value instanceof Timestamp) {
    const base: Data = { __type: TIMESTAMP_TAG, seconds: value.seconds, nanoseconds: value.nanoseconds };
    if (withIso) base.iso = value.toDate().toISOString();
    return base;
  }
  if (Array.isArray(value)) return value.map((v) => encode(v, withIso));
  if (value !== null && typeof value === "object") {
    const out: Data = {};
    for (const [k, v] of Object.entries(value as Data)) out[k] = encode(v, withIso);
    return out;
  }
  return value;
};

export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a instanceof Timestamp && b instanceof Timestamp) return a.isEqual(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b);
};

/** Firestore cross-type ordering: null < bool < number < timestamp < string < array < map. */
const typeRank = (v: unknown): number => {
  if (v === null) return 0;
  if (typeof v === "boolean") return 1;
  if (typeof v === "number") return 2;
  if (v instanceof Timestamp) return 3;
  if (typeof v === "string") return 4;
  if (Array.isArray(v)) return 6;
  return 7;
};

export const compareValues = (a: unknown, b: unknown): number => {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  switch (ra) {
    case 1:
      return Number(a) - Number(b);
    case 2:
      return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
    case 3:
      return (a as Timestamp).compareTo(b as Timestamp);
    case 4:
      // Firestore compares by UTF-8 bytes == code point order. JS `<` on
      // strings is UTF-16 code unit order, identical for everything but
      // astral-plane characters.
      return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
    default:
      return 0;
  }
};

export const getByPath = (data: Data, path: string): unknown => {
  let cursor: unknown = data;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Data)[segment];
  }
  return cursor;
};

const findUndefined = (value: unknown, path: string): string | null => {
  if (value === undefined) return path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findUndefined(value[i], `${path}[${i}]`);
      if (found) return found;
    }
  } else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const found = findUndefined(v, path ? `${path}.${k}` : k);
      if (found) return found;
    }
  }
  return null;
};

/** The real SDK rejects `undefined` field values unless ignoreUndefinedProperties. */
export const assertNoUndefined = (fn: string, data: unknown): void => {
  const found = findUndefined(data, "");
  if (found !== null) {
    throw new FirebaseError(
      "invalid-argument",
      `Function ${fn}() called with invalid data. Unsupported field value: undefined (found in field ${found})`
    );
  }
};

// ============================================================================
// STORE
// ============================================================================

interface Store {
  seedId?: string;
  auth: PersistedState["auth"];
  collections: Record<string, Record<string, Data>>;
  meta: { autoId: number };
  fault: FirestoreFault | null;
  ops: OpLogEntry[];
}

const hasWindow = typeof window !== "undefined";
const MAX_OPS = 2000;

const fromPersisted = (raw: string | null): Store => {
  const base = emptyState();
  if (!raw) return { ...base, collections: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const collections: Store["collections"] = {};
    for (const [name, docs] of Object.entries(parsed.collections ?? {})) {
      collections[name] = {};
      for (const [id, data] of Object.entries(docs)) collections[name][id] = revive(data) as Data;
    }
    return {
      seedId: parsed.seedId,
      auth: {
        currentUser: parsed.auth?.currentUser ?? null,
        accounts: parsed.auth?.accounts ?? {},
        config: parsed.auth?.config ?? {},
      },
      collections,
      meta: { autoId: parsed.meta?.autoId ?? 0 },
      fault: parsed.fault ?? null,
      ops: parsed.ops ?? [],
    };
  } catch (error) {
    console.error("[fintrack-e2e] could not parse persisted store, starting empty", error);
    return { ...base, collections: {} };
  }
};

const readStorage = (): string | null => {
  if (!hasWindow) return null;
  try {
    return window.localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
};

let store: Store = fromPersisted(readStorage());

const serialize = (withIso: boolean): PersistedState => ({
  v: 1,
  seedId: store.seedId,
  auth: encode(store.auth, withIso) as PersistedState["auth"],
  collections: encode(store.collections, withIso) as PersistedState["collections"],
  meta: store.meta,
  fault: store.fault,
  ops: store.ops,
});

const persist = (): void => {
  if (!hasWindow) return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(serialize(false)));
  } catch (error) {
    console.error("[fintrack-e2e] could not persist store", error);
  }
};

export const getCollection = (name: string): Record<string, Data> => {
  if (!store.collections[name]) store.collections[name] = {};
  return store.collections[name];
};

export const readDoc = (collection: string, id: string): Data | undefined =>
  store.collections[collection]?.[id];

export const listDocs = (collection: string): Array<{ id: string; data: Data }> =>
  Object.entries(store.collections[collection] ?? {}).map(([id, data]) => ({ id, data }));

export const nextAutoId = (): string => {
  store.meta.autoId += 1;
  // Deterministic, sortable, 20 chars like real ids. Persisted, so ids never
  // collide across reloads.
  return `e2eauto${String(store.meta.autoId).padStart(13, "0")}`;
};

export const logOp = (entry: OpLogEntry): void => {
  store.ops.push({ ...entry, data: entry.data ? (encode(entry.data, false) as DocJSON) : undefined });
  if (store.ops.length > MAX_OPS) store.ops.splice(0, store.ops.length - MAX_OPS);
};

/** Throws when a configured write fault applies. */
export const checkWriteFault = (collection: string): void => {
  const fault = store.fault;
  if (!fault) return;
  if (fault.collections && !fault.collections.includes(collection)) return;
  if (fault.times !== undefined) {
    if (fault.times <= 0) {
      store.fault = null;
      return;
    }
    fault.times -= 1;
    persist();
  }
  throw new FirebaseError(fault.code, fault.message ?? `Firestore fault injected by E2E harness (${fault.code})`);
};

/** Call after mutating `store` synchronously. */
export const commit = (): void => {
  persist();
  scheduleNotify();
};

// ============================================================================
// FIRESTORE LISTENERS
// ============================================================================

interface Listener {
  signature: () => string;
  emit: () => void;
  last: string | null;
  closed: boolean;
}

const listeners = new Set<Listener>();
let notifyScheduled = false;

const fire = (listener: Listener): void => {
  if (listener.closed) return;
  const sig = listener.signature();
  if (listener.last !== null && sig === listener.last) return;
  listener.last = sig;
  try {
    listener.emit();
  } catch (error) {
    console.error("[fintrack-e2e] onSnapshot callback threw", error);
  }
};

function scheduleNotify(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  // Microtask (not setTimeout): must keep working when tests install a fake
  // Playwright clock.
  queueMicrotask(() => {
    notifyScheduled = false;
    Array.from(listeners).forEach(fire);
  });
}

export const addSnapshotListener = (signature: () => string, emit: () => void): (() => void) => {
  const listener: Listener = { signature, emit, last: null, closed: false };
  listeners.add(listener);
  // First snapshot is delivered asynchronously, like the real SDK.
  queueMicrotask(() => fire(listener));
  return () => {
    listener.closed = true;
    listeners.delete(listener);
  };
};

/** JSON signature of arbitrary snapshot content (Timestamps have toJSON). */
export const signatureOf = (value: unknown): string => JSON.stringify(value) ?? "undefined";

// ============================================================================
// AUTH STATE
// ============================================================================

type AuthCallback = (user: FakeUser | null) => void;
const authListeners = new Set<AuthCallback>();

export interface FakeUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  phoneNumber: string | null;
  providerData: unknown[];
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  reload: () => Promise<void>;
}

let cachedUser: { key: string; user: FakeUser } | null = null;

const buildUser = (u: E2EUser): FakeUser => ({
  uid: u.uid,
  email: u.email ?? null,
  displayName: u.displayName ?? null,
  photoURL: u.photoURL ?? null,
  emailVerified: true,
  isAnonymous: false,
  phoneNumber: null,
  providerData: [],
  getIdToken: async () => "e2e-fake-id-token",
  reload: async () => undefined,
});

/** Stable object identity per distinct user (React effects depend on it). */
export const getCurrentUser = (): FakeUser | null => {
  const current = store.auth.currentUser;
  if (!current) {
    cachedUser = null;
    return null;
  }
  const key = JSON.stringify(current);
  if (!cachedUser || cachedUser.key !== key) cachedUser = { key, user: buildUser(current) };
  return cachedUser.user;
};

export const notifyAuth = (): void => {
  const user = getCurrentUser();
  queueMicrotask(() => {
    authListeners.forEach((cb) => {
      try {
        cb(user);
      } catch (error) {
        console.error("[fintrack-e2e] onAuthStateChanged callback threw", error);
      }
    });
  });
};

export const addAuthListener = (cb: AuthCallback): (() => void) => {
  authListeners.add(cb);
  // Real SDK reports the initial state asynchronously.
  queueMicrotask(() => {
    if (authListeners.has(cb)) cb(getCurrentUser());
  });
  return () => {
    authListeners.delete(cb);
  };
};

export const authConfig = (): AuthConfig => store.auth.config;
export const accounts = (): Record<string, AuthAccount> => store.auth.accounts;

export const setCurrentUser = (user: E2EUser | null): void => {
  store.auth.currentUser = user ? { ...user } : null;
  if (user?.email) {
    const key = user.email.toLowerCase();
    store.auth.accounts[key] = { ...(store.auth.accounts[key] ?? {}), uid: user.uid };
  }
  persist();
  notifyAuth();
};

export const patchCurrentUser = (patch: Partial<E2EUser>): void => {
  if (!store.auth.currentUser) return;
  store.auth.currentUser = { ...store.auth.currentUser, ...patch };
  persist();
  notifyAuth();
};

export const registerAccount = (email: string, account: AuthAccount): void => {
  store.auth.accounts[email.toLowerCase()] = account;
  persist();
};

export const removeAccount = (email: string): void => {
  delete store.auth.accounts[email.toLowerCase()];
  persist();
};

export const setAccountPassword = (email: string, password: string): void => {
  const acct = store.auth.accounts[email.toLowerCase()];
  if (acct?.password !== undefined) {
    acct.password = password;
    persist();
  }
};

/** Deterministic uid for an email that has no account yet. */
export const uidForEmail = (email: string): string => {
  let h = 5381;
  for (const ch of email.toLowerCase()) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return `e2e-${email.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}-${h.toString(36)}`;
};

/** Find the uid for an email: auth account, then a users/* profile, else derive. */
export const resolveUidByEmail = (email: string): { uid: string; known: boolean } => {
  const key = email.toLowerCase();
  const acct = store.auth.accounts[key];
  if (acct) return { uid: acct.uid, known: true };
  for (const { id, data } of listDocs("users")) {
    if (typeof data.email === "string" && data.email.toLowerCase() === key) {
      return { uid: (data.uid as string) ?? id, known: true };
    }
  }
  return { uid: uidForEmail(email), known: false };
};

// ============================================================================
// BRIDGE
// ============================================================================

const applySeed = (seed: SeedState): void => {
  const next = emptyState();
  const collections: Store["collections"] = {};
  for (const [name, docs] of Object.entries(seed.collections ?? {})) {
    collections[name] = {};
    for (const [id, data] of Object.entries(docs)) collections[name][id] = revive(data) as Data;
  }
  store = {
    seedId: seed.seedId,
    auth: {
      currentUser: seed.auth?.currentUser ?? null,
      accounts: { ...(seed.auth?.accounts ?? {}) },
      config: { ...(seed.auth?.config ?? {}) },
    },
    collections,
    meta: next.meta,
    fault: seed.fault ?? null,
    ops: [],
  };
  const cu = store.auth.currentUser;
  if (cu?.email && !store.auth.accounts[cu.email.toLowerCase()]) {
    store.auth.accounts[cu.email.toLowerCase()] = { uid: cu.uid };
  }
  persist();
  scheduleNotify();
  notifyAuth();
};

const installBridge = (): void => {
  const w = window as unknown as Record<string, unknown>;
  w.__FINTRACK_FAKE_FIREBASE__ = true;

  const bridge: E2EBridge = {
    fake: true,
    version: 1,
    seed: applySeed,
    dump: () => {
      const s = serialize(true);
      return { auth: s.auth, collections: s.collections, ops: s.ops };
    },
    reset: () => applySeed({}),
    signIn: (user) => setCurrentUser(user),
    signOut: () => setCurrentUser(null),
    configureAuth: (config) => {
      store.auth.config = { ...store.auth.config, ...config };
      persist();
    },
    setFault: (fault) => {
      store.fault = fault;
      persist();
    },
    geminiCalls: [],
    geminiResponse: null,
    geminiError: null,
  };
  w.__fintrackE2E = bridge;

  // Another tab of the same context wrote to the store.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORE_KEY) return;
    const before = JSON.stringify(store.auth.currentUser);
    store = fromPersisted(event.newValue);
    scheduleNotify();
    if (JSON.stringify(store.auth.currentUser) !== before) notifyAuth();
  });
};

if (hasWindow) installBridge();

export const bridge = (): E2EBridge | undefined =>
  hasWindow ? ((window as unknown as { __fintrackE2E?: E2EBridge }).__fintrackE2E) : undefined;
