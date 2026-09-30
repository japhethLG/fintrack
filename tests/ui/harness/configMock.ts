/**
 * Replacement for `app/lib/firebase/config` in UI tests.
 *
 * The real module calls `initializeApp()` with credentials from `.env.local`;
 * it must NEVER execute under test. `db` is the same opaque token the
 * logic-layer suite uses (the Firestore emulator ignores it). `auth` is the
 * fake auth handle, whose `currentUser` tracks `__setUser`.
 */
import { db as sharedDb } from "../../helpers/firebaseConfigMock";
import { authHandle } from "./authFake";

export const db = sharedDb;
export const auth = authHandle as never;
export default { __kind: "fake-app" } as never;
