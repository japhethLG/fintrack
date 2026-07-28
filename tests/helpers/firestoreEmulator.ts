import { vi } from "vitest";

/**
 * In-memory emulation of the `firebase/firestore` SDK surface used by
 * `app/lib/firebase/firestore/*`.
 *
 * Why emulate the SDK rather than stub the repo's own firestore module:
 * the interesting mutation semantics — balance reversal when a completed
 * transaction is re-completed, variance recalculation, loan counter
 * decrementing on revert — live *inside* `app/lib/firebase/firestore/`.
 * Stubbing that module would mock away the very logic under test. Mocking one
 * layer lower means the real repo code runs against a real (if simple) store.
 *
 * Usage in a test file (both mocks are required; `vi.mock` is hoisted):
 *
 *   vi.mock("firebase/firestore", () => import("../helpers/firestoreEmulator"));
 *   vi.mock("@/lib/firebase/config", () => import("../helpers/firebaseConfigMock"));
 *
 *   import * as store from "../helpers/firestoreEmulator";
 *   beforeEach(() => store.__reset());
 *
 * Not supported (nothing in this repo uses it): sub-collections, transactions,
 * cursor pagination, array-membership operators beyond `in`, composite index
 * semantics.
 */

// ============================================================================
// STORE
// ============================================================================

type DocData = Record<string, unknown>;

const collections = new Map<string, Map<string, DocData>>();
let autoId = 0;

/** Every write, in order — for asserting call sequences and write counts. */
export interface OpLogEntry {
  op: "set" | "update" | "delete" | "add";
  collection: string;
  id: string;
  data?: DocData;
}
export const __ops: OpLogEntry[] = [];

const getCollection = (name: string): Map<string, DocData> => {
  let existing = collections.get(name);
  if (!existing) {
    existing = new Map<string, DocData>();
    collections.set(name, existing);
  }
  return existing;
};

/**
 * Structural clone that passes class instances (Timestamp, Date) through by
 * reference — `structuredClone` would strip their methods.
 */
const clone = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(clone) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = clone(inner);
  }
  return out as T;
};

/** Reset all data, the auto-id counter, the op log, and snapshot listeners. */
export const __reset = (): void => {
  collections.clear();
  __ops.length = 0;
  listeners.length = 0;
  autoId = 0;
};

/**
 * Insert a document directly, bypassing the SDK surface (test arrangement).
 *
 * Accepts any object rather than `DocData`: the app's entity types are
 * interfaces without index signatures, so `UserProfile`/`Transaction` are not
 * assignable to `Record<string, unknown>`. Widening here keeps every call site
 * cast-free.
 */
export const __seed = (collectionName: string, id: string, data: object): void => {
  getCollection(collectionName).set(id, clone(data as DocData));
};

/** Seed many documents keyed by id. */
export const __seedAll = (collectionName: string, docs: Record<string, object>): void => {
  Object.entries(docs).forEach(([id, data]) => __seed(collectionName, id, data));
};

/**
 * Seed entities that carry their own `id` field (income sources, expense rules,
 * transactions), using that field as the document id.
 */
export const __seedEntities = <T extends { id: string }>(
  collectionName: string,
  entities: T[]
): void => {
  entities.forEach((entity) => __seed(collectionName, entity.id, entity as unknown as DocData));
};

/** Read a document back out (test assertion). */
export const __get = <T = DocData>(collectionName: string, id: string): T | undefined => {
  const found = getCollection(collectionName).get(id);
  return found === undefined ? undefined : (clone(found) as T);
};

/** All documents in a collection, as `{ id, ...data }` (test assertion). */
export const __all = <T = DocData>(collectionName: string): (T & { id: string })[] =>
  Array.from(getCollection(collectionName).entries()).map(
    ([id, data]) => ({ id, ...clone(data) }) as T & { id: string }
  );

/** Count of documents in a collection. */
export const __count = (collectionName: string): number => getCollection(collectionName).size;

/** Writes recorded against one collection, in order. */
export const __opsFor = (collectionName: string): OpLogEntry[] =>
  __ops.filter((entry) => entry.collection === collectionName);

// ============================================================================
// REFERENCES / SENTINELS
// ============================================================================

interface CollectionRef {
  __kind: "collection";
  path: string;
}
interface DocRef {
  __kind: "doc";
  collection: string;
  id: string;
}
interface Constraint {
  __kind: "where" | "orderBy" | "limit";
  field?: string;
  op?: string;
  value?: unknown;
  direction?: "asc" | "desc";
  count?: number;
}
interface QueryRef {
  __kind: "query";
  collection: string;
  constraints: Constraint[];
}

const DELETE_SENTINEL = { __kind: "deleteField" } as const;

const isCollectionRef = (value: unknown): value is CollectionRef =>
  !!value && (value as CollectionRef).__kind === "collection";

export const collection = (_db: unknown, path: string): CollectionRef => ({
  __kind: "collection",
  path,
});

export const doc = (first: unknown, path?: string, id?: string): DocRef => {
  // doc(collectionRef) — auto-generated id (used by batch writes)
  if (isCollectionRef(first)) {
    autoId += 1;
    return { __kind: "doc", collection: first.path, id: `auto-${autoId}` };
  }
  // doc(db, collectionPath, id)
  return { __kind: "doc", collection: path as string, id: id as string };
};

export const where = (field: string, op: string, value: unknown): Constraint => ({
  __kind: "where",
  field,
  op,
  value,
});

export const orderBy = (field: string, direction: "asc" | "desc" = "asc"): Constraint => ({
  __kind: "orderBy",
  field,
  direction,
});

export const limit = (count: number): Constraint => ({ __kind: "limit", count });

export const query = (ref: CollectionRef, ...constraints: Constraint[]): QueryRef => ({
  __kind: "query",
  collection: ref.path,
  constraints,
});

export const deleteField = () => DELETE_SENTINEL;

/** Minimal Timestamp stand-in. Reads the (possibly faked) system clock. */
export class Timestamp {
  constructor(
    public readonly seconds: number,
    public readonly nanoseconds: number
  ) {}

  static now(): Timestamp {
    return Timestamp.fromMillis(Date.now());
  }

  static fromDate(date: Date): Timestamp {
    return Timestamp.fromMillis(date.getTime());
  }

  static fromMillis(millis: number): Timestamp {
    return new Timestamp(Math.floor(millis / 1000), (millis % 1000) * 1e6);
  }

  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }

  toDate(): Date {
    return new Date(this.toMillis());
  }

  isEqual(other: Timestamp): boolean {
    return this.seconds === other.seconds && this.nanoseconds === other.nanoseconds;
  }
}

/** Type-only export mirrored from the real SDK. */
export type QueryConstraint = Constraint;

// ============================================================================
// SNAPSHOTS
// ============================================================================

const docSnapshot = (ref: DocRef) => {
  const data = getCollection(ref.collection).get(ref.id);
  return {
    id: ref.id,
    ref,
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : clone(data)),
  };
};

const compare = (a: unknown, b: unknown): number => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
};

const matches = (data: DocData, constraint: Constraint): boolean => {
  const actual = data[constraint.field as string];
  const expected = constraint.value;
  switch (constraint.op) {
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case ">=":
      return compare(actual, expected) >= 0;
    case "<=":
      return compare(actual, expected) <= 0;
    case ">":
      return compare(actual, expected) > 0;
    case "<":
      return compare(actual, expected) < 0;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    default:
      throw new Error(`firestoreEmulator: unsupported where operator "${constraint.op}"`);
  }
};

const runQuery = (target: QueryRef | CollectionRef) => {
  const collectionName = isCollectionRef(target) ? target.path : target.collection;
  const constraints = isCollectionRef(target) ? [] : target.constraints;

  let rows = Array.from(getCollection(collectionName).entries()).map(([id, data]) => ({
    id,
    data,
  }));

  constraints
    .filter((c) => c.__kind === "where")
    .forEach((c) => {
      rows = rows.filter((row) => matches(row.data, c));
    });

  const ordering = constraints.filter((c) => c.__kind === "orderBy");
  if (ordering.length > 0) {
    rows.sort((left, right) => {
      for (const order of ordering) {
        const result = compare(left.data[order.field as string], right.data[order.field as string]);
        if (result !== 0) return order.direction === "desc" ? -result : result;
      }
      return 0;
    });
  }

  const cap = constraints.find((c) => c.__kind === "limit");
  if (cap?.count !== undefined) rows = rows.slice(0, cap.count);

  const docs = rows.map((row) => ({
    id: row.id,
    ref: { __kind: "doc", collection: collectionName, id: row.id } as DocRef,
    exists: () => true,
    data: () => clone(row.data),
  }));

  return {
    empty: docs.length === 0,
    size: docs.length,
    docs,
    forEach: (fn: (snapshot: (typeof docs)[number]) => void) => docs.forEach(fn),
  };
};

// ============================================================================
// LISTENERS
// ============================================================================

type Listener = { target: DocRef | QueryRef | CollectionRef; callback: (snapshot: unknown) => void };
const listeners: Listener[] = [];

const emit = (listener: Listener) => {
  if ((listener.target as DocRef).__kind === "doc") {
    listener.callback(docSnapshot(listener.target as DocRef));
  } else {
    listener.callback(runQuery(listener.target as QueryRef));
  }
};

/** Re-emit every registered listener — called after each write. */
const notify = () => listeners.forEach(emit);

export const onSnapshot = (
  target: DocRef | QueryRef | CollectionRef,
  callback: (snapshot: unknown) => void
): (() => void) => {
  const listener: Listener = { target, callback };
  listeners.push(listener);
  emit(listener); // Firestore fires immediately with current state
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  };
};

/** Force a re-emit without a write (test convenience). */
export const __notify = (): void => notify();

// ============================================================================
// WRITES
// ============================================================================

/** Apply an update payload, honouring dotted field paths and deleteField(). */
const applyUpdates = (target: DocData, updates: DocData): DocData => {
  const next = clone(target);
  Object.entries(updates).forEach(([path, value]) => {
    const segments = path.split(".");
    if (segments.length === 1) {
      if (value === DELETE_SENTINEL) delete next[path];
      else next[path] = value as never;
      return;
    }
    let cursor = next as Record<string, unknown>;
    for (const segment of segments.slice(0, -1)) {
      if (typeof cursor[segment] !== "object" || cursor[segment] === null) cursor[segment] = {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
    const leaf = segments[segments.length - 1];
    if (value === DELETE_SENTINEL) delete cursor[leaf];
    else cursor[leaf] = value;
  });
  return next;
};

export const getDoc = vi.fn(async (ref: DocRef) => docSnapshot(ref));

export const getDocs = vi.fn(async (target: QueryRef | CollectionRef) => runQuery(target));

export const addDoc = vi.fn(async (ref: CollectionRef, data: DocData) => {
  autoId += 1;
  const id = `auto-${autoId}`;
  getCollection(ref.path).set(id, clone(data));
  __ops.push({ op: "add", collection: ref.path, id, data: clone(data) });
  notify();
  return { id, ref: { __kind: "doc", collection: ref.path, id } as DocRef };
});

export const setDoc = vi.fn(async (ref: DocRef, data: DocData) => {
  getCollection(ref.collection).set(ref.id, clone(data));
  __ops.push({ op: "set", collection: ref.collection, id: ref.id, data: clone(data) });
  notify();
});

export const updateDoc = vi.fn(async (ref: DocRef, updates: DocData) => {
  const existing = getCollection(ref.collection).get(ref.id);
  if (existing === undefined) {
    // Matches the real SDK: updateDoc on a missing document rejects.
    throw new Error(`firestoreEmulator: no document at ${ref.collection}/${ref.id}`);
  }
  getCollection(ref.collection).set(ref.id, applyUpdates(existing, updates));
  __ops.push({ op: "update", collection: ref.collection, id: ref.id, data: clone(updates) });
  notify();
});

export const deleteDoc = vi.fn(async (ref: DocRef) => {
  getCollection(ref.collection).delete(ref.id);
  __ops.push({ op: "delete", collection: ref.collection, id: ref.id });
  notify();
});

export const writeBatch = vi.fn((_db: unknown) => {
  const queued: (() => void)[] = [];
  const batch = {
    set(ref: DocRef, data: DocData) {
      queued.push(() => {
        getCollection(ref.collection).set(ref.id, clone(data));
        __ops.push({ op: "set", collection: ref.collection, id: ref.id, data: clone(data) });
      });
      return batch;
    },
    update(ref: DocRef, updates: DocData) {
      queued.push(() => {
        const existing = getCollection(ref.collection).get(ref.id);
        if (existing === undefined) return;
        getCollection(ref.collection).set(ref.id, applyUpdates(existing, updates));
        __ops.push({ op: "update", collection: ref.collection, id: ref.id, data: clone(updates) });
      });
      return batch;
    },
    delete(ref: DocRef) {
      queued.push(() => {
        getCollection(ref.collection).delete(ref.id);
        __ops.push({ op: "delete", collection: ref.collection, id: ref.id });
      });
      return batch;
    },
    async commit() {
      queued.forEach((apply) => apply());
      queued.length = 0;
      notify();
    },
  };
  return batch;
});
