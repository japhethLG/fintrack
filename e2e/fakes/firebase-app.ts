/**
 * Fake of the `firebase/app` surface used by app/lib/firebase/config.ts.
 * Importing core has the side effect of installing window.__fintrackE2E and
 * window.__FINTRACK_FAKE_FIREBASE__.
 */
import "./core";

export interface FirebaseOptions {
  [key: string]: unknown;
}

export interface FirebaseApp {
  readonly name: string;
  readonly options: FirebaseOptions;
  readonly automaticDataCollectionEnabled: boolean;
}

const apps = new Map<string, FirebaseApp>();

export const initializeApp = (options: FirebaseOptions = {}, name = "[DEFAULT]"): FirebaseApp => {
  const existing = apps.get(name);
  if (existing) return existing;
  const app: FirebaseApp = { name, options, automaticDataCollectionEnabled: false };
  apps.set(name, app);
  return app;
};

export const getApps = (): FirebaseApp[] => Array.from(apps.values());

export const getApp = (name = "[DEFAULT]"): FirebaseApp => {
  const app = apps.get(name);
  if (!app) throw new Error(`No Firebase App '${name}' has been created (fake).`);
  return app;
};
