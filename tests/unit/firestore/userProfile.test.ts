import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => import("../../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../../helpers/firebaseConfigMock"));

import type { UserProfile } from "@/lib/types";
import {
  adjustUserBalance,
  createUserProfile,
  deleteUserProfile,
  getUserProfile,
  subscribeToUserProfile,
  updateUserBalance,
  updateUserProfile,
} from "@/lib/firebase/firestore/users";
import * as store from "../../helpers/firestoreEmulator";
import { makeUserProfile } from "../../helpers/builders";
import { freezeAt, freezeToday } from "../../helpers/time";

/**
 * The user profile layer — `currentBalance` lives here, so every mutation path
 * in the app eventually writes through these functions.
 *
 * The balance-arithmetic paths (adjustUserBalance under complete/skip/revert)
 * are covered end to end in tests/integration/actualMutation.firestore.test.ts.
 * This file covers the profile functions directly, including the branches those
 * integration paths never reach: the returning-user branch of
 * createUserProfile, the missing-document guards, the real-time subscription,
 * and the dynamic-import delete.
 */

const UID = "user-1";
const profile = (): UserProfile | undefined => store.__get<UserProfile>("users", UID);

beforeEach(() => {
  store.__reset();
  freezeToday("2026-03-15");
});

// ============================================================================
// createUserProfile
// ============================================================================

describe("createUserProfile", () => {
  it("creates a profile with zeroed balances and the default preferences", async () => {
    const created = await createUserProfile(UID, "new@example.com", "New User");

    expect(created).toMatchObject({
      uid: UID,
      email: "new@example.com",
      displayName: "New User",
      currentBalance: 0,
      initialBalance: 0,
      balanceLastUpdatedAt: "2026-03-15",
      preferences: {
        currency: "PHP",
        dateFormat: "MM/DD/YYYY",
        startOfWeek: 0,
        theme: "dark",
        defaultWarningThreshold: 500,
      },
    });
    expect(profile()?.uid).toBe(UID);
  });

  it("stamps createdAt and updatedAt with the same timestamp", async () => {
    const created = await createUserProfile(UID, "new@example.com", "New User");

    expect(created.createdAt).toEqual(created.updatedAt);
  });

  /**
   * The branch that protects a returning user. AuthContext calls this on every
   * sign-in, so overwriting here would reset a real balance to 0 on each login.
   */
  it("returns the existing profile untouched for a returning user", async () => {
    store.__seed("users", UID, makeUserProfile({ uid: UID, currentBalance: 7_432.19 }));

    const returned = await createUserProfile(UID, "different@example.com", "Different Name");

    expect(returned.currentBalance).toBe(7_432.19);
    // The stored email/name win over the arguments — nothing is overwritten.
    expect(returned.email).toBe("test@example.com");
    expect(returned.displayName).toBe("Test User");
    expect(profile()?.currentBalance).toBe(7_432.19);
  });

  it("writes nothing at all for a returning user", async () => {
    store.__seed("users", UID, makeUserProfile({ uid: UID, currentBalance: 500 }));

    await createUserProfile(UID, "new@example.com", "New User");

    expect(store.__opsFor("users")).toEqual([]);
  });

  it("is safe to call repeatedly, as the login flow does", async () => {
    const first = await createUserProfile(UID, "a@example.com", "A");
    await adjustUserBalance(UID, 250);
    const second = await createUserProfile(UID, "a@example.com", "A");
    const third = await createUserProfile(UID, "a@example.com", "A");

    expect(first.currentBalance).toBe(0);
    expect(second.currentBalance).toBe(250);
    expect(third.currentBalance).toBe(250);
    expect(store.__count("users")).toBe(1);
  });
});

// ============================================================================
// getUserProfile
// ============================================================================

describe("getUserProfile", () => {
  it("returns the stored profile", async () => {
    store.__seed("users", UID, makeUserProfile({ uid: UID, currentBalance: 1_234 }));

    expect((await getUserProfile(UID))?.currentBalance).toBe(1_234);
  });

  it("returns null for an unknown user rather than throwing", async () => {
    expect(await getUserProfile("nobody")).toBeNull();
  });

  it("reads the uid from the document body, not the document id", async () => {
    // getUserProfile returns snapshot.data() with no id merge (users.ts:55), so
    // the uid field must be present in the stored document. Any fixture that
    // omits it would produce a profile with an undefined uid.
    store.__seed("users", UID, makeUserProfile({ uid: UID }));

    expect((await getUserProfile(UID))?.uid).toBe(UID);
  });
});

// ============================================================================
// updateUserProfile
// ============================================================================

describe("updateUserProfile", () => {
  beforeEach(() => {
    store.__seed("users", UID, makeUserProfile({ uid: UID }));
  });

  it("applies the given fields and leaves the rest intact", async () => {
    await updateUserProfile(UID, { displayName: "Renamed" });

    expect(profile()?.displayName).toBe("Renamed");
    expect(profile()?.email).toBe("test@example.com");
    expect(profile()?.currentBalance).toBe(10_000);
  });

  it("updates initialBalance, the field the settings screen edits", async () => {
    await updateUserProfile(UID, { initialBalance: 2_500 });

    expect(profile()?.initialBalance).toBe(2_500);
    // currentBalance is NOT recomputed here — reconciliation owns that.
    expect(profile()?.currentBalance).toBe(10_000);
  });

  it("replaces the preferences object wholesale rather than merging it", async () => {
    // Worth pinning: callers must spread the existing preferences themselves or
    // they will drop the fields they omit.
    await updateUserProfile(UID, {
      preferences: {
        currency: "USD",
        dateFormat: "YYYY-MM-DD",
        startOfWeek: 1,
        theme: "light",
        defaultWarningThreshold: 1_000,
      },
    });

    expect(profile()?.preferences).toEqual({
      currency: "USD",
      dateFormat: "YYYY-MM-DD",
      startOfWeek: 1,
      theme: "light",
      defaultWarningThreshold: 1_000,
    });
  });

  it("strips undefined values before writing", async () => {
    await updateUserProfile(UID, { displayName: undefined, email: "kept@example.com" });

    expect(profile()?.displayName).toBe("Test User");
    expect(profile()?.email).toBe("kept@example.com");
  });

  it("stamps updatedAt", async () => {
    const before = profile()?.updatedAt;

    await updateUserProfile(UID, { displayName: "Renamed" });

    expect(profile()?.updatedAt).not.toEqual(before);
  });

  it("throws for a profile that does not exist", async () => {
    await expect(updateUserProfile("nobody", { displayName: "X" })).rejects.toThrow(
      "User profile with ID nobody does not exist"
    );
  });
});

// ============================================================================
// updateUserBalance
// ============================================================================

describe("updateUserBalance", () => {
  beforeEach(() => {
    store.__seed("users", UID, makeUserProfile({ uid: UID, currentBalance: 1_000 }));
  });

  it("sets the balance and stamps the date it changed", async () => {
    await updateUserBalance(UID, 1_750.25);

    expect(profile()?.currentBalance).toBe(1_750.25);
    expect(profile()?.balanceLastUpdatedAt).toBe("2026-03-15");
  });

  it("accepts a negative balance", async () => {
    await updateUserBalance(UID, -320.5);

    expect(profile()?.currentBalance).toBe(-320.5);
  });

  it("accepts zero", async () => {
    await updateUserBalance(UID, 0);

    expect(profile()?.currentBalance).toBe(0);
  });

  it("throws for a profile that does not exist", async () => {
    await expect(updateUserBalance("nobody", 100)).rejects.toThrow(
      "User profile with ID nobody does not exist"
    );
  });

  it("does not write when the profile is missing", async () => {
    await expect(updateUserBalance("nobody", 100)).rejects.toThrow();

    expect(store.__opsFor("users")).toEqual([]);
  });

  it("stamps the date from the local clock, not the UTC day", async () => {
    // users.ts:93 uses new Date().toISOString().split("T")[0]. Under TZ=UTC the
    // two agree; tests/timezone/offsets.test.ts covers the offset case where
    // they do not.
    freezeAt("2026-03-15", 23);

    await updateUserBalance(UID, 42);

    expect(profile()?.balanceLastUpdatedAt).toBe("2026-03-15");
  });
});

// ============================================================================
// adjustUserBalance
// ============================================================================

describe("adjustUserBalance", () => {
  beforeEach(() => {
    store.__seed("users", UID, makeUserProfile({ uid: UID, currentBalance: 1_000 }));
  });

  it("adds a positive delta and returns the new balance", async () => {
    await expect(adjustUserBalance(UID, 250)).resolves.toBe(1_250);
    expect(profile()?.currentBalance).toBe(1_250);
  });

  it("subtracts a negative delta", async () => {
    await expect(adjustUserBalance(UID, -400)).resolves.toBe(600);
  });

  it("accumulates across successive calls", async () => {
    await adjustUserBalance(UID, 100);
    await adjustUserBalance(UID, -30);
    await adjustUserBalance(UID, 5.5);

    expect(profile()?.currentBalance).toBe(1_075.5);
  });

  it("treats a zero delta as a no-op on the value", async () => {
    await expect(adjustUserBalance(UID, 0)).resolves.toBe(1_000);
  });

  it("throws for a missing profile", async () => {
    await expect(adjustUserBalance("nobody", 100)).rejects.toThrow("User profile not found");
  });
});

// ============================================================================
// subscribeToUserProfile
// ============================================================================

describe("subscribeToUserProfile", () => {
  it("emits the current profile immediately", () => {
    store.__seed("users", UID, makeUserProfile({ uid: UID, currentBalance: 900 }));
    const seen: (UserProfile | null)[] = [];

    const unsubscribe = subscribeToUserProfile(UID, (p) => seen.push(p));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.currentBalance).toBe(900);
    unsubscribe();
  });

  it("emits null when the profile does not exist", () => {
    const seen: (UserProfile | null)[] = [];

    const unsubscribe = subscribeToUserProfile("nobody", (p) => seen.push(p));

    expect(seen).toEqual([null]);
    unsubscribe();
  });

  it("re-emits after a balance change", async () => {
    store.__seed("users", UID, makeUserProfile({ uid: UID, currentBalance: 1_000 }));
    const seen: (UserProfile | null)[] = [];
    const unsubscribe = subscribeToUserProfile(UID, (p) => seen.push(p));

    await adjustUserBalance(UID, -250);

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[seen.length - 1]?.currentBalance).toBe(750);
    unsubscribe();
  });

  it("emits null once the profile is deleted", async () => {
    store.__seed("users", UID, makeUserProfile({ uid: UID }));
    const seen: (UserProfile | null)[] = [];
    const unsubscribe = subscribeToUserProfile(UID, (p) => seen.push(p));

    await deleteUserProfile(UID);

    expect(seen[seen.length - 1]).toBeNull();
    unsubscribe();
  });

  it("stops emitting after unsubscribe", async () => {
    store.__seed("users", UID, makeUserProfile({ uid: UID, currentBalance: 1_000 }));
    const seen: (UserProfile | null)[] = [];
    const unsubscribe = subscribeToUserProfile(UID, (p) => seen.push(p));
    const countAtUnsubscribe = seen.length;

    unsubscribe();
    await adjustUserBalance(UID, 500);

    expect(seen).toHaveLength(countAtUnsubscribe);
  });

  it("does not emit another user's profile", async () => {
    store.__seed("users", UID, makeUserProfile({ uid: UID, currentBalance: 1_000 }));
    store.__seed("users", "user-2", makeUserProfile({ uid: "user-2", currentBalance: 55 }));
    const seen: (UserProfile | null)[] = [];
    const unsubscribe = subscribeToUserProfile(UID, (p) => seen.push(p));

    await adjustUserBalance("user-2", 10);

    expect(seen.every((p) => p === null || p.uid === UID)).toBe(true);
    unsubscribe();
  });
});

// ============================================================================
// deleteUserProfile
// ============================================================================

describe("deleteUserProfile", () => {
  it("removes the profile document", async () => {
    store.__seed("users", UID, makeUserProfile({ uid: UID }));

    await deleteUserProfile(UID);

    expect(profile()).toBeUndefined();
    expect(await getUserProfile(UID)).toBeNull();
  });

  it("resolves the dynamic firebase/firestore import through the same mock", async () => {
    // users.ts:126 imports deleteDoc dynamically rather than at module scope.
    // This test exists to prove the hoisted vi.mock applies to dynamic imports
    // too — if it did not, this would hit the real SDK and fail on credentials.
    store.__seed("users", UID, makeUserProfile({ uid: UID }));

    await expect(deleteUserProfile(UID)).resolves.toBeUndefined();
    expect(store.__opsFor("users").at(-1)).toMatchObject({ op: "delete", id: UID });
  });

  it("is a no-op for a profile that does not exist", async () => {
    await expect(deleteUserProfile("nobody")).resolves.toBeUndefined();
  });

  it("leaves other users' profiles alone", async () => {
    store.__seed("users", UID, makeUserProfile({ uid: UID }));
    store.__seed("users", "user-2", makeUserProfile({ uid: "user-2", currentBalance: 77 }));

    await deleteUserProfile(UID);

    expect(store.__get<UserProfile>("users", "user-2")?.currentBalance).toBe(77);
  });
});
