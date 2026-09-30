/**
 * Fake of the `firebase/auth` surface used by app/lib/firebase/auth.ts.
 * Backed by ./core (persisted in localStorage, so sessions survive reloads).
 *
 * Behaviour:
 *  - email sign-in/sign-up accept any credentials, unless the account has a
 *    `password` (then it must match) or `auth.config.reject*` is set.
 *  - sign-in with an email that matches a seeded account / users profile signs
 *    in as that uid; otherwise a deterministic uid is derived.
 *  - Google popup signs in as `auth.config.googleUser` (default provided).
 */
import {
  accounts,
  addAuthListener,
  authConfig,
  authError,
  getCurrentUser,
  patchCurrentUser,
  registerAccount,
  removeAccount,
  resolveUidByEmail,
  setAccountPassword,
  setCurrentUser,
  type FakeUser,
} from "./core";
import type { FirebaseApp } from "./firebase-app";

export type User = FakeUser;
export type Unsubscribe = () => void;

export interface Auth {
  readonly app: FirebaseApp | null;
  readonly currentUser: FakeUser | null;
}

export interface UserCredential {
  user: FakeUser;
  providerId: string | null;
  operationType: "signIn";
}

const auth: Auth = {
  app: null,
  get currentUser() {
    return getCurrentUser();
  },
};

export const getAuth = (app?: FirebaseApp): Auth => {
  (auth as { app: FirebaseApp | null }).app = app ?? null;
  return auth;
};

export class GoogleAuthProvider {
  static readonly PROVIDER_ID = "google.com";
  readonly providerId = "google.com";
  private scopes: string[] = [];
  addScope(scope: string): this {
    this.scopes.push(scope);
    return this;
  }
  setCustomParameters(): this {
    return this;
  }
  static credential(): { providerId: string } {
    return { providerId: "google.com" };
  }
}

export interface EmailCredential {
  providerId: "password";
  email: string;
  password: string;
}

export class EmailAuthProvider {
  static readonly PROVIDER_ID = "password";
  static credential(email: string, password: string): EmailCredential {
    return { providerId: "password", email, password };
  }
}

const maybeReject = (code: string | null | undefined): void => {
  if (code) throw authError(code);
};

const credentialFor = (): UserCredential => {
  const user = getCurrentUser();
  if (!user) throw authError("auth/internal-error");
  return { user, providerId: null, operationType: "signIn" };
};

export const signInWithEmailAndPassword = async (
  _auth: Auth,
  email: string,
  password: string
): Promise<UserCredential> => {
  maybeReject(authConfig().rejectEmailSignIn);
  const { uid } = resolveUidByEmail(email);
  const acct = accounts()[email.toLowerCase()];
  if (acct?.password !== undefined && acct.password !== password) {
    throw authError("auth/invalid-credential");
  }
  setCurrentUser({ uid, email, displayName: null });
  return credentialFor();
};

export const createUserWithEmailAndPassword = async (
  _auth: Auth,
  email: string,
  password: string
): Promise<UserCredential> => {
  maybeReject(authConfig().rejectSignUp);
  const { uid, known } = resolveUidByEmail(email);
  if (known) throw authError("auth/email-already-in-use");
  // Remember the password so a later sign-in with a wrong one is rejected.
  registerAccount(email, { uid, password });
  setCurrentUser({ uid, email, displayName: null });
  return credentialFor();
};

export const signInWithPopup = async (_auth: Auth, _provider: unknown): Promise<UserCredential> => {
  maybeReject(authConfig().rejectGoogle);
  const g = authConfig().googleUser ?? {
    uid: "e2e-google-user",
    email: "google.user@example.com",
    displayName: "Google User",
  };
  setCurrentUser(g);
  return credentialFor();
};

export const signOut = async (_auth: Auth): Promise<void> => {
  setCurrentUser(null);
};

export const onAuthStateChanged = (
  _auth: Auth,
  callback: (user: FakeUser | null) => void
): Unsubscribe => addAuthListener(callback);

export const deleteUser = async (user: FakeUser): Promise<void> => {
  maybeReject(authConfig().rejectDeleteUser);
  if (user.email) removeAccount(user.email);
  setCurrentUser(null);
};

export const updateEmail = async (user: FakeUser, newEmail: string): Promise<void> => {
  maybeReject(authConfig().rejectUpdateEmail);
  const old = user.email ? accounts()[user.email.toLowerCase()] : undefined;
  if (user.email && old) {
    removeAccount(user.email);
    registerAccount(newEmail, old);
  }
  patchCurrentUser({ email: newEmail });
};

export const updatePassword = async (user: FakeUser, newPassword: string): Promise<void> => {
  maybeReject(authConfig().rejectUpdatePassword);
  if (user.email) setAccountPassword(user.email, newPassword);
};

export const reauthenticateWithCredential = async (
  user: FakeUser,
  credential: EmailCredential
): Promise<UserCredential> => {
  maybeReject(authConfig().rejectReauth);
  const acct = user.email ? accounts()[user.email.toLowerCase()] : undefined;
  if (acct?.password !== undefined && acct.password !== credential.password) {
    throw authError("auth/wrong-password");
  }
  return { user, providerId: null, operationType: "signIn" };
};
