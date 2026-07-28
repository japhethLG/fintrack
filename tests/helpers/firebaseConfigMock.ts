/**
 * Replacement for `app/lib/firebase/config`.
 *
 * The real module calls `initializeApp()` at import time and would need live
 * Firebase credentials. The firestore emulator ignores the `db` handle
 * entirely, so an opaque token is enough.
 */
export const db = { __kind: "fake-firestore" } as never;
export const auth = { __kind: "fake-auth" } as never;
export default { __kind: "fake-app" } as never;
