import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => import("../../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../../helpers/firebaseConfigMock"));

import type { CreditConfig, ExpenseRule, IncomeSource } from "@/lib/types";
import {
  addIncomeSource,
  deleteIncomeSource,
  getIncomeSource,
  getIncomeSources,
  subscribeToIncomeSources,
  updateIncomeSource,
} from "@/lib/firebase/firestore/incomeSources";
import {
  addExpenseRule,
  deleteExpenseRule,
  getExpenseRule,
  getExpenseRules,
  subscribeToExpenseRules,
  updateCreditBalance,
  updateExpenseRule,
} from "@/lib/firebase/firestore/expenseRules";
import * as store from "../../helpers/firestoreEmulator";
import {
  makeCompletedTransaction,
  makeCreditConfig,
  makeCreditRule,
  makeExpenseRule,
  makeIncomeSource,
  makeLoanConfig,
  makeLoanRule,
  makeSkippedTransaction,
} from "../../helpers/builders";
import { d } from "../../helpers/dates";
import { freezeToday } from "../../helpers/time";

/**
 * THEME: the income-source and expense-rule persistence layers
 * (`app/lib/firebase/firestore/incomeSources.ts`, `expenseRules.ts`).
 *
 * These are the two collections every projection is generated from, so their
 * write shape *is* the engine's input contract: what gets stamped, what gets
 * stripped, what survives a partial update, and which rows a query is allowed
 * to see. The real repo code runs against the in-memory firestore emulator —
 * nothing in the CRUD path is stubbed.
 *
 * DELIBERATELY NOT COVERED HERE (owned by
 * tests/integration/actualMutation.firestore.test.ts):
 *   - setExpenseRuleOverride / removeExpenseRuleOverride
 *   - setIncomeSourceOverride / removeIncomeSourceOverride
 *     Both override pairs — income AND expense — already have their own
 *     describe blocks there covering merge into an existing map, creating the
 *     map, replacing one entry, deleting only the addressed entry, rejecting on
 *     a missing doc, and stamping updatedAt. Nothing is re-asserted here.
 *   - updateLoanBalance (its own describe block there) and
 *     updateInstallmentProgress (exercised through completeTransaction there).
 * `updateCreditBalance` is the only balance mutator with no home, so it is
 * covered below.
 */

const USER_A = "user-a";
const USER_B = "user-b";
const TODAY = "2026-02-10";

type SourceInput = Omit<IncomeSource, "id" | "userId" | "createdAt" | "updatedAt">;
type RuleInput = Omit<ExpenseRule, "id" | "userId" | "createdAt" | "updatedAt">;

/** Strip the server-owned fields so a builder result becomes an `add*` payload. */
const sourceInput = (overrides: Partial<IncomeSource> = {}): SourceInput => {
  const {
    id: _id,
    userId: _userId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...input
  } = makeIncomeSource(overrides);
  return input;
};

const ruleInput = (overrides: Partial<ExpenseRule> = {}): RuleInput => {
  const {
    id: _id,
    userId: _userId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...input
  } = makeExpenseRule(overrides);
  return input;
};

/** Raw stored document (no `id` field — Firestore keeps the id on the ref). */
const storedSource = (id: string): IncomeSource =>
  store.__get<IncomeSource>("income_sources", id) as IncomeSource;
const storedRule = (id: string): ExpenseRule =>
  store.__get<ExpenseRule>("expense_rules", id) as ExpenseRule;

const millis = (value: unknown): number => (value as { toMillis: () => number }).toMillis();
const ids = (rows: { id: string }[]): string[] => rows.map((row) => row.id);
const frozenMillis = () => d(TODAY).getTime();

beforeEach(() => {
  store.__reset();
  freezeToday(TODAY);
});

// ============================================================================
// CREATE
// ============================================================================

describe("addIncomeSource", () => {
  it("persists the source under the given userId in income_sources", async () => {
    const created = await addIncomeSource(USER_A, sourceInput({ name: "Day job" }));

    expect(ids(store.__all("income_sources"))).toEqual([created.id]);
    const stored = storedSource(created.id);
    expect(stored.userId).toBe(USER_A);
    expect(stored.name).toBe("Day job");
  });

  it("stamps createdAt and updatedAt from the server clock on the stored document", async () => {
    const created = await addIncomeSource(USER_A, sourceInput());

    const stored = storedSource(created.id);
    expect(millis(stored.createdAt)).toBe(frozenMillis());
    expect(millis(stored.updatedAt)).toBe(frozenMillis());
  });

  it("returns the entity with its generated id, the echoed input and both stamps", async () => {
    const created = await addIncomeSource(
      USER_A,
      sourceInput({ name: "Rental", sourceType: "rental", amount: 1_450 })
    );

    // the generated id is the store key — it is NOT written into the document
    expect(ids(store.__all("income_sources"))).toEqual([created.id]);
    expect("id" in storedSource(created.id)).toBe(false);

    expect(created.userId).toBe(USER_A);
    expect(created.name).toBe("Rental");
    expect(created.sourceType).toBe("rental");
    expect(created.amount).toBe(1_450);
    expect(millis(created.createdAt)).toBe(frozenMillis());
    expect(millis(created.updatedAt)).toBe(frozenMillis());
  });

  it("overwrites a stale userId and stamps on the stored document", async () => {
    // Reachable WITHOUT a cast: `IncomeSource` is structurally assignable to
    // `Omit<IncomeSource, "id" | "userId" | "createdAt" | "updatedAt">` (excess
    // property checks only bite on fresh object literals), so a "duplicate this
    // source" flow would type-check.
    const foreign = makeIncomeSource({ id: "inc-1", userId: USER_B, name: "Copied" });

    await addIncomeSource(USER_A, foreign);

    // The WRITE payload spreads `...source` FIRST and the explicit
    // userId/createdAt/updatedAt LAST, so those three are correct.
    const ops = store.__opsFor("income_sources");
    expect(ops).toHaveLength(1);
    const stored = storedSource(ops[0].id);
    expect(stored.userId).toBe(USER_A);
    expect(millis(stored.createdAt)).toBe(frozenMillis());
    expect(millis(stored.updatedAt)).toBe(frozenMillis());
    expect(stored.name).toBe("Copied");
  });

  it("writes a stale `id` field into the document body, which then poisons every read of it", async () => {
    const foreign = makeIncomeSource({ id: "inc-1", userId: USER_B });

    const created = await addIncomeSource(USER_A, foreign);
    const realDocId = store.__opsFor("income_sources")[0].id;
    expect(realDocId).not.toBe("inc-1");

    // 1. `id` is NOT in the Omit<> type, but it IS a runtime property, so
    //    `{ ...source }` carries it into the document body. Every other write in
    //    this layer keeps the id on the ref only.
    expect(storedSource(realDocId).id).toBe("inc-1");

    // 2. The return spreads `...source` LAST — `{ id: docRef.id, userId, ...,
    //    ...source }` (incomeSources.ts:38) — so the caller is handed an id that
    //    does not address the document that was just created.
    expect(created.id).toBe("inc-1");
    expect(created.userId).toBe(USER_B);
    expect(millis(created.createdAt)).toBe(0);

    // 3. Reads spread `...doc.data()` after `id: doc.id`, so the stale body field
    //    wins there too and the real key becomes unreachable through the API.
    const fetched = await getIncomeSource(realDocId);
    expect(fetched?.id).toBe("inc-1");
    expect(ids(await getIncomeSources(USER_A))).toEqual(["inc-1"]);
    // ...and `updateIncomeSource(fetched.id)` would then throw "does not exist"
    await expect(updateIncomeSource("inc-1", { amount: 1 })).rejects.toThrow(
      "Income source with ID inc-1 does not exist"
    );

    // Pinned as behaviour rather than encoded as `it.fails` because no current
    // caller reaches it: `createIncomeSourceAction` passes an
    // `IncomeSourceFormData`, whose type strips these four keys, and nothing in
    // app/ clones an existing entity. Kept visible because the type system is the
    // ONLY thing preventing it — one `as` or one duplicate-source feature and the
    // row becomes unaddressable. Fixing it means spreading `...source` first and
    // deleting `id` from the write payload, in both this file and expenseRules.ts.
  });

  it("strips undefined fields while preserving null, zero and empty string", async () => {
    const created = await addIncomeSource(
      USER_A,
      sourceInput({
        endDate: undefined,
        notes: undefined,
        amount: 0,
        category: "",
        color: null as unknown as string,
      })
    );

    const stored = storedSource(created.id);
    // Firestore rejects undefined outright, so the keys must be ABSENT
    expect("endDate" in stored).toBe(false);
    expect("notes" in stored).toBe(false);
    // ...while these are all legitimate stored values and must survive
    expect(stored.amount).toBe(0);
    expect(stored.category).toBe("");
    expect(stored.color).toBeNull();
  });

  it("round-trips a source with no endDate, notes or color through getIncomeSource", async () => {
    const created = await addIncomeSource(
      USER_A,
      sourceInput({
        name: "Side gig",
        endDate: undefined,
        notes: undefined,
        color: undefined,
        occurrenceOverrides: undefined,
      })
    );

    const fetched = await getIncomeSource(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.name).toBe("Side gig");
    expect(fetched?.userId).toBe(USER_A);
    expect(fetched?.endDate).toBeUndefined();
    expect(fetched?.notes).toBeUndefined();
    expect(fetched?.color).toBeUndefined();
    expect(fetched?.occurrenceOverrides).toBeUndefined();
  });

  it("records exactly one write", async () => {
    await addIncomeSource(USER_A, sourceInput());

    expect(store.__opsFor("income_sources").map((entry) => entry.op)).toEqual(["add"]);
    expect(store.__opsFor("expense_rules")).toEqual([]);
    expect(store.__opsFor("transactions")).toEqual([]);
  });
});

describe("addExpenseRule", () => {
  it("persists the rule under the given userId in expense_rules", async () => {
    const created = await addExpenseRule(USER_A, ruleInput({ name: "Rent" }));

    expect(ids(store.__all("expense_rules"))).toEqual([created.id]);
    const stored = storedRule(created.id);
    expect(stored.userId).toBe(USER_A);
    expect(stored.name).toBe("Rent");
  });

  it("stamps createdAt and updatedAt from the server clock", async () => {
    const created = await addExpenseRule(USER_A, ruleInput());

    const stored = storedRule(created.id);
    expect(millis(stored.createdAt)).toBe(frozenMillis());
    expect(millis(stored.updatedAt)).toBe(frozenMillis());
  });

  it("returns the entity with its generated id and the echoed input", async () => {
    const created = await addExpenseRule(
      USER_A,
      ruleInput({ name: "Netflix", category: "subscriptions", amount: 15.99, isPriority: true })
    );

    expect(ids(store.__all("expense_rules"))).toEqual([created.id]);
    expect(created.userId).toBe(USER_A);
    expect(created.name).toBe("Netflix");
    expect(created.category).toBe("subscriptions");
    expect(created.amount).toBe(15.99);
    expect(created.isPriority).toBe(true);
    expect(millis(created.createdAt)).toBe(frozenMillis());
  });

  it("strips undefined fields while preserving null, zero and empty string", async () => {
    const created = await addExpenseRule(
      USER_A,
      ruleInput({
        endDate: undefined,
        notes: undefined,
        color: undefined,
        loanConfig: undefined,
        creditConfig: undefined,
        installmentConfig: undefined,
        amount: 0,
        isVariableAmount: false,
        occurrenceOverrides: null as unknown as undefined,
      })
    );

    const stored = storedRule(created.id);
    for (const key of [
      "endDate",
      "notes",
      "color",
      "loanConfig",
      "creditConfig",
      "installmentConfig",
    ]) {
      expect(key in stored).toBe(false);
    }
    expect(stored.amount).toBe(0);
    expect(stored.isVariableAmount).toBe(false);
    expect(stored.occurrenceOverrides).toBeNull();
  });

  it("round-trips a bare fixed rule with no endDate, notes or color", async () => {
    const created = await addExpenseRule(
      USER_A,
      ruleInput({ name: "Water bill", endDate: undefined, notes: undefined, color: undefined })
    );

    const fetched = await getExpenseRule(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.name).toBe("Water bill");
    expect(fetched?.userId).toBe(USER_A);
    expect(fetched?.endDate).toBeUndefined();
    expect(fetched?.notes).toBeUndefined();
    expect(fetched?.color).toBeUndefined();
  });

  it("writes a loan rule's nested config verbatim", async () => {
    const created = await addExpenseRule(
      USER_A,
      ruleInput({ expenseType: "cash_loan", amount: 565, loanConfig: makeLoanConfig() })
    );

    const stored = storedRule(created.id);
    expect(stored.expenseType).toBe("cash_loan");
    expect(stored.loanConfig?.principalAmount).toBe(12_000);
    expect(stored.loanConfig?.currentBalance).toBe(12_000);
    expect(stored.loanConfig?.paymentsMade).toBe(0);
    expect(stored.loanConfig?.calculationType).toBe("amortized");
  });

  it("strips only TOP-LEVEL undefined — an undefined leaf inside a nested config survives", async () => {
    const created = await addExpenseRule(
      USER_A,
      ruleInput({
        expenseType: "credit_card",
        // `fixedPaymentAmount` is optional on CreditConfig, so a caller building
        // the config with a plain assignment rather than a conditional spread
        // produces exactly this shape.
        creditConfig: {
          ...makeCreditConfig(),
          fixedPaymentAmount: undefined,
        } as CreditConfig,
      })
    );

    const stored = storedRule(created.id);
    // `removeUndefined` (app/lib/firebase/firestore/utils.ts:14) iterates only
    // the object's OWN top-level keys, so a nested undefined is written through.
    // Real Firestore REJECTS that write ("Unsupported field value: undefined").
    // NOT encoded as a KNOWN DEFECT because no current caller reaches it: both
    // ExpenseRuleForm/formHelpers.ts and IncomeSourceForm/formHelpers.ts build
    // their optional config leaves with a conditional spread. This test pins the
    // shallow behaviour so the latent hazard is visible rather than asserted-away.
    expect("fixedPaymentAmount" in (stored.creditConfig as object)).toBe(true);
    expect(stored.creditConfig?.fixedPaymentAmount).toBeUndefined();
    // the sibling keys are untouched
    expect(stored.creditConfig?.creditLimit).toBe(10_000);
  });

  it("keeps the two collections separate", async () => {
    await addIncomeSource(USER_A, sourceInput());
    await addExpenseRule(USER_A, ruleInput());

    expect(store.__count("income_sources")).toBe(1);
    expect(store.__count("expense_rules")).toBe(1);
  });
});

// ============================================================================
// LIST QUERIES
// ============================================================================

/**
 * Seeded in an order that matches NO field ordering: insertion order is
 * s3, s1, s2 — different from id-ascending (s1, s2, s3), name-ascending
 * (Alpha, Mid, Zed) and startDate-ascending (s2, s1, s3). Any orderBy added to
 * the query would therefore change the asserted result.
 */
const seedSources = () => {
  store.__seedEntities("income_sources", [
    makeIncomeSource({ id: "s3", userId: USER_A, name: "Zed", startDate: "2026-03-01" }),
    makeIncomeSource({ id: "s1", userId: USER_A, name: "Alpha", startDate: "2026-02-01" }),
    makeIncomeSource({
      id: "s2",
      userId: USER_A,
      name: "Mid",
      startDate: "2026-01-01",
      isActive: false,
    }),
    makeIncomeSource({ id: "b1", userId: USER_B, name: "Other user salary" }),
  ]);
};

const seedRules = () => {
  store.__seedEntities("expense_rules", [
    makeExpenseRule({ id: "r3", userId: USER_A, name: "Zed", startDate: "2026-03-01" }),
    makeExpenseRule({ id: "r1", userId: USER_A, name: "Alpha", startDate: "2026-02-01" }),
    makeExpenseRule({
      id: "r2",
      userId: USER_A,
      name: "Mid",
      startDate: "2026-01-01",
      isActive: false,
    }),
    makeExpenseRule({ id: "b1", userId: USER_B, name: "Other user rent" }),
  ]);
};

describe("getIncomeSources", () => {
  beforeEach(seedSources);

  it("returns only the requested user's rows", async () => {
    const rows = await getIncomeSources(USER_A);

    expect(ids(rows).sort()).toEqual(["s1", "s2", "s3"]);
    expect(rows.every((row) => row.userId === USER_A)).toBe(true);
  });

  it("does not leak the other user's rows in either direction", async () => {
    expect(ids(await getIncomeSources(USER_B))).toEqual(["b1"]);
    expect(ids(await getIncomeSources(USER_A))).not.toContain("b1");
  });

  it("applies NO ordering — rows come back in the store's natural order", async () => {
    const rows = await getIncomeSources(USER_A);

    // incomeSources.ts:44-52 builds the query from `where` constraints only; there
    // is no orderBy, so callers must not depend on the order. Pinned so that
    // adding an orderBy is a deliberate, visible change.
    expect(ids(rows)).toEqual(["s3", "s1", "s2"]);
  });

  it("merges the document id into every row", async () => {
    const rows = await getIncomeSources(USER_A);

    expect(rows.find((row) => row.id === "s1")?.name).toBe("Alpha");
  });

  it("filters to active rows when activeOnly is set, still scoped to the user", async () => {
    const rows = await getIncomeSources(USER_A, true);

    expect(ids(rows).sort()).toEqual(["s1", "s3"]);
    expect(rows.every((row) => row.isActive)).toBe(true);
    expect(ids(rows)).not.toContain("b1");
  });

  it("includes inactive rows by default", async () => {
    const rows = await getIncomeSources(USER_A);

    expect(ids(rows)).toContain("s2");
  });

  it("returns an empty list for a user with no rows", async () => {
    expect(await getIncomeSources("nobody")).toEqual([]);
  });

  it("reads without writing", async () => {
    await getIncomeSources(USER_A);
    await getIncomeSources(USER_A, true);

    expect(store.__ops).toEqual([]);
  });
});

describe("getExpenseRules", () => {
  beforeEach(seedRules);

  it("returns only the requested user's rows", async () => {
    const rows = await getExpenseRules(USER_A);

    expect(ids(rows).sort()).toEqual(["r1", "r2", "r3"]);
    expect(rows.every((row) => row.userId === USER_A)).toBe(true);
  });

  it("does not leak the other user's rows in either direction", async () => {
    expect(ids(await getExpenseRules(USER_B))).toEqual(["b1"]);
    expect(ids(await getExpenseRules(USER_A))).not.toContain("b1");
  });

  it("applies NO ordering — rows come back in the store's natural order", async () => {
    // expenseRules.ts:45-53 — where constraints only, no orderBy.
    expect(ids(await getExpenseRules(USER_A))).toEqual(["r3", "r1", "r2"]);
  });

  it("filters to active rows when activeOnly is set, still scoped to the user", async () => {
    const rows = await getExpenseRules(USER_A, true);

    expect(ids(rows).sort()).toEqual(["r1", "r3"]);
    expect(ids(rows)).not.toContain("b1");
  });

  it("includes inactive rows by default", async () => {
    expect(ids(await getExpenseRules(USER_A))).toContain("r2");
  });

  it("returns an empty list for a user with no rows", async () => {
    expect(await getExpenseRules("nobody")).toEqual([]);
  });

  it("reads without writing", async () => {
    await getExpenseRules(USER_A);

    expect(store.__ops).toEqual([]);
  });
});

// ============================================================================
// SINGLE-DOCUMENT READS
// ============================================================================

describe("getIncomeSource", () => {
  it("returns the stored source with its document id merged in", async () => {
    store.__seedEntities("income_sources", [
      makeIncomeSource({ id: "s1", userId: USER_A, name: "Salary", amount: 4_200 }),
    ]);

    const found = await getIncomeSource("s1");
    expect(found?.id).toBe("s1");
    expect(found?.name).toBe("Salary");
    expect(found?.amount).toBe(4_200);
  });

  it("returns null rather than throwing for a document that does not exist", async () => {
    await expect(getIncomeSource("missing")).resolves.toBeNull();
  });

  it("creates nothing as a side effect of a miss", async () => {
    await getIncomeSource("missing");

    expect(store.__count("income_sources")).toBe(0);
    expect(store.__ops).toEqual([]);
  });

  it("performs no ownership check — isolation here rests on security rules", async () => {
    store.__seedEntities("income_sources", [makeIncomeSource({ id: "b1", userId: USER_B })]);

    // getIncomeSource takes only an id, so this layer cannot scope by user.
    // Pinned deliberately: cross-user protection for id-addressed reads lives in
    // Firestore security rules, not in application code.
    const found = await getIncomeSource("b1");
    expect(found?.userId).toBe(USER_B);
  });
});

describe("getExpenseRule", () => {
  it("returns the stored rule with its document id merged in", async () => {
    store.__seedEntities("expense_rules", [
      makeCreditRule({ id: "card-1", userId: USER_A, name: "Visa" }),
    ]);

    const found = await getExpenseRule("card-1");
    expect(found?.id).toBe("card-1");
    expect(found?.name).toBe("Visa");
    expect(found?.creditConfig?.currentBalance).toBe(5_000);
  });

  it("returns null rather than throwing for a document that does not exist", async () => {
    await expect(getExpenseRule("missing")).resolves.toBeNull();
  });

  it("creates nothing as a side effect of a miss", async () => {
    await getExpenseRule("missing");

    expect(store.__count("expense_rules")).toBe(0);
    expect(store.__ops).toEqual([]);
  });

  it("performs no ownership check — isolation here rests on security rules", async () => {
    store.__seedEntities("expense_rules", [makeExpenseRule({ id: "b1", userId: USER_B })]);

    const found = await getExpenseRule("b1");
    expect(found?.userId).toBe(USER_B);
  });
});

// ============================================================================
// UPDATE
// ============================================================================

describe("updateIncomeSource", () => {
  beforeEach(() => {
    store.__seedEntities("income_sources", [
      makeIncomeSource({
        id: "s1",
        userId: USER_A,
        name: "Salary",
        amount: 3_000,
        notes: "keep me",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      }),
      makeIncomeSource({ id: "s2", userId: USER_A, name: "Untouched", amount: 500 }),
    ]);
  });

  it("applies the supplied fields and leaves every other field intact", async () => {
    await updateIncomeSource("s1", { amount: 3_500 });

    const stored = storedSource("s1");
    expect(stored.amount).toBe(3_500);
    expect(stored.name).toBe("Salary");
    expect(stored.notes).toBe("keep me");
    expect(stored.startDate).toBe("2026-01-01");
    expect(stored.endDate).toBe("2026-12-31");
    expect(stored.userId).toBe(USER_A);
  });

  it("stamps updatedAt and never rewrites createdAt", async () => {
    const createdBefore = millis(storedSource("s1").createdAt);

    await updateIncomeSource("s1", { isActive: false });

    const stored = storedSource("s1");
    expect(millis(stored.updatedAt)).toBe(frozenMillis());
    expect(millis(stored.createdAt)).toBe(createdBefore);
  });

  it("strips undefined values so they cannot clear a stored field", async () => {
    await updateIncomeSource("s1", { notes: undefined, endDate: undefined, amount: 4_000 });

    const stored = storedSource("s1");
    // CONSEQUENCE, pinned deliberately rather than encoded as a defect: because
    // undefined is dropped instead of translated to deleteField(), there is no
    // payload this layer accepts that CLEARS an optional field. IncomeSourceForm
    // submits `endDate: undefined` when the "has end date" box is unchecked, so
    // an end date, once saved, can never be removed through the UI. The fix site
    // is genuinely ambiguous (this layer already imports `deleteField`, but the
    // caller could equally send an explicit sentinel), which is why this is not
    // an it.fails — it would not turn red if the fix landed in sourceActions.ts.
    expect(stored.notes).toBe("keep me");
    expect(stored.endDate).toBe("2026-12-31");
    expect(stored.amount).toBe(4_000);
  });

  it("replaces scheduleConfig wholesale instead of deep-merging it", async () => {
    store.__seedEntities("income_sources", [
      makeIncomeSource({
        id: "s3",
        userId: USER_A,
        frequency: "semi-monthly",
        scheduleConfig: { specificDays: [15, 30], dayOfMonth: 15 },
      }),
    ]);

    await updateIncomeSource("s3", { scheduleConfig: { specificDays: [1, 16] } });

    // a top-level key in an updateDoc payload overwrites the whole object
    expect(storedSource("s3").scheduleConfig).toEqual({ specificDays: [1, 16] });
  });

  it("touches only the addressed document", async () => {
    await updateIncomeSource("s1", { amount: 9_999 });

    expect(storedSource("s2").amount).toBe(500);
    expect(store.__opsFor("income_sources").map((entry) => entry.id)).toEqual(["s1"]);
  });

  it("throws for a missing document and writes nothing", async () => {
    await expect(updateIncomeSource("missing", { amount: 1 })).rejects.toThrow(
      "Income source with ID missing does not exist"
    );

    expect(store.__ops).toEqual([]);
  });
});

describe("updateExpenseRule", () => {
  beforeEach(() => {
    store.__seedEntities("expense_rules", [
      makeExpenseRule({
        id: "r1",
        userId: USER_A,
        name: "Rent",
        amount: 1_200,
        notes: "keep me",
        endDate: "2026-12-31",
        isPriority: true,
      }),
      makeExpenseRule({ id: "r2", userId: USER_A, name: "Untouched", amount: 42 }),
    ]);
  });

  it("applies the supplied fields and leaves every other field intact", async () => {
    await updateExpenseRule("r1", { amount: 1_350 });

    const stored = storedRule("r1");
    expect(stored.amount).toBe(1_350);
    expect(stored.name).toBe("Rent");
    expect(stored.notes).toBe("keep me");
    expect(stored.endDate).toBe("2026-12-31");
    expect(stored.isPriority).toBe(true);
    expect(stored.userId).toBe(USER_A);
  });

  it("stamps updatedAt and never rewrites createdAt", async () => {
    const createdBefore = millis(storedRule("r1").createdAt);

    await updateExpenseRule("r1", { isActive: false });

    const stored = storedRule("r1");
    expect(millis(stored.updatedAt)).toBe(frozenMillis());
    expect(millis(stored.createdAt)).toBe(createdBefore);
  });

  it("strips undefined values so they cannot clear a stored field", async () => {
    await updateExpenseRule("r1", { notes: undefined, endDate: undefined, amount: 1_400 });

    const stored = storedRule("r1");
    // Same consequence as updateIncomeSource above: ExpenseRuleForm submits
    // `endDate: undefined` / `notes: undefined` for "no end date" / cleared
    // notes, and neither can ever be removed once stored.
    expect(stored.notes).toBe("keep me");
    expect(stored.endDate).toBe("2026-12-31");
    expect(stored.amount).toBe(1_400);
  });

  it("touches only the addressed document", async () => {
    await updateExpenseRule("r1", { amount: 9_999 });

    expect(storedRule("r2").amount).toBe(42);
    expect(store.__opsFor("expense_rules").map((entry) => entry.id)).toEqual(["r1"]);
  });

  it("throws for a missing document and writes nothing", async () => {
    await expect(updateExpenseRule("missing", { amount: 1 })).rejects.toThrow(
      "Expense rule with ID missing does not exist"
    );

    expect(store.__ops).toEqual([]);
  });

  describe("nested config objects are replaced wholesale, not deep-merged", () => {
    it("drops an optional key that the replacement creditConfig omits", async () => {
      store.__seedEntities("expense_rules", [
        makeCreditRule(
          { id: "card-1", userId: USER_A },
          { paymentStrategy: "fixed", fixedPaymentAmount: 500 }
        ),
      ]);

      await updateExpenseRule("card-1", {
        creditConfig: makeCreditConfig({ currentBalance: 3_000 }),
      });

      const stored = storedRule("card-1");
      expect(stored.creditConfig?.currentBalance).toBe(3_000);
      // makeCreditConfig() has no fixedPaymentAmount, and the old one is NOT
      // carried over — the whole object was overwritten.
      expect("fixedPaymentAmount" in (stored.creditConfig as object)).toBe(false);
      expect(stored.creditConfig?.paymentStrategy).toBe("minimum");
    });

    it("drops every key a partial loanConfig omits", async () => {
      store.__seedEntities("expense_rules", [
        makeLoanRule({ id: "loan-1", userId: USER_A }, { paymentsMade: 7 }),
      ]);

      // a caller sending only the field it changed
      await updateExpenseRule("loan-1", {
        loanConfig: { currentBalance: 9_000 } as unknown as ExpenseRule["loanConfig"],
      });

      const stored = storedRule("loan-1");
      // THIS is why updateLoanBalance / updateCreditBalance /
      // updateInstallmentProgress must re-read the rule and spread the old
      // config before writing (expenseRules.ts:116, 139, 152) — a partial
      // config here silently destroys the loan's amortization state.
      expect(stored.loanConfig).toEqual({ currentBalance: 9_000 });
      expect(stored.loanConfig?.paymentsMade).toBeUndefined();
      expect(stored.loanConfig?.principalAmount).toBeUndefined();
    });

    it("leaves sibling configs alone when only one is replaced", async () => {
      store.__seedEntities("expense_rules", [
        makeLoanRule({ id: "mixed", userId: USER_A, creditConfig: makeCreditConfig() }),
      ]);

      await updateExpenseRule("mixed", { creditConfig: makeCreditConfig({ currentBalance: 1 }) });

      const stored = storedRule("mixed");
      expect(stored.creditConfig?.currentBalance).toBe(1);
      expect(stored.loanConfig?.principalAmount).toBe(12_000);
    });
  });
});

// ============================================================================
// DELETE
// ============================================================================

describe("deleteIncomeSource", () => {
  it("removes the addressed document and nothing else", async () => {
    store.__seedEntities("income_sources", [
      makeIncomeSource({ id: "s1", userId: USER_A }),
      makeIncomeSource({ id: "s2", userId: USER_A }),
      makeIncomeSource({ id: "b1", userId: USER_B }),
    ]);

    await deleteIncomeSource("s1");

    expect(store.__get("income_sources", "s1")).toBeUndefined();
    expect(ids(store.__all("income_sources")).sort()).toEqual(["b1", "s2"]);
  });

  it("resolves without throwing for a document that never existed", async () => {
    // no existence pre-check, unlike updateIncomeSource
    await expect(deleteIncomeSource("missing")).resolves.toBeUndefined();
  });

  it("performs no ownership check — isolation here rests on security rules", async () => {
    store.__seedEntities("income_sources", [makeIncomeSource({ id: "b1", userId: USER_B })]);

    await deleteIncomeSource("b1");

    expect(store.__count("income_sources")).toBe(0);
  });

  it("leaves the source's stored transactions behind", async () => {
    store.__seedEntities("income_sources", [makeIncomeSource({ id: "s1", userId: USER_A })]);
    store.__seedEntities("transactions", [
      makeCompletedTransaction({
        id: "t-done",
        userId: USER_A,
        sourceType: "income_source",
        sourceId: "s1",
        type: "income",
        actualAmount: 3_000,
      }),
      makeSkippedTransaction({
        id: "t-skipped",
        userId: USER_A,
        sourceType: "income_source",
        sourceId: "s1",
      }),
    ]);

    await deleteIncomeSource("s1");

    // NOT A DEFECT — pinned as CORRECT. Deleting the rule that generated a
    // payment must not erase the record that the money actually moved:
    // `mergeTransactionsWithProjections` deliberately re-emits stored rows whose
    // source no longer exists (projectionMerger.ts:71-83, asserted in
    // tests/integration/projectionMerger.test.ts:423), precisely so realized
    // history survives a rule deletion. `deleteTransactionsBySource` exists in
    // transactions.ts:287 but is called from nowhere in app/, which is
    // consistent with that intent rather than an oversight.
    expect(store.__count("transactions")).toBe(2);
    expect(store.__get("transactions", "t-done")).toBeDefined();
    expect(store.__get("transactions", "t-skipped")).toBeDefined();
    expect(store.__opsFor("transactions")).toEqual([]);
  });
});

describe("deleteExpenseRule", () => {
  it("removes the addressed document and nothing else", async () => {
    store.__seedEntities("expense_rules", [
      makeExpenseRule({ id: "r1", userId: USER_A }),
      makeExpenseRule({ id: "r2", userId: USER_A }),
      makeExpenseRule({ id: "b1", userId: USER_B }),
    ]);

    await deleteExpenseRule("r1");

    expect(store.__get("expense_rules", "r1")).toBeUndefined();
    expect(ids(store.__all("expense_rules")).sort()).toEqual(["b1", "r2"]);
  });

  it("resolves without throwing for a document that never existed", async () => {
    await expect(deleteExpenseRule("missing")).resolves.toBeUndefined();
  });

  it("performs no ownership check — isolation here rests on security rules", async () => {
    store.__seedEntities("expense_rules", [makeExpenseRule({ id: "b1", userId: USER_B })]);

    await deleteExpenseRule("b1");

    expect(store.__count("expense_rules")).toBe(0);
  });

  it("leaves the rule's completed transactions behind", async () => {
    store.__seedEntities("expense_rules", [makeLoanRule({ id: "loan-1", userId: USER_A })]);
    store.__seedEntities("transactions", [
      makeCompletedTransaction({
        id: "t-paid",
        userId: USER_A,
        sourceType: "expense_rule",
        sourceId: "loan-1",
        actualAmount: 565,
      }),
    ]);

    await deleteExpenseRule("loan-1");

    // Same conclusion as deleteIncomeSource: CORRECT, not a defect. See the
    // comment there for the projectionMerger reasoning.
    expect(store.__get("transactions", "t-paid")).toBeDefined();
    expect(store.__opsFor("transactions")).toEqual([]);
  });

  it("does not touch the other collection", async () => {
    store.__seedEntities("expense_rules", [makeExpenseRule({ id: "r1", userId: USER_A })]);
    store.__seedEntities("income_sources", [makeIncomeSource({ id: "s1", userId: USER_A })]);

    await deleteExpenseRule("r1");

    expect(store.__count("income_sources")).toBe(1);
    expect(store.__opsFor("income_sources")).toEqual([]);
  });
});

// ============================================================================
// updateCreditBalance (expenseRules.ts:139)
// ============================================================================

/**
 * NOTE ON REACHABILITY: `updateCreditBalance` is DEAD CODE. Grepping app/ finds
 * only its definition (expenseRules.ts:139) and its re-export
 * (firestore/index.ts:53) — no call site anywhere. Meanwhile
 * `completeTransaction` (transactions.ts:181-192) branches on `loanConfig` and
 * `installmentConfig` only, so paying a credit card never moves
 * `creditConfig.currentBalance`. That defect is already encoded at
 * tests/integration/actualMutation.firestore.test.ts as
 * `it.fails("KNOWN DEFECT: completing a card payment reduces the card
 * balance")` and is NOT duplicated
 * here. Worth stating because the fix for it is probably one line: add a
 * `creditConfig` branch that calls this function. The tests below pin the
 * contract that branch would rely on.
 */
describe("updateCreditBalance", () => {
  beforeEach(() => {
    store.__seedEntities("expense_rules", [
      makeCreditRule({ id: "card-1", userId: USER_A }, { currentBalance: 5_000 }),
    ]);
  });

  it("writes the new balance into creditConfig", async () => {
    await updateCreditBalance("card-1", 4_100);

    expect(storedRule("card-1").creditConfig?.currentBalance).toBe(4_100);
  });

  it("preserves every other creditConfig field", async () => {
    await updateCreditBalance("card-1", 4_100);

    const config = storedRule("card-1").creditConfig;
    expect(config?.creditLimit).toBe(10_000);
    expect(config?.apr).toBe(24);
    expect(config?.minimumPaymentPercent).toBe(2);
    expect(config?.minimumPaymentFloor).toBe(25);
    expect(config?.minimumPaymentMethod).toBe("percent_only");
    expect(config?.statementDate).toBe(1);
    expect(config?.dueDate).toBe(15);
    expect(config?.paymentStrategy).toBe("minimum");
  });

  it("stamps updatedAt via updateExpenseRule and leaves the rest of the rule alone", async () => {
    await updateCreditBalance("card-1", 4_100);

    const stored = storedRule("card-1");
    expect(millis(stored.updatedAt)).toBe(frozenMillis());
    expect(stored.name).toBe("Visa");
    expect(stored.amount).toBe(100);
  });

  it("never deactivates the rule, even at a zero balance", async () => {
    await updateCreditBalance("card-1", 0);

    const stored = storedRule("card-1");
    expect(stored.creditConfig?.currentBalance).toBe(0);
    // unlike updateLoanBalance, which flips isActive off when a loan is paid
    // off: a fully paid card is still an open account with a due date
    expect(stored.isActive).toBe(true);
  });

  it("stores a negative balance verbatim — no clamping to zero", async () => {
    await updateCreditBalance("card-1", -250);

    // deliberate: overpaying a card leaves a credit, unlike a loan balance
    // which updateLoanBalance floors at 0
    expect(storedRule("card-1").creditConfig?.currentBalance).toBe(-250);
  });

  it("returns without writing when the rule does not exist", async () => {
    await expect(updateCreditBalance("nope", 1_000)).resolves.toBeUndefined();

    expect(store.__ops).toEqual([]);
  });

  it("returns without writing when the rule has no creditConfig", async () => {
    store.__seedEntities("expense_rules", [makeExpenseRule({ id: "plain", userId: USER_A })]);

    await expect(updateCreditBalance("plain", 1_000)).resolves.toBeUndefined();

    expect(store.__ops).toEqual([]);
    expect("creditConfig" in storedRule("plain")).toBe(false);
  });

  it("issues exactly one write for the happy path", async () => {
    await updateCreditBalance("card-1", 4_100);

    const ops = store.__opsFor("expense_rules");
    expect(ops.map((entry) => entry.op)).toEqual(["update"]);
    expect(ops[0].id).toBe("card-1");
  });
});

// ============================================================================
// SUBSCRIPTIONS
// ============================================================================

describe("subscribeToIncomeSources", () => {
  beforeEach(seedSources);

  it("emits immediately with the current rows", () => {
    const emissions: IncomeSource[][] = [];
    const unsubscribe = subscribeToIncomeSources(USER_A, (rows) => emissions.push(rows));

    expect(emissions).toHaveLength(1);
    expect(ids(emissions[0]).sort()).toEqual(["s1", "s2", "s3"]);
    unsubscribe();
  });

  it("emits rows with their document ids merged in", () => {
    const emissions: IncomeSource[][] = [];
    const unsubscribe = subscribeToIncomeSources(USER_A, (rows) => emissions.push(rows));

    expect(emissions[0].find((row) => row.id === "s1")?.name).toBe("Alpha");
    unsubscribe();
  });

  it("excludes the other user's rows", () => {
    const emissions: IncomeSource[][] = [];
    const unsubscribe = subscribeToIncomeSources(USER_A, (rows) => emissions.push(rows));

    expect(ids(emissions[0])).not.toContain("b1");
    expect(emissions[0].every((row) => row.userId === USER_A)).toBe(true);
    unsubscribe();
  });

  it("emits only the other user's rows for that user", () => {
    const emissions: IncomeSource[][] = [];
    const unsubscribe = subscribeToIncomeSources(USER_B, (rows) => emissions.push(rows));

    expect(ids(emissions[0])).toEqual(["b1"]);
    unsubscribe();
  });

  it("honours activeOnly on the first emission", () => {
    const emissions: IncomeSource[][] = [];
    const unsubscribe = subscribeToIncomeSources(USER_A, (rows) => emissions.push(rows), true);

    expect(ids(emissions[0]).sort()).toEqual(["s1", "s3"]);
    unsubscribe();
  });

  it("re-emits with the new row after an add", async () => {
    const emissions: IncomeSource[][] = [];
    const unsubscribe = subscribeToIncomeSources(USER_A, (rows) => emissions.push(rows));

    const created = await addIncomeSource(USER_A, sourceInput({ name: "Bonus" }));

    expect(emissions.length).toBeGreaterThan(1);
    const latest = emissions[emissions.length - 1];
    expect(ids(latest)).toContain(created.id);
    expect(latest.find((row) => row.id === created.id)?.name).toBe("Bonus");
    unsubscribe();
  });

  it("re-emits without the row after a delete", async () => {
    const emissions: IncomeSource[][] = [];
    const unsubscribe = subscribeToIncomeSources(USER_A, (rows) => emissions.push(rows));

    await deleteIncomeSource("s1");

    expect(ids(emissions[emissions.length - 1]).sort()).toEqual(["s2", "s3"]);
    unsubscribe();
  });

  it("drops a row from an activeOnly stream once it is deactivated", async () => {
    const emissions: IncomeSource[][] = [];
    const unsubscribe = subscribeToIncomeSources(USER_A, (rows) => emissions.push(rows), true);

    await updateIncomeSource("s3", { isActive: false });

    expect(ids(emissions[emissions.length - 1])).toEqual(["s1"]);
    unsubscribe();
  });

  it("never emits the other user's writes in this user's rows", async () => {
    const emissions: IncomeSource[][] = [];
    const unsubscribe = subscribeToIncomeSources(USER_A, (rows) => emissions.push(rows));

    await addIncomeSource(USER_B, sourceInput({ name: "Their bonus" }));

    expect(emissions.every((rows) => rows.every((row) => row.userId === USER_A))).toBe(true);
    expect(emissions.every((rows) => !rows.some((row) => row.name === "Their bonus"))).toBe(true);
    unsubscribe();
  });

  it("stops emitting once unsubscribed", async () => {
    const emissions: IncomeSource[][] = [];
    const unsubscribe = subscribeToIncomeSources(USER_A, (rows) => emissions.push(rows));
    const countAtUnsubscribe = emissions.length;

    unsubscribe();
    await addIncomeSource(USER_A, sourceInput({ name: "After" }));
    await deleteIncomeSource("s1");

    expect(emissions).toHaveLength(countAtUnsubscribe);
  });
});

describe("subscribeToExpenseRules", () => {
  beforeEach(seedRules);

  it("emits immediately with the current rows", () => {
    const emissions: ExpenseRule[][] = [];
    const unsubscribe = subscribeToExpenseRules(USER_A, (rows) => emissions.push(rows));

    expect(emissions).toHaveLength(1);
    expect(ids(emissions[0]).sort()).toEqual(["r1", "r2", "r3"]);
    unsubscribe();
  });

  it("emits rows with their document ids merged in", () => {
    const emissions: ExpenseRule[][] = [];
    const unsubscribe = subscribeToExpenseRules(USER_A, (rows) => emissions.push(rows));

    expect(emissions[0].find((row) => row.id === "r1")?.name).toBe("Alpha");
    unsubscribe();
  });

  it("excludes the other user's rows", () => {
    const emissions: ExpenseRule[][] = [];
    const unsubscribe = subscribeToExpenseRules(USER_A, (rows) => emissions.push(rows));

    expect(ids(emissions[0])).not.toContain("b1");
    expect(emissions[0].every((row) => row.userId === USER_A)).toBe(true);
    unsubscribe();
  });

  it("emits only the other user's rows for that user", () => {
    const emissions: ExpenseRule[][] = [];
    const unsubscribe = subscribeToExpenseRules(USER_B, (rows) => emissions.push(rows));

    expect(ids(emissions[0])).toEqual(["b1"]);
    unsubscribe();
  });

  it("honours activeOnly on the first emission", () => {
    const emissions: ExpenseRule[][] = [];
    const unsubscribe = subscribeToExpenseRules(USER_A, (rows) => emissions.push(rows), true);

    expect(ids(emissions[0]).sort()).toEqual(["r1", "r3"]);
    unsubscribe();
  });

  it("re-emits with the new row after an add", async () => {
    const emissions: ExpenseRule[][] = [];
    const unsubscribe = subscribeToExpenseRules(USER_A, (rows) => emissions.push(rows));

    const created = await addExpenseRule(USER_A, ruleInput({ name: "Gym" }));

    expect(emissions.length).toBeGreaterThan(1);
    const latest = emissions[emissions.length - 1];
    expect(latest.find((row) => row.id === created.id)?.name).toBe("Gym");
    unsubscribe();
  });

  it("re-emits the updated balance after updateCreditBalance", async () => {
    store.__seedEntities("expense_rules", [
      makeCreditRule({ id: "card-1", userId: USER_A }, { currentBalance: 5_000 }),
    ]);
    const emissions: ExpenseRule[][] = [];
    const unsubscribe = subscribeToExpenseRules(USER_A, (rows) => emissions.push(rows));

    await updateCreditBalance("card-1", 3_750);

    const latest = emissions[emissions.length - 1];
    expect(latest.find((row) => row.id === "card-1")?.creditConfig?.currentBalance).toBe(3_750);
    unsubscribe();
  });

  it("re-emits without the row after a delete", async () => {
    const emissions: ExpenseRule[][] = [];
    const unsubscribe = subscribeToExpenseRules(USER_A, (rows) => emissions.push(rows));

    await deleteExpenseRule("r1");

    expect(ids(emissions[emissions.length - 1]).sort()).toEqual(["r2", "r3"]);
    unsubscribe();
  });

  it("drops a row from an activeOnly stream once it is deactivated", async () => {
    const emissions: ExpenseRule[][] = [];
    const unsubscribe = subscribeToExpenseRules(USER_A, (rows) => emissions.push(rows), true);

    await updateExpenseRule("r3", { isActive: false });

    expect(ids(emissions[emissions.length - 1])).toEqual(["r1"]);
    unsubscribe();
  });

  it("never emits the other user's writes in this user's rows", async () => {
    const emissions: ExpenseRule[][] = [];
    const unsubscribe = subscribeToExpenseRules(USER_A, (rows) => emissions.push(rows));

    await addExpenseRule(USER_B, ruleInput({ name: "Their rent" }));

    expect(emissions.every((rows) => rows.every((row) => row.userId === USER_A))).toBe(true);
    expect(emissions.every((rows) => !rows.some((row) => row.name === "Their rent"))).toBe(true);
    unsubscribe();
  });

  it("stops emitting once unsubscribed", async () => {
    const emissions: ExpenseRule[][] = [];
    const unsubscribe = subscribeToExpenseRules(USER_A, (rows) => emissions.push(rows));
    const countAtUnsubscribe = emissions.length;

    unsubscribe();
    await addExpenseRule(USER_A, ruleInput({ name: "After" }));
    await deleteExpenseRule("r1");

    expect(emissions).toHaveLength(countAtUnsubscribe);
  });

  it("keeps the two subscriptions independent", async () => {
    const sourceEmissions: IncomeSource[][] = [];
    const ruleEmissions: ExpenseRule[][] = [];
    const unsubSources = subscribeToIncomeSources(USER_A, (rows) => sourceEmissions.push(rows));
    const unsubRules = subscribeToExpenseRules(USER_A, (rows) => ruleEmissions.push(rows));

    await addExpenseRule(USER_A, ruleInput({ name: "New rule" }));

    // the income stream may be re-run, but it must never surface an expense rule
    expect(sourceEmissions.every((rows) => rows.every((row) => "sourceType" in row))).toBe(true);
    expect(ruleEmissions[ruleEmissions.length - 1].some((row) => row.name === "New rule")).toBe(
      true
    );
    unsubSources();
    unsubRules();
  });
});
