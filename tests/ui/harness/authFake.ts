/**
 * In-memory replacement for the `firebase/auth` SDK.
 *
 * The REAL `AuthProvider` and `app/lib/firebase/auth.ts` run against this fake,
 * so the whole sign-in -> profile-subscription -> financial-subscription chain
 * is exercised. Nothing here can reach the network.
 *
 * Registered for every UI test by `tests/ui/setup.ts`:
 *   vi.mock("firebase/auth", () => import("./harness/authFake"));
 *
 * Test-side controls (all prefixed `__`):
 *   __beforeCall(name, cb)   observe the world at the instant the app makes a call
 *   __setUser(user | null)   emit a new auth state to every listener
 *   __signOutCalls, __calls  observe what the app asked the SDK to do
 *   __failNext(name, error)  make the next call to a fn reject (error paths)
 */
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// User shape
// ---------------------------------------------------------------------------

export interface FakeUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  providerData: unknown[];
  getIdToken: () => Promise<string>;
}

export const makeFakeUser = (overrides: Partial<FakeUser> = {}): FakeUser => ({
  uid: "user-1",
  email: "test@example.com",
  displayName: "Test User",
  photoURL: null,
  emailVerified: true,
  isAnonymous: false,
  providerData: [],
  getIdToken: async () => "fake-id-token",
  ...overrides,
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type AuthCallback = (user: FakeUser | null) => void;

let currentUser: FakeUser | null = null;
const listeners = new Set<AuthCallback>();

/** Every SDK call the app made, in order — `{ fn, args }`. */
export const __calls: { fn: string; args: unknown[] }[] = [];
const failures = new Map<string, Error>();

/** The user the fake SDK currently reports (what `auth.currentUser` returns). */
export const __getCurrentUser = (): FakeUser | null => currentUser;

/**
 * Change the signed-in user and notify every `onAuthStateChanged` listener.
 * Emission is asynchronous (a microtask), like the real SDK, so callers should
 * wrap it in `act(async () => …)` when the tree is already mounted.
 */
export const __setUser = (user: FakeUser | null): void => {
  currentUser = user;
  listeners.forEach((cb) => Promise.resolve().then(() => cb(currentUser)));
};

/** Reset user, listeners, call log and queued failures. */
export const __reset = (): void => {
  currentUser = null;
  listeners.clear();
  __calls.length = 0;
  failures.clear();
  beforeCall.clear();
};

/** Make the next call to `fn` (e.g. "signInWithEmailAndPassword") reject. */
export const __failNext = (fn: string, error: Error): void => {
  failures.set(fn, error);
};

export const __callsTo = (fn: string) => __calls.filter((c) => c.fn === fn);

const beforeCall = new Map<string, () => void>();

/**
 * Run `cb` the moment the app calls `fn` (before any queued failure is applied), once. Lets a test observe
 * the state of OTHER fakes (e.g. the data store) at the instant an auth call is made, which is how the
 * delete-account ORDER is proven.
 */
export const __beforeCall = (fn: string, cb: () => void): void => {
  beforeCall.set(fn, cb);
};

const record = async (fn: string, args: unknown[]): Promise<void> => {
  __calls.push({ fn, args });
  const hook = beforeCall.get(fn);
  if (hook) {
    beforeCall.delete(fn);
    hook();
  }
  const failure = failures.get(fn);
  if (failure) {
    failures.delete(fn);
    throw failure;
  }
};

// ---------------------------------------------------------------------------
// SDK surface used by app/lib/firebase/auth.ts
// ---------------------------------------------------------------------------

export const getAuth = () => authHandle;

/** Auth handle. `currentUser` is live so `auth.currentUser` reads work. */
export const authHandle = {
  __kind: "fake-auth",
  get currentUser() {
    return currentUser;
  },
};

export const onAuthStateChanged = (_auth: unknown, callback: AuthCallback): (() => void) => {
  listeners.add(callback);
  // The real SDK emits the initial state asynchronously.
  Promise.resolve().then(() => {
    if (listeners.has(callback)) callback(currentUser);
  });
  return () => {
    listeners.delete(callback);
  };
};

export const signInWithEmailAndPassword = vi.fn(async (_a: unknown, email: string, pw: string) => {
  await record("signInWithEmailAndPassword", [email, pw]);
  const user = makeFakeUser({ email, displayName: email.split("@")[0] });
  __setUser(user);
  return { user };
});

export const createUserWithEmailAndPassword = vi.fn(
  async (_a: unknown, email: string, pw: string) => {
    await record("createUserWithEmailAndPassword", [email, pw]);
    const user = makeFakeUser({ uid: "new-user", email, displayName: null });
    __setUser(user);
    return { user };
  }
);

export const signInWithPopup = vi.fn(async (_a: unknown, provider: unknown) => {
  await record("signInWithPopup", [provider]);
  const user = makeFakeUser({
    uid: "google-user",
    email: "google@example.com",
    providerData: [{ providerId: "google.com" }],
  });
  __setUser(user);
  return { user };
});

export const signOut = vi.fn(async (_a: unknown) => {
  await record("signOut", []);
  __setUser(null);
});

export const deleteUser = vi.fn(async (user: unknown) => {
  await record("deleteUser", [user]);
  __setUser(null);
});

export const updateEmail = vi.fn(async (_user: unknown, email: string) => {
  await record("updateEmail", [email]);
});

export const updatePassword = vi.fn(async (_user: unknown, password: string) => {
  await record("updatePassword", [password]);
});

export const reauthenticateWithCredential = vi.fn(async (_user: unknown, credential: unknown) => {
  await record("reauthenticateWithCredential", [credential]);
});

/** Reauthentication with the Google popup (what a Google-only user does instead of typing a password). */
export const reauthenticateWithPopup = vi.fn(async (_user: unknown, provider: unknown) => {
  await record("reauthenticateWithPopup", [provider]);
});

export class GoogleAuthProvider {
  static PROVIDER_ID = "google.com";
}

export const EmailAuthProvider = {
  PROVIDER_ID: "password",
  credential: (email: string, password: string) => ({ providerId: "password", email, password }),
};
