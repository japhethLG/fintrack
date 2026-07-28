import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => import("../../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../../helpers/firebaseConfigMock"));

import type { Alert, BalanceSnapshot } from "@/lib/types";
import {
  createAlert,
  dismissAlert,
  getAlerts,
  markAlertAsRead,
  subscribeToAlerts,
} from "@/lib/firebase/firestore/alerts";
import {
  getBalanceHistory,
  getBalanceSnapshot,
  saveBalanceSnapshot,
} from "@/lib/firebase/firestore/balanceHistory";
import * as store from "../../helpers/firestoreEmulator";
import { makeAlert, makeBalanceSnapshot } from "../../helpers/builders";
import { d } from "../../helpers/dates";
import { freezeToday } from "../../helpers/time";

/**
 * THEME: `app/lib/firebase/firestore/alerts.ts` and
 * `app/lib/firebase/firestore/balanceHistory.ts` — the two firestore modules
 * that had no coverage at all. The real repo code runs against the in-memory
 * firestore emulator, so every assertion below is about the query the module
 * actually builds and the document it actually writes.
 *
 * Two things a reader should know before trusting these behaviours in the app:
 *
 *  1. NOTHING IN `app/` EVER CALLS `createAlert`. The only callers of this
 *     module are read/write-through paths: `subscribeToAlerts`
 *     (app/contexts/FinancialContext/hooks/useFinancialSubscriptions.ts:83),
 *     `getAlerts` (…/hooks/useFinancialActions.ts:296) and
 *     `markAlertAsRead`/`dismissAlert` (…/actions/alertActions.ts:7,14).
 *     No production code produces an alert document, so the alert list is
 *     permanently empty in the shipped app and the read/dismiss paths tested
 *     here are currently unreachable in practice.
 *  2. NOTHING IN `app/` EVER CALLS `saveBalanceSnapshot` OR `getBalanceHistory`
 *     either (verified by grep; `balance_history` appears in `app/` only in this
 *     module, in the delete lists of migrations.ts:71 and in
 *     SelectiveResetModal). The `balance_history` collection is therefore never
 *     populated, which makes the reconciliation/history features inert: they can
 *     only ever read back an empty collection. That is surfaced here rather than
 *     hidden because the tests below prove the storage layer works — the gap is
 *     the missing caller, not the code in these two files.
 *
 * HELPER GAP (worked around locally, see `seedAlertAt`): the shared emulator
 * compares non-numeric field values with `String(a).localeCompare(String(b))`
 * (tests/helpers/firestoreEmulator.ts:243), and a Timestamp stringifies to
 * "[object Object]". `orderBy("createdAt", …)` is therefore a silent no-op for
 * Timestamp fields, so ordering/limit tests seed `createdAt` as epoch millis to
 * make the module's real `orderBy` constraint observable. Tests that do not care
 * about order use the ordinary `makeAlert` Timestamp and assert set membership.
 */

const TODAY = "2026-03-15";
const BASE_MILLIS = d("2026-03-01").getTime();

type AlertInput = Omit<Alert, "id" | "userId" | "createdAt" | "isRead" | "isDismissed">;
type SnapshotInput = Omit<BalanceSnapshot, "id" | "userId" | "createdAt">;

/** The exact argument shape `createAlert` takes, derived from the shared builder. */
const alertInput = (overrides: Partial<Alert> = {}): AlertInput => {
  const { id, userId, createdAt, isRead, isDismissed, ...input } = makeAlert(overrides);
  return input;
};

/** The exact argument shape `saveBalanceSnapshot` takes. */
const snapshotInput = (overrides: Partial<BalanceSnapshot> = {}): SnapshotInput => {
  const { id, userId, createdAt, ...input } = makeBalanceSnapshot(overrides);
  return input;
};

/**
 * Seed an alert whose `createdAt` is stored as epoch millis rather than a
 * Timestamp, so the emulator can actually apply the module's
 * `orderBy("createdAt", "desc")`. See HELPER GAP above.
 */
const seedAlertAt = (id: string, millis: number, overrides: Partial<Alert> = {}): void => {
  const { createdAt, ...rest } = makeAlert({ id, ...overrides });
  store.__seed("alerts", id, { ...rest, createdAt: millis });
};

/** Read a document back, failing with an assertion (never a crash) if it is gone. */
const readDoc = <T>(collectionName: string, id: string): T => {
  const found = store.__get<T>(collectionName, id);
  expect(found).toBeDefined();
  return found as T;
};

/**
 * Move the already-frozen clock to another calendar day.
 *
 * HELPER GAP: calling `freezeToday()` a second time inside one test does NOT
 * move the clock — `vi.useFakeTimers()` ignores its `now` option when fake
 * timers are already installed, so the second call silently leaves the clock at
 * the first frozen instant. That is a live trap for any test that needs two
 * distinct write timestamps (it made the stale-createdAt defect test below fail
 * for the wrong reason before this helper existed). `vi.setSystemTime` is the
 * API that actually re-points an installed fake clock; tests/helpers/time.ts has
 * no wrapper for it.
 */
const advanceClockTo = (ymd: string): void => {
  vi.setSystemTime(d(ymd));
};

/** Index into a result list, asserting the length first so a shrunken list fails, not throws. */
const rowAt = <T>(rows: T[], index: number): T => {
  expect(rows.length).toBeGreaterThan(index);
  return rows[index] as T;
};

beforeEach(() => {
  store.__reset();
  freezeToday(TODAY);
});

// ============================================================================
// ALERTS — createAlert
// ============================================================================

describe("createAlert", () => {
  it("persists the alert under the owning user, stamped with the current clock", async () => {
    const created = await createAlert(
      "user-1",
      alertInput({
        type: "payment_due",
        severity: "danger",
        title: "Visa payment due",
        message: "Your Visa minimum is due tomorrow.",
      })
    );

    expect(store.__count("alerts")).toBe(1);
    const stored = readDoc<Alert>("alerts", created.id);
    expect(stored).toMatchObject({
      userId: "user-1",
      type: "payment_due",
      severity: "danger",
      title: "Visa payment due",
      message: "Your Visa minimum is due tomorrow.",
    });
    expect(stored.createdAt.toMillis()).toBe(d(TODAY).getTime());
  });

  it("defaults isRead and isDismissed to false in the written document", async () => {
    const created = await createAlert("user-1", alertInput());

    const stored = readDoc<Alert>("alerts", created.id);
    expect(stored.isRead).toBe(false);
    expect(stored.isDismissed).toBe(false);
  });

  it("returns an entity identical to the document it just wrote", async () => {
    const created = await createAlert("user-1", alertInput({ title: "Round trip" }));

    // Read as Omit<…, "id">: the stored document carries no `id` field of its
    // own — the id lives on the document reference and is merged in on read.
    const stored = readDoc<Omit<Alert, "id">>("alerts", created.id);
    expect({ id: created.id, ...stored }).toEqual(created);
    expect(created.isRead).toBe(false);
    expect(created.isDismissed).toBe(false);
    expect(created.userId).toBe("user-1");
  });

  it("omits absent optional fields rather than writing undefined", async () => {
    // removeUndefined (firestore/utils.ts:10) runs before the write because
    // firestore rejects explicit undefined values.
    const created = await createAlert("user-1", {
      type: "low_balance",
      severity: "info",
      title: "Heads up",
      message: "Balance is dipping.",
      actionText: undefined,
      actionUrl: undefined,
    });

    const stored = readDoc<Alert>("alerts", created.id);
    expect("actionText" in stored).toBe(false);
    expect("actionUrl" in stored).toBe(false);
    expect(Object.keys(stored).sort()).toEqual([
      "createdAt",
      "isDismissed",
      "isRead",
      "message",
      "severity",
      "title",
      "type",
      "userId",
    ]);
  });

  it("keeps actionText and actionUrl when they are supplied", async () => {
    const created = await createAlert(
      "user-1",
      alertInput({ actionText: "Review", actionUrl: "/transactions" })
    );

    const stored = readDoc<Alert>("alerts", created.id);
    expect(stored.actionText).toBe("Review");
    expect(stored.actionUrl).toBe("/transactions");
    expect(created.actionText).toBe("Review");
    expect(created.actionUrl).toBe("/transactions");
  });

  it("writes exactly one add op, to the alerts collection", async () => {
    await createAlert("user-1", alertInput());

    expect(store.__ops).toHaveLength(1);
    expect(store.__opsFor("alerts")).toHaveLength(1);
    expect(rowAt(store.__opsFor("alerts"), 0).op).toBe("add");
  });

  it("gives each alert its own document, even for identical content", async () => {
    const first = await createAlert("user-1", alertInput());
    const second = await createAlert("user-1", alertInput());

    expect(first.id).not.toBe(second.id);
    expect(store.__count("alerts")).toBe(2);
  });
});

// ============================================================================
// ALERTS — getAlerts
// ============================================================================

describe("getAlerts", () => {
  it("returns only the requested user's alerts", async () => {
    store.__seedEntities("alerts", [
      makeAlert({ id: "a1", userId: "user-1" }),
      makeAlert({ id: "a2", userId: "user-2" }),
      makeAlert({ id: "a3", userId: "user-1" }),
    ]);

    const alerts = await getAlerts("user-1");

    expect([...alerts.map((alert) => alert.id)].sort()).toEqual(["a1", "a3"]);
    expect(alerts.every((alert) => alert.userId === "user-1")).toBe(true);
  });

  it("excludes dismissed alerts — there is no way to list them", async () => {
    // alerts.ts:52 hard-codes where("isDismissed", "==", false); the options
    // object offers no escape hatch, so a dismissed alert is gone for good.
    store.__seedEntities("alerts", [
      makeAlert({ id: "live", isDismissed: false }),
      makeAlert({ id: "dismissed", isDismissed: true }),
    ]);

    const alerts = await getAlerts("user-1");

    expect(alerts.map((alert) => alert.id)).toEqual(["live"]);
  });

  it("includes read alerts by default", async () => {
    store.__seedEntities("alerts", [
      makeAlert({ id: "read", isRead: true }),
      makeAlert({ id: "unread", isRead: false }),
    ]);

    const alerts = await getAlerts("user-1");

    expect([...alerts.map((alert) => alert.id)].sort()).toEqual(["read", "unread"]);
  });

  it("orders newest first by createdAt", async () => {
    seedAlertAt("oldest", BASE_MILLIS);
    seedAlertAt("newest", BASE_MILLIS + 2_000);
    seedAlertAt("middle", BASE_MILLIS + 1_000);

    const alerts = await getAlerts("user-1");

    expect(alerts.map((alert) => alert.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("applies the limit after ordering, keeping the newest N", async () => {
    seedAlertAt("a1", BASE_MILLIS + 1_000);
    seedAlertAt("a2", BASE_MILLIS + 2_000);
    seedAlertAt("a3", BASE_MILLIS + 3_000);
    seedAlertAt("a4", BASE_MILLIS + 4_000);

    const alerts = await getAlerts("user-1", { limit: 2 });

    expect(alerts.map((alert) => alert.id)).toEqual(["a4", "a3"]);
  });

  it("treats limit: 0 as no limit at all", async () => {
    // alerts.ts:59 guards with `if (options?.limit)`, and 0 is falsy, so no
    // limit constraint is added and the caller gets EVERY alert rather than
    // none. Pinned as-is: the real SDK rejects limit(0) outright, so the guard
    // prevents an SDK error — the surprise is only that 0 means "unlimited".
    seedAlertAt("a1", BASE_MILLIS + 1_000);
    seedAlertAt("a2", BASE_MILLIS + 2_000);

    const alerts = await getAlerts("user-1", { limit: 0 });

    expect(alerts.map((alert) => alert.id)).toEqual(["a2", "a1"]);
  });

  it("filters to unread alerts when unreadOnly is set, still excluding dismissed", async () => {
    store.__seedEntities("alerts", [
      makeAlert({ id: "unread", isRead: false, isDismissed: false }),
      makeAlert({ id: "read", isRead: true, isDismissed: false }),
      makeAlert({ id: "unread-dismissed", isRead: false, isDismissed: true }),
    ]);

    const alerts = await getAlerts("user-1", { unreadOnly: true });

    expect(alerts.map((alert) => alert.id)).toEqual(["unread"]);
  });

  it("combines unreadOnly with limit", async () => {
    seedAlertAt("u1", BASE_MILLIS + 1_000, { isRead: false });
    seedAlertAt("r1", BASE_MILLIS + 2_000, { isRead: true });
    seedAlertAt("u2", BASE_MILLIS + 3_000, { isRead: false });

    const alerts = await getAlerts("user-1", { unreadOnly: true, limit: 1 });

    expect(alerts.map((alert) => alert.id)).toEqual(["u2"]);
  });

  it("returns an empty array for a user with no alerts", async () => {
    const alerts = await getAlerts("user-1");

    expect(alerts).toEqual([]);
  });

  it("returns an empty array for an unknown user even when other users have alerts", async () => {
    store.__seedEntities("alerts", [
      makeAlert({ id: "a1", userId: "user-1" }),
      makeAlert({ id: "a2", userId: "user-2" }),
    ]);

    const alerts = await getAlerts("nobody");

    expect(alerts).toEqual([]);
  });

  it("skips documents that carry no isDismissed field", async () => {
    // Equality filters exclude documents missing the field, in real firestore
    // as here — so any future server-side alert writer MUST set isDismissed or
    // its alerts will be invisible to both getAlerts and subscribeToAlerts.
    const { isDismissed, ...withoutFlag } = makeAlert({ id: "legacy" });
    store.__seed("alerts", "legacy", withoutFlag);
    store.__seedEntities("alerts", [makeAlert({ id: "modern" })]);

    const alerts = await getAlerts("user-1");

    expect(alerts.map((alert) => alert.id)).toEqual(["modern"]);
  });

  it("merges the document id into each returned alert", async () => {
    store.__seed("alerts", "doc-id-42", { ...alertInput(), userId: "user-1", isDismissed: false });

    const alerts = await getAlerts("user-1");

    expect(rowAt(alerts, 0).id).toBe("doc-id-42");
  });
});

// ============================================================================
// ALERTS — markAlertAsRead
// ============================================================================

describe("markAlertAsRead", () => {
  it("sets isRead and leaves every other field untouched", async () => {
    store.__seedEntities("alerts", [
      makeAlert({ id: "a1", actionText: "Review", actionUrl: "/x", isRead: false }),
    ]);
    const before = readDoc<Alert>("alerts", "a1");

    await markAlertAsRead("a1");

    expect(readDoc<Alert>("alerts", "a1")).toEqual({ ...before, isRead: true });
  });

  it("is idempotent for an already-read alert", async () => {
    store.__seedEntities("alerts", [makeAlert({ id: "a1", isRead: true })]);

    await markAlertAsRead("a1");

    expect(readDoc<Alert>("alerts", "a1").isRead).toBe(true);
  });

  it("does not disturb the user's other alerts", async () => {
    store.__seedEntities("alerts", [makeAlert({ id: "a1" }), makeAlert({ id: "a2" })]);
    const untouched = readDoc<Alert>("alerts", "a2");

    await markAlertAsRead("a1");

    expect(readDoc<Alert>("alerts", "a2")).toEqual(untouched);
    expect(store.__opsFor("alerts")).toHaveLength(1);
    expect(rowAt(store.__opsFor("alerts"), 0).id).toBe("a1");
  });

  it("rejects for a missing document and writes nothing", async () => {
    await expect(markAlertAsRead("ghost")).rejects.toThrow("Alert with ID ghost does not exist");

    expect(store.__ops).toHaveLength(0);
  });

  it("performs no ownership check — any alert id can be marked read", async () => {
    // markAlertAsRead(id) has no userId parameter (alerts.ts:68), so isolation
    // between users depends entirely on firestore security rules, not on this
    // client code. Pinned so a future signature change is a deliberate one.
    store.__seedEntities("alerts", [makeAlert({ id: "theirs", userId: "user-2" })]);

    await markAlertAsRead("theirs");

    expect(readDoc<Alert>("alerts", "theirs").isRead).toBe(true);
  });
});

// ============================================================================
// ALERTS — dismissAlert
// ============================================================================

describe("dismissAlert", () => {
  it("sets isDismissed and leaves isRead alone", async () => {
    store.__seedEntities("alerts", [makeAlert({ id: "a1", isRead: false, isDismissed: false })]);
    const before = readDoc<Alert>("alerts", "a1");

    await dismissAlert("a1");

    expect(readDoc<Alert>("alerts", "a1")).toEqual({ ...before, isDismissed: true });
  });

  it("is a soft delete — the document survives", async () => {
    store.__seedEntities("alerts", [makeAlert({ id: "a1" })]);

    await dismissAlert("a1");

    expect(store.__count("alerts")).toBe(1);
    expect(store.__get("alerts", "a1")).toBeDefined();
  });

  it("removes the alert from subsequent getAlerts results", async () => {
    store.__seedEntities("alerts", [makeAlert({ id: "a1" }), makeAlert({ id: "a2" })]);
    expect((await getAlerts("user-1")).map((alert) => alert.id).sort()).toEqual(["a1", "a2"]);

    await dismissAlert("a1");

    expect((await getAlerts("user-1")).map((alert) => alert.id)).toEqual(["a2"]);
  });

  it("also hides the alert from an unreadOnly query", async () => {
    store.__seedEntities("alerts", [makeAlert({ id: "a1", isRead: false })]);

    await dismissAlert("a1");

    expect(await getAlerts("user-1", { unreadOnly: true })).toEqual([]);
  });

  it("rejects for a missing document and writes nothing", async () => {
    await expect(dismissAlert("ghost")).rejects.toThrow("Alert with ID ghost does not exist");

    expect(store.__ops).toHaveLength(0);
  });
});

// ============================================================================
// ALERTS — subscribeToAlerts
// ============================================================================

describe("subscribeToAlerts", () => {
  it("emits immediately with the user's current undismissed alerts, newest first", () => {
    seedAlertAt("older", BASE_MILLIS + 1_000);
    seedAlertAt("newer", BASE_MILLIS + 2_000);
    seedAlertAt("gone", BASE_MILLIS + 3_000, { isDismissed: true });
    const emissions: Alert[][] = [];

    const unsubscribe = subscribeToAlerts("user-1", (alerts) => emissions.push(alerts));

    expect(emissions).toHaveLength(1);
    expect(rowAt(emissions, 0).map((alert) => alert.id)).toEqual(["newer", "older"]);
    unsubscribe();
  });

  it("emits an empty list for a user with no alerts", () => {
    store.__seedEntities("alerts", [makeAlert({ id: "a1", userId: "user-2" })]);
    const emissions: Alert[][] = [];

    const unsubscribe = subscribeToAlerts("user-1", (alerts) => emissions.push(alerts));

    expect(emissions).toEqual([[]]);
    unsubscribe();
  });

  it("re-emits after a new alert is created for that user", async () => {
    const emissions: Alert[][] = [];
    const unsubscribe = subscribeToAlerts("user-1", (alerts) => emissions.push(alerts));

    const created = await createAlert("user-1", alertInput({ title: "Fresh" }));

    expect(emissions.length).toBeGreaterThan(1);
    const latest = rowAt(emissions, emissions.length - 1);
    expect(latest.map((alert) => alert.id)).toEqual([created.id]);
    expect(rowAt(latest, 0).title).toBe("Fresh");
    unsubscribe();
  });

  it("re-emits without the alert once it is dismissed", async () => {
    store.__seedEntities("alerts", [makeAlert({ id: "a1" }), makeAlert({ id: "a2" })]);
    const emissions: Alert[][] = [];
    const unsubscribe = subscribeToAlerts("user-1", (alerts) => emissions.push(alerts));

    await dismissAlert("a1");

    const latest = rowAt(emissions, emissions.length - 1);
    expect(latest.map((alert) => alert.id)).toEqual(["a2"]);
    unsubscribe();
  });

  it("never includes another user's alerts in an emission", async () => {
    store.__seedEntities("alerts", [makeAlert({ id: "mine", userId: "user-1" })]);
    const emissions: Alert[][] = [];
    const unsubscribe = subscribeToAlerts("user-1", (alerts) => emissions.push(alerts));

    await createAlert("user-2", alertInput({ title: "Not mine" }));

    // Only emission CONTENT is asserted here: the emulator re-notifies every
    // listener on any write, so an emission count after a foreign write would be
    // an emulator artifact rather than real firestore behaviour.
    emissions.forEach((emission) => {
      expect(emission.map((alert) => alert.id)).toEqual(["mine"]);
    });
    unsubscribe();
  });

  it("stops emitting once unsubscribed", async () => {
    const emissions: Alert[][] = [];
    const unsubscribe = subscribeToAlerts("user-1", (alerts) => emissions.push(alerts));
    const countAtUnsubscribe = emissions.length;

    unsubscribe();
    await createAlert("user-1", alertInput());
    store.__notify();

    expect(emissions).toHaveLength(countAtUnsubscribe);
  });

  it("caps each emission at the 50 newest alerts", async () => {
    // alerts.ts:102 hard-codes limit(50). The dashboard subscription
    // (useFinancialSubscriptions.ts:83) is the app's only alert feed, so a user
    // holding more than 50 undismissed alerts can never see — or dismiss — the
    // oldest ones from that list.
    for (let index = 0; index < 55; index += 1) {
      seedAlertAt(`a${index}`, BASE_MILLIS + index * 1_000);
    }
    const emissions: Alert[][] = [];

    const unsubscribe = subscribeToAlerts("user-1", (alerts) => emissions.push(alerts));

    const emitted = rowAt(emissions, 0);
    expect(emitted).toHaveLength(50);
    expect(rowAt(emitted, 0).id).toBe("a54");
    expect(rowAt(emitted, 49).id).toBe("a5");
    expect(emitted.map((alert) => alert.id)).not.toContain("a4");
    unsubscribe();
  });
});

// ============================================================================
// BALANCE HISTORY — saveBalanceSnapshot
// ============================================================================

describe("saveBalanceSnapshot", () => {
  it("creates a snapshot for the user and date, stamped with the current clock", async () => {
    const created = await saveBalanceSnapshot(
      "user-1",
      snapshotInput({ date: "2026-03-10", openingBalance: 5_000, closingBalance: 4_200 })
    );

    expect(store.__count("balance_history")).toBe(1);
    const stored = readDoc<BalanceSnapshot>("balance_history", created.id);
    expect(stored).toMatchObject({
      userId: "user-1",
      date: "2026-03-10",
      openingBalance: 5_000,
      closingBalance: 4_200,
      isReconciled: false,
    });
    expect(stored.createdAt.toMillis()).toBe(d(TODAY).getTime());
  });

  it("returns an entity identical to the document it just created", async () => {
    const created = await saveBalanceSnapshot("user-1", snapshotInput({ date: "2026-03-10" }));

    const stored = readDoc<Omit<BalanceSnapshot, "id">>("balance_history", created.id);
    expect({ id: created.id, ...stored }).toEqual(created);
  });

  it("updates the existing row in place when saving the same date twice", async () => {
    // balanceHistory.ts:29 looks the day up first and takes the update branch,
    // so a second save for one day does NOT create a second row.
    const first = await saveBalanceSnapshot(
      "user-1",
      snapshotInput({ date: "2026-03-10", closingBalance: 4_200, isReconciled: false })
    );
    const second = await saveBalanceSnapshot(
      "user-1",
      snapshotInput({ date: "2026-03-10", closingBalance: 3_100, isReconciled: true })
    );

    expect(store.__count("balance_history")).toBe(1);
    expect(second.id).toBe(first.id);
    const stored = readDoc<BalanceSnapshot>("balance_history", first.id);
    expect(stored.closingBalance).toBe(3_100);
    expect(stored.isReconciled).toBe(true);
    expect(stored.userId).toBe("user-1");
  });

  it("logs one add then one update across two saves of the same date", async () => {
    await saveBalanceSnapshot("user-1", snapshotInput({ date: "2026-03-10" }));
    await saveBalanceSnapshot("user-1", snapshotInput({ date: "2026-03-10" }));

    expect(store.__opsFor("balance_history").map((entry) => entry.op)).toEqual(["add", "update"]);
  });

  it("rewrites createdAt in the stored document on every update", async () => {
    await saveBalanceSnapshot("user-1", snapshotInput({ date: "2026-03-10" }));

    advanceClockTo("2026-03-20");
    const updated = await saveBalanceSnapshot(
      "user-1",
      snapshotInput({ date: "2026-03-10", closingBalance: 1 })
    );

    // createdAt is the only timestamp on BalanceSnapshot, and the update branch
    // (balanceHistory.ts:35) overwrites it — the original creation time is lost.
    expect(readDoc<BalanceSnapshot>("balance_history", updated.id).createdAt.toMillis()).toBe(
      d("2026-03-20").getTime()
    );
  });

  it("keeps separate rows for separate dates", async () => {
    await saveBalanceSnapshot("user-1", snapshotInput({ date: "2026-03-10" }));
    await saveBalanceSnapshot("user-1", snapshotInput({ date: "2026-03-11" }));

    expect(store.__count("balance_history")).toBe(2);
    expect(
      store
        .__all<BalanceSnapshot>("balance_history")
        .map((row) => row.date)
        .sort()
    ).toEqual(["2026-03-10", "2026-03-11"]);
  });

  it("keeps separate rows for the same date across users", async () => {
    const mine = await saveBalanceSnapshot(
      "user-1",
      snapshotInput({ date: "2026-03-10", closingBalance: 100 })
    );
    const theirs = await saveBalanceSnapshot(
      "user-2",
      snapshotInput({ date: "2026-03-10", closingBalance: 900 })
    );

    expect(theirs.id).not.toBe(mine.id);
    expect(store.__count("balance_history")).toBe(2);
    expect(readDoc<BalanceSnapshot>("balance_history", mine.id).closingBalance).toBe(100);
    expect(readDoc<BalanceSnapshot>("balance_history", theirs.id).closingBalance).toBe(900);
  });

  it("does not touch another user's snapshot for the same date", async () => {
    store.__seedEntities("balance_history", [
      makeBalanceSnapshot({ id: "theirs", userId: "user-2", date: "2026-03-10" }),
    ]);
    const before = readDoc<BalanceSnapshot>("balance_history", "theirs");

    await saveBalanceSnapshot("user-1", snapshotInput({ date: "2026-03-10" }));

    expect(readDoc<BalanceSnapshot>("balance_history", "theirs")).toEqual(before);
  });

  it.fails(
    "KNOWN DEFECT: the entity returned when updating a snapshot carries a stale createdAt",
    async () => {
      // app/lib/firebase/firestore/balanceHistory.ts:33-38 writes
      // `createdAt: now` but returns `{ ...existingSnapshot, ...snapshot }`, and
      // existingSnapshot still holds the ORIGINAL createdAt (snapshot cannot
      // carry one — it is Omit<…, "createdAt">).
      // CORRECT BEHAVIOUR: the returned entity must describe the document that
      // now exists, as the create branch at :48 does and as createAlert
      // (alerts.ts:39) and addIncomeSource (incomeSources.ts:37) do. A caller
      // that feeds the return value into local state holds a createdAt that
      // firestore has already superseded.
      await saveBalanceSnapshot("user-1", snapshotInput({ date: "2026-03-10" }));

      advanceClockTo("2026-03-20");
      const returned = await saveBalanceSnapshot(
        "user-1",
        snapshotInput({ date: "2026-03-10", closingBalance: 3_100 })
      );

      const rows = store.__all<BalanceSnapshot>("balance_history");
      expect(rows).toHaveLength(1);
      const persistedMillis = rowAt(rows, 0).createdAt.toMillis();
      expect(persistedMillis).toBe(d("2026-03-20").getTime());
      expect(returned.createdAt.toMillis()).toBe(persistedMillis);
    }
  );

  it.fails(
    "KNOWN DEFECT: two overlapping saves for one user+date create two conflicting rows",
    async () => {
      // balanceHistory.ts:29 reads the day, :47 writes it, with no transaction
      // and no deterministic document id — a setDoc on `${userId}_${date}`
      // would be idempotent. Two in-flight saves for the same day therefore
      // both observe "no existing snapshot" and both addDoc. After that,
      // getBalanceSnapshot (:56 — limit(1) with no orderBy) returns an
      // arbitrary one of the two, later saves update only that one, and the
      // other row keeps a conflicting closing balance for the same day forever.
      // CORRECT BEHAVIOUR: at most one snapshot per user+date.
      await Promise.all([
        saveBalanceSnapshot("user-1", snapshotInput({ date: "2026-03-10", closingBalance: 1_000 })),
        saveBalanceSnapshot("user-1", snapshotInput({ date: "2026-03-10", closingBalance: 2_000 })),
      ]);

      expect(store.__count("balance_history")).toBe(1);
    }
  );
});

// ============================================================================
// BALANCE HISTORY — getBalanceSnapshot
// ============================================================================

describe("getBalanceSnapshot", () => {
  it("returns the snapshot for the given date with its document id merged in", async () => {
    store.__seedEntities("balance_history", [
      makeBalanceSnapshot({ id: "snap-a", date: "2026-03-10", closingBalance: 4_200 }),
      makeBalanceSnapshot({ id: "snap-b", date: "2026-03-11", closingBalance: 4_000 }),
    ]);

    const snapshot = await getBalanceSnapshot("user-1", "2026-03-10");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.id).toBe("snap-a");
    expect(snapshot?.closingBalance).toBe(4_200);
    expect(snapshot?.date).toBe("2026-03-10");
  });

  it("returns null — not undefined — when the day has no snapshot", async () => {
    store.__seedEntities("balance_history", [
      makeBalanceSnapshot({ id: "snap-a", date: "2026-03-10" }),
    ]);

    const snapshot = await getBalanceSnapshot("user-1", "2026-03-11");

    expect(snapshot).toBeNull();
    expect(snapshot).not.toBeUndefined();
  });

  it("returns null when the snapshot for that day belongs to another user", async () => {
    store.__seedEntities("balance_history", [
      makeBalanceSnapshot({ id: "theirs", userId: "user-2", date: "2026-03-10" }),
    ]);

    expect(await getBalanceSnapshot("user-1", "2026-03-10")).toBeNull();
    expect(await getBalanceSnapshot("user-2", "2026-03-10")).not.toBeNull();
  });

  it("returns null for every date when the collection is empty", async () => {
    expect(await getBalanceSnapshot("user-1", "2026-03-10")).toBeNull();
  });

  it("returns only one row when a day somehow has duplicates", async () => {
    // limit(1) with no orderBy (balanceHistory.ts:56): with two rows for one
    // day the winner is whichever the query happens to return first, and the
    // loser is invisible to every read path except getBalanceHistory. See the
    // duplicate-row defect encoded above for how a day gets two rows.
    store.__seedEntities("balance_history", [
      makeBalanceSnapshot({ id: "dup-a", date: "2026-03-10", closingBalance: 1_000 }),
      makeBalanceSnapshot({ id: "dup-b", date: "2026-03-10", closingBalance: 2_000 }),
    ]);

    const snapshot = await getBalanceSnapshot("user-1", "2026-03-10");

    expect(snapshot).not.toBeNull();
    expect(["dup-a", "dup-b"]).toContain(snapshot?.id);
    const history = await getBalanceHistory("user-1", "2026-03-10", "2026-03-10");
    expect(history).toHaveLength(2);
  });
});

// ============================================================================
// BALANCE HISTORY — getBalanceHistory
// ============================================================================

describe("getBalanceHistory", () => {
  const seedDays = (dates: string[], userId = "user-1"): void => {
    store.__seedEntities(
      "balance_history",
      dates.map((date) => makeBalanceSnapshot({ id: `${userId}-${date}`, userId, date }))
    );
  };

  it("includes both range boundaries", async () => {
    seedDays(["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13"]);

    const history = await getBalanceHistory("user-1", "2026-03-10", "2026-03-12");

    expect(history.map((row) => row.date)).toEqual(["2026-03-10", "2026-03-11", "2026-03-12"]);
  });

  it("excludes days outside the range on both sides", async () => {
    seedDays(["2026-02-28", "2026-03-01", "2026-03-31", "2026-04-01"]);

    const history = await getBalanceHistory("user-1", "2026-03-01", "2026-03-31");

    expect(history.map((row) => row.date)).toEqual(["2026-03-01", "2026-03-31"]);
  });

  it("orders ascending by date regardless of insertion order", async () => {
    seedDays(["2026-03-12", "2026-03-09", "2026-03-11", "2026-03-10"]);

    const history = await getBalanceHistory("user-1", "2026-03-01", "2026-03-31");

    expect(history.map((row) => row.date)).toEqual([
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
    ]);
  });

  it("returns only the requested user's rows", async () => {
    seedDays(["2026-03-10", "2026-03-11"], "user-1");
    seedDays(["2026-03-10", "2026-03-11"], "user-2");

    const history = await getBalanceHistory("user-1", "2026-03-01", "2026-03-31");

    expect(history).toHaveLength(2);
    expect(history.every((row) => row.userId === "user-1")).toBe(true);
    expect(history.map((row) => row.id)).toEqual(["user-1-2026-03-10", "user-1-2026-03-11"]);
  });

  it("returns a single-day range as one row when start equals end", async () => {
    seedDays(["2026-03-09", "2026-03-10", "2026-03-11"]);

    const history = await getBalanceHistory("user-1", "2026-03-10", "2026-03-10");

    expect(history.map((row) => row.date)).toEqual(["2026-03-10"]);
  });

  it("returns an empty array for a range that contains no rows", async () => {
    seedDays(["2026-03-10"]);

    expect(await getBalanceHistory("user-1", "2026-04-01", "2026-04-30")).toEqual([]);
  });

  it("returns an empty array when startDate is after endDate", async () => {
    seedDays(["2026-03-10", "2026-03-11"]);

    expect(await getBalanceHistory("user-1", "2026-03-11", "2026-03-10")).toEqual([]);
  });

  it("returns an empty array when the collection is empty — the shipped state of this feature", async () => {
    // Nothing in app/ writes balance_history (see the file header), so this is
    // what the reconciliation/history UI would actually read today.
    expect(await getBalanceHistory("user-1", "2026-01-01", "2026-12-31")).toEqual([]);
  });

  it("merges the document id into every returned row", async () => {
    store.__seed("balance_history", "explicit-id", {
      ...snapshotInput({ date: "2026-03-10" }),
      userId: "user-1",
    });

    const history = await getBalanceHistory("user-1", "2026-03-10", "2026-03-10");

    expect(history).toHaveLength(1);
    expect(rowAt(history, 0).id).toBe("explicit-id");
  });
});
