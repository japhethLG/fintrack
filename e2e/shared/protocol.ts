/**
 * Wire format shared by the Node side (helpers/seed.ts, Playwright specs) and
 * the browser side (fakes/core.ts). Pure types + constants — NO imports, so it
 * can be bundled by Next/Turbopack and loaded by Node/Playwright alike.
 */

/** localStorage key under which the whole fake backend is persisted. */
export const STORE_KEY = "__fintrack_e2e_store_v1__";

/** Tag used to encode Firestore Timestamps in JSON. */
export const TIMESTAMP_TAG = "timestamp";

export interface TimestampJSON {
  __type: typeof TIMESTAMP_TAG;
  seconds: number;
  nanoseconds: number;
  /** Informational only (dump() adds it); ignored when loading. */
  iso?: string;
}

/** A plain JSON document. Timestamps are encoded as {@link TimestampJSON}. */
export type DocJSON = Record<string, unknown>;

export interface E2EUser {
  uid: string;
  email: string;
  displayName?: string | null;
  photoURL?: string | null;
}

export interface AuthAccount {
  uid: string;
  /** If set, email sign-in with a different password is rejected. */
  password?: string;
}

export interface AuthConfig {
  /**
   * When set, the matching call rejects with `Error("Firebase: Error (<code>).")`
   * and `.code = <code>`, e.g. "auth/invalid-credential".
   */
  rejectEmailSignIn?: string | null;
  rejectSignUp?: string | null;
  rejectGoogle?: string | null;
  rejectUpdateEmail?: string | null;
  rejectUpdatePassword?: string | null;
  rejectReauth?: string | null;
  rejectDeleteUser?: string | null;
  /** Identity returned by the Google popup. */
  googleUser?: E2EUser;
}

export interface FirestoreFault {
  /** FirestoreError code, e.g. "permission-denied", "unavailable". */
  code: string;
  message?: string;
  /** Restrict to these collections (default: all). */
  collections?: string[];
  /** Number of writes to fail before recovering (default: fail forever). */
  times?: number;
}

/** Everything the fake backend persists. */
export interface PersistedState {
  v: 1;
  /** Identifies which seedAndLogin() call last wrote this state. */
  seedId?: string;
  auth: {
    currentUser: E2EUser | null;
    accounts: Record<string, AuthAccount>; // key: lower-cased email
    config: AuthConfig;
  };
  /** collection path -> doc id -> data */
  collections: Record<string, Record<string, DocJSON>>;
  meta: { autoId: number };
  fault: FirestoreFault | null;
  /** Append-only write log (capped). */
  ops: OpLogEntry[];
}

export interface OpLogEntry {
  op: "set" | "update" | "delete" | "add";
  collection: string;
  id: string;
  data?: DocJSON;
}

/** Input accepted by `window.__fintrackE2E.seed()` (all parts optional). */
export interface SeedState {
  seedId?: string;
  auth?: {
    currentUser?: E2EUser | null;
    accounts?: Record<string, AuthAccount>;
    config?: AuthConfig;
  };
  collections?: Record<string, Record<string, DocJSON>>;
  fault?: FirestoreFault | null;
}

/** Shape of `window.__fintrackE2E`. */
export interface E2EBridge {
  fake: true;
  version: 1;
  seed(state: SeedState): void;
  dump(): { auth: PersistedState["auth"]; collections: Record<string, Record<string, DocJSON>>; ops: OpLogEntry[] };
  reset(): void;
  signIn(user: E2EUser): void;
  signOut(): void;
  configureAuth(config: AuthConfig): void;
  setFault(fault: FirestoreFault | null): void;
  /** Calls made to the stubbed Gemini service (prompt context), oldest first. */
  geminiCalls: unknown[];
  /** Override the text the stubbed analyzeBudget() resolves with. */
  geminiResponse: string | null;
  /** Make the stubbed analyzeBudget() reject/return an error string. */
  geminiError: string | null;
}

export const emptyState = (): PersistedState => ({
  v: 1,
  auth: { currentUser: null, accounts: {}, config: {} },
  collections: {},
  meta: { autoId: 0 },
  fault: null,
  ops: [],
});
