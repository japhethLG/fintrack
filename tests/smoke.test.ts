import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => import("./helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("./helpers/firebaseConfigMock"));

import { calculateOccurrences } from "@/lib/logic/projectionEngine/occurrenceCalculator";
import { completeTransaction, getTransaction } from "@/lib/firebase/firestore/transactions";
import * as store from "./helpers/firestoreEmulator";
import { makeTransaction, makeUserProfile } from "./helpers/builders";
import { d, ymdAll } from "./helpers/dates";
import { freezeToday } from "./helpers/time";

describe("test harness", () => {
  beforeEach(() => store.__reset());

  it("runs in UTC so date boundaries are reproducible", () => {
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(0);
  });

  it("resolves the @/ alias and runs pure engine code", () => {
    const occurrences = calculateOccurrences(
      {
        frequency: "monthly",
        startDate: "2026-01-10",
        scheduleConfig: { dayOfMonth: 10 },
        weekendAdjustment: "none",
      },
      d("2026-01-01"),
      d("2026-03-31")
    );

    expect(ymdAll(occurrences)).toEqual(["2026-01-10", "2026-02-10", "2026-03-10"]);
  });

  it("freezes the clock for calculators that read new Date()", () => {
    freezeToday("2026-03-15");
    expect(new Date().getFullYear()).toBe(2026);
    expect(new Date().getMonth()).toBe(2);
    expect(new Date().getDate()).toBe(15);
  });

  it("runs the real firestore module against the emulator", async () => {
    store.__seed("users", "user-1", makeUserProfile({ currentBalance: 1_000 }));
    store.__seed(
      "transactions",
      "txn-1",
      makeTransaction({ type: "expense", projectedAmount: 100, status: "projected" })
    );

    await completeTransaction("txn-1", 120);

    const stored = await getTransaction("txn-1");
    expect(stored?.status).toBe("completed");
    expect(stored?.actualAmount).toBe(120);
    expect(stored?.variance).toBe(20);

    // Real balance logic ran: 1000 - 120
    expect(store.__get<{ currentBalance: number }>("users", "user-1")?.currentBalance).toBe(880);
  });
});
