/**
 * In-memory fake of the `firebase/firestore` surface the app uses. Ported from
 * tests/helpers/firestoreEmulator.ts (vitest) and made closer to the real SDK:
 *
 *  - `undefined` field values are REJECTED (real SDK does, and the app carries
 *    a removeUndefined() helper for exactly this reason)
 *  - updateDoc on a missing doc rejects with code "not-found"
 *  - writeBatch is atomic: validated on commit, nothing applied on failure
 *  - runTransaction: optimistic (reads re-validated at commit, up to 5 retries),
 *    reads-before-writes enforced, writes applied atomically
 *  - queries: docs missing an orderBy/inequality field are excluded; default
 *    order is by document id; ties broken by document id
 *  - onSnapshot: first snapshot is async, later ones fire only when the
 *    result actually changed (like the real SDK), from a microtask so a
 *    faked Playwright clock cannot stall them
 *  - dotted field paths + deleteField/increment/serverTimestamp/arrayUnion/
 *    arrayRemove in updateDoc; deep `merge` in setDoc
 *
 * NOT emulated: security rules, composite-index requirements (real Firestore
 * rejects some multi-field queries without an index; this fake runs them
 * anyway), offline/latency, sub-collection listeners beyond path-keyed
 * collections.
 */
import {
  FieldValue,
  FirebaseError,
  Timestamp,
  addSnapshotListener,
  assertNoUndefined,
  checkWriteFault,
  clone,
  commit,
  compareValues,
  deepEqual,
  getByPath,
  getCollection,
  listDocs,
  logOp,
  nextAutoId,
  readDoc,
  signatureOf,
} from "./core";
import type { FirebaseApp } from "./firebase-app";

export { Timestamp };

type Data = Record<string, unknown>;

// ============================================================================
// REFERENCES
// ============================================================================

export interface Firestore {
  readonly type: "firestore";
  readonly app: FirebaseApp | null;
}

export interface CollectionReference {
  readonly type: "collection";
  readonly path: string;
  readonly id: string;
}

export interface DocumentReference {
  readonly type: "document";
  readonly path: string;
  readonly id: string;
  /** Path of the collection holding this doc. */
  readonly parentPath: string;
}

export interface Query {
  readonly type: "query";
  readonly collectionPath: string;
  readonly constraints: QueryConstraint[];
}

export type QueryConstraint =
  | { readonly type: "where"; field: string; op: WhereOp; value: unknown }
  | { readonly type: "orderBy"; field: string; direction: "asc" | "desc" }
  | { readonly type: "limit"; count: number };

export type WhereOp =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "in"
  | "not-in"
  | "array-contains"
  | "array-contains-any";

const isFirestore = (v: unknown): v is Firestore => (v as Firestore)?.type === "firestore";
const isCollection = (v: unknown): v is CollectionReference => (v as CollectionReference)?.type === "collection";
const isDocRef = (v: unknown): v is DocumentReference => (v as DocumentReference)?.type === "document";
const isQuery = (v: unknown): v is Query => (v as Query)?.type === "query";

export const getFirestore = (app?: FirebaseApp): Firestore => ({ type: "firestore", app: app ?? null });

const makeCollectionRef = (path: string): CollectionReference => ({
  type: "collection",
  path,
  id: path.split("/").pop() as string,
});

const makeDocRef = (collectionPath: string, id: string): DocumentReference => ({
  type: "document",
  path: `${collectionPath}/${id}`,
  id,
  parentPath: collectionPath,
});

const segmentsOf = (base: string, more: string[]): string[] =>
  [base, ...more].join("/").split("/").filter(Boolean);

export const collection = (parent: Firestore | CollectionReference | DocumentReference, path: string, ...more: string[]): CollectionReference => {
  const base = isFirestore(parent) ? "" : parent.path;
  const segs = segmentsOf(base, [path, ...more]);
  if (segs.length % 2 === 0) {
    throw new FirebaseError("invalid-argument", `Invalid collection reference. Collection references must have an odd number of segments, but ${segs.join("/")} has ${segs.length}.`);
  }
  return makeCollectionRef(segs.join("/"));
};

export function doc(parent: Firestore | CollectionReference | DocumentReference, path?: string, ...more: string[]): DocumentReference {
  if (isCollection(parent) && path === undefined) {
    return makeDocRef(parent.path, nextAutoId());
  }
  const base = isFirestore(parent) ? "" : parent.path;
  const segs = segmentsOf(base, [path as string, ...more]);
  if (segs.length % 2 !== 0) {
    throw new FirebaseError("invalid-argument", `Invalid document reference. Document references must have an even number of segments, but ${segs.join("/")} has ${segs.length}.`);
  }
  const id = segs.pop() as string;
  return makeDocRef(segs.join("/"), id);
}

// ============================================================================
// CONSTRAINTS
// ============================================================================

const WHERE_OPS: WhereOp[] = ["==", "!=", "<", "<=", ">", ">=", "in", "not-in", "array-contains", "array-contains-any"];

export const where = (field: string, op: WhereOp, value: unknown): QueryConstraint => {
  if (!WHERE_OPS.includes(op)) {
    throw new FirebaseError("invalid-argument", `Invalid Query. Unsupported operator '${op}'.`);
  }
  if (value === undefined) {
    throw new FirebaseError("invalid-argument", `Function where() called with invalid data. Unsupported field value: undefined`);
  }
  return { type: "where", field, op, value };
};

export const orderBy = (field: string, direction: "asc" | "desc" = "asc"): QueryConstraint => ({
  type: "orderBy",
  field,
  direction,
});

export const limit = (count: number): QueryConstraint => ({ type: "limit", count });

export const query = (target: CollectionReference | Query, ...constraints: QueryConstraint[]): Query => ({
  type: "query",
  collectionPath: isQuery(target) ? target.collectionPath : target.path,
  constraints: [...(isQuery(target) ? target.constraints : []), ...constraints],
});

// ============================================================================
// FIELD VALUES
// ============================================================================

export const deleteField = (): FieldValue => new FieldValue("delete");
export const serverTimestamp = (): FieldValue => new FieldValue("serverTimestamp");
export const increment = (n: number): FieldValue => new FieldValue("increment", n);
export const arrayUnion = (...items: unknown[]): FieldValue => new FieldValue("arrayUnion", items);
export const arrayRemove = (...items: unknown[]): FieldValue => new FieldValue("arrayRemove", items);

// ============================================================================
// SNAPSHOTS
// ============================================================================

const metadata = () => ({ hasPendingWrites: false, fromCache: false, isEqual: () => true });

export interface DocumentSnapshot {
  readonly id: string;
  readonly ref: DocumentReference;
  readonly metadata: ReturnType<typeof metadata>;
  exists(): boolean;
  data(): Data | undefined;
  get(field: string): unknown;
}

const makeDocSnapshot = (ref: DocumentReference): DocumentSnapshot => {
  const raw = readDoc(ref.parentPath, ref.id);
  const snapshotData = raw === undefined ? undefined : clone(raw);
  return {
    id: ref.id,
    ref,
    metadata: metadata(),
    exists: () => snapshotData !== undefined,
    data: () => (snapshotData === undefined ? undefined : clone(snapshotData)),
    get: (field: string) => (snapshotData === undefined ? undefined : getByPath(snapshotData, field)),
  };
};

export interface QuerySnapshot {
  readonly docs: DocumentSnapshot[];
  readonly empty: boolean;
  readonly size: number;
  readonly metadata: ReturnType<typeof metadata>;
  forEach(fn: (snapshot: DocumentSnapshot) => void): void;
}

const matchesWhere = (data: Data, c: Extract<QueryConstraint, { type: "where" }>): boolean => {
  const actual = getByPath(data, c.field);
  const expected = c.value;
  const comparable = actual !== undefined && compareValuesSameType(actual, expected);
  switch (c.op) {
    case "==":
      return actual !== undefined && deepEqual(actual, expected);
    case "!=":
      return actual !== undefined && !deepEqual(actual, expected);
    case "<":
      return comparable && compareValues(actual, expected) < 0;
    case "<=":
      return comparable && compareValues(actual, expected) <= 0;
    case ">":
      return comparable && compareValues(actual, expected) > 0;
    case ">=":
      return comparable && compareValues(actual, expected) >= 0;
    case "in":
      return actual !== undefined && Array.isArray(expected) && expected.some((e) => deepEqual(actual, e));
    case "not-in":
      return actual !== undefined && Array.isArray(expected) && !expected.some((e) => deepEqual(actual, e));
    case "array-contains":
      return Array.isArray(actual) && actual.some((e) => deepEqual(e, expected));
    case "array-contains-any":
      return Array.isArray(actual) && Array.isArray(expected) && actual.some((a) => expected.some((e) => deepEqual(a, e)));
  }
};

/** Inequality operators only match values of the same Firestore type. */
const compareValuesSameType = (a: unknown, b: unknown): boolean => {
  const kind = (v: unknown) => (v === null ? "null" : v instanceof Timestamp ? "timestamp" : Array.isArray(v) ? "array" : typeof v);
  return kind(a) === kind(b);
};

const runQuery = (target: CollectionReference | Query): QuerySnapshot => {
  const collectionPath = isQuery(target) ? target.collectionPath : target.path;
  const constraints = isQuery(target) ? target.constraints : [];

  let rows = listDocs(collectionPath);

  const wheres = constraints.filter((c): c is Extract<QueryConstraint, { type: "where" }> => c.type === "where");
  const orders = constraints.filter((c): c is Extract<QueryConstraint, { type: "orderBy" }> => c.type === "orderBy");
  const cap = constraints.filter((c): c is Extract<QueryConstraint, { type: "limit" }> => c.type === "limit").pop();

  rows = rows.filter((row) => wheres.every((w) => matchesWhere(row.data, w)));

  // Real Firestore orders by any inequality field first when no orderBy is set.
  const ineq = wheres.find((w) => ["<", "<=", ">", ">=", "!=", "not-in"].includes(w.op));
  const sortKeys: Array<{ field: string; direction: "asc" | "desc" }> = orders.map((o) => ({
    field: o.field,
    direction: o.direction,
  }));
  if (sortKeys.length === 0 && ineq) sortKeys.push({ field: ineq.field, direction: "asc" });

  // Docs lacking an ordered field are not returned (real behaviour).
  rows = rows.filter((row) => sortKeys.every((k) => getByPath(row.data, k.field) !== undefined));

  const idDirection = sortKeys.length > 0 ? sortKeys[sortKeys.length - 1].direction : "asc";
  rows.sort((l, r) => {
    for (const k of sortKeys) {
      const res = compareValues(getByPath(l.data, k.field), getByPath(r.data, k.field));
      if (res !== 0) return k.direction === "desc" ? -res : res;
    }
    const byId = l.id < r.id ? -1 : l.id > r.id ? 1 : 0;
    return idDirection === "desc" ? -byId : byId;
  });

  if (cap) rows = rows.slice(0, cap.count);

  const docs = rows.map((row) => makeDocSnapshot(makeDocRef(collectionPath, row.id)));
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    metadata: metadata(),
    forEach: (fn) => docs.forEach(fn),
  };
};

// ============================================================================
// READS
// ============================================================================

export const getDoc = async (ref: DocumentReference): Promise<DocumentSnapshot> => makeDocSnapshot(ref);

export const getDocs = async (target: CollectionReference | Query): Promise<QuerySnapshot> => runQuery(target);

type SnapshotObserver<T> = ((snapshot: T) => void) | { next?: (snapshot: T) => void; error?: (e: Error) => void };

export function onSnapshot(ref: DocumentReference, observer: SnapshotObserver<DocumentSnapshot>): () => void;
export function onSnapshot(ref: CollectionReference | Query, observer: SnapshotObserver<QuerySnapshot>): () => void;
export function onSnapshot(
  target: DocumentReference | CollectionReference | Query,
  observer: SnapshotObserver<never>
): () => void {
  const next = (typeof observer === "function" ? observer : observer.next) as (s: unknown) => void;
  if (isDocRef(target)) {
    return addSnapshotListener(
      () => signatureOf(readDoc(target.parentPath, target.id) ?? null),
      () => next?.(makeDocSnapshot(target))
    );
  }
  return addSnapshotListener(
    () => signatureOf(runQuery(target).docs.map((d) => [d.id, d.data()])),
    () => next?.(runQuery(target))
  );
}

// ============================================================================
// WRITES
// ============================================================================

const setPath = (target: Data, path: string, value: unknown): void => {
  const segs = path.split(".");
  let cursor = target;
  for (const seg of segs.slice(0, -1)) {
    if (typeof cursor[seg] !== "object" || cursor[seg] === null || Array.isArray(cursor[seg])) cursor[seg] = {};
    cursor = cursor[seg] as Data;
  }
  const leaf = segs[segs.length - 1];
  if (value instanceof FieldValue) {
    const current = cursor[leaf];
    switch (value.kind) {
      case "delete":
        delete cursor[leaf];
        return;
      case "serverTimestamp":
        cursor[leaf] = Timestamp.now();
        return;
      case "increment":
        cursor[leaf] = (typeof current === "number" ? current : 0) + (value.operand as number);
        return;
      case "arrayUnion": {
        const arr = Array.isArray(current) ? [...current] : [];
        for (const item of value.operand as unknown[]) if (!arr.some((e) => deepEqual(e, item))) arr.push(item);
        cursor[leaf] = arr;
        return;
      }
      case "arrayRemove": {
        const arr = Array.isArray(current) ? current : [];
        cursor[leaf] = arr.filter((e) => !(value.operand as unknown[]).some((r) => deepEqual(e, r)));
        return;
      }
    }
  }
  cursor[leaf] = clone(value);
};

const resolveFieldValues = (value: unknown): unknown => {
  if (value instanceof FieldValue) {
    if (value.kind === "serverTimestamp") return Timestamp.now();
    if (value.kind === "delete") return undefined;
    // increment / array ops on a fresh doc behave as on an absent field
    const tmp: Data = {};
    setPath(tmp, "v", value);
    return tmp.v;
  }
  if (Array.isArray(value)) return value.map(resolveFieldValues);
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Data = {};
    for (const [k, v] of Object.entries(value as Data)) {
      const r = resolveFieldValues(v);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return value;
};

const deepMerge = (target: Data, source: Data): Data => {
  const out = clone(target);
  for (const [k, v] of Object.entries(source)) {
    const existing = out[k];
    if (
      v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype &&
      existing !== null && typeof existing === "object" && Object.getPrototypeOf(existing) === Object.prototype
    ) {
      out[k] = deepMerge(existing as Data, v as Data);
    } else {
      out[k] = clone(v);
    }
  }
  return out;
};

/** Normalise updateDoc(ref, obj) / updateDoc(ref, "a.b", v, "c", w). */
const normaliseUpdate = (fn: string, first: unknown, rest: unknown[]): Data => {
  if (typeof first === "string") {
    if (rest.length % 2 !== 1) {
      throw new FirebaseError("invalid-argument", `Function ${fn}() needs field/value pairs`);
    }
    const out: Data = { [first]: rest[0] };
    for (let i = 1; i < rest.length; i += 2) out[rest[i] as string] = rest[i + 1];
    return out;
  }
  return first as Data;
};

type WriteOp =
  | { kind: "set"; ref: DocumentReference; data: Data; merge: boolean }
  | { kind: "update"; ref: DocumentReference; data: Data }
  | { kind: "delete"; ref: DocumentReference };

const notFound = (ref: DocumentReference): FirebaseError =>
  new FirebaseError("not-found", `No document to update: projects/e2e-fake/databases/(default)/documents/${ref.path}`);

/** Validate then apply a list of ops atomically. Returns nothing; throws before mutating. */
const applyOps = (fn: string, ops: WriteOp[]): void => {
  // 1. validation pass (no mutation)
  const created = new Set<string>();
  for (const op of ops) {
    checkWriteFault(op.ref.parentPath);
    if (op.kind !== "delete") assertNoUndefined(fn, op.data);
    if (op.kind === "update" && readDoc(op.ref.parentPath, op.ref.id) === undefined && !created.has(op.ref.path)) {
      throw notFound(op.ref);
    }
    if (op.kind === "set") created.add(op.ref.path);
  }
  // 2. apply
  for (const op of ops) {
    const col = getCollection(op.ref.parentPath);
    if (op.kind === "delete") {
      delete col[op.ref.id];
      logOp({ op: "delete", collection: op.ref.parentPath, id: op.ref.id });
    } else if (op.kind === "set") {
      const resolved = resolveFieldValues(op.data) as Data;
      const existing = col[op.ref.id];
      col[op.ref.id] = op.merge && existing ? deepMerge(existing, resolved) : clone(resolved);
      logOp({ op: "set", collection: op.ref.parentPath, id: op.ref.id, data: op.data });
    } else {
      const next = clone(col[op.ref.id] ?? {});
      for (const [path, value] of Object.entries(op.data)) setPath(next, path, value);
      col[op.ref.id] = next;
      logOp({ op: "update", collection: op.ref.parentPath, id: op.ref.id, data: op.data });
    }
  }
  commit();
};

export const setDoc = async (ref: DocumentReference, data: Data, options?: { merge?: boolean }): Promise<void> => {
  applyOps("setDoc", [{ kind: "set", ref, data, merge: !!options?.merge }]);
};

export const updateDoc = async (ref: DocumentReference, first: unknown, ...rest: unknown[]): Promise<void> => {
  applyOps("updateDoc", [{ kind: "update", ref, data: normaliseUpdate("updateDoc", first, rest) }]);
};

export const addDoc = async (ref: CollectionReference, data: Data): Promise<DocumentReference> => {
  const docRef = makeDocRef(ref.path, nextAutoId());
  const opsBefore: WriteOp = { kind: "set", ref: docRef, data, merge: false };
  applyOps("addDoc", [opsBefore]);
  return docRef;
};

export const deleteDoc = async (ref: DocumentReference): Promise<void> => {
  applyOps("deleteDoc", [{ kind: "delete", ref }]);
};

export interface WriteBatch {
  set(ref: DocumentReference, data: Data, options?: { merge?: boolean }): WriteBatch;
  update(ref: DocumentReference, first: unknown, ...rest: unknown[]): WriteBatch;
  delete(ref: DocumentReference): WriteBatch;
  commit(): Promise<void>;
}

export const writeBatch = (_db?: Firestore): WriteBatch => {
  const queued: WriteOp[] = [];
  let committed = false;
  const batch: WriteBatch = {
    set(ref, data, options) {
      queued.push({ kind: "set", ref, data, merge: !!options?.merge });
      return batch;
    },
    update(ref, first, ...rest) {
      queued.push({ kind: "update", ref, data: normaliseUpdate("WriteBatch.update", first, rest) });
      return batch;
    },
    delete(ref) {
      queued.push({ kind: "delete", ref });
      return batch;
    },
    async commit() {
      if (committed) throw new FirebaseError("failed-precondition", "A write batch can no longer be used after commit() has been called.");
      committed = true;
      if (queued.length > 500) {
        throw new FirebaseError("invalid-argument", "maximum 500 writes allowed per request");
      }
      applyOps("WriteBatch.commit", queued);
    },
  };
  return batch;
};

// ============================================================================
// TRANSACTIONS (optimistic concurrency, like the client SDK)
// ============================================================================

export interface Transaction {
  get(ref: DocumentReference): Promise<DocumentSnapshot>;
  set(ref: DocumentReference, data: Data, options?: { merge?: boolean }): Transaction;
  update(ref: DocumentReference, first: unknown, ...rest: unknown[]): Transaction;
  delete(ref: DocumentReference): Transaction;
}

const MAX_TRANSACTION_ATTEMPTS = 5;

/**
 * Same contract as the real client SDK: the callback may run several times;
 * reads must all precede writes; writes are buffered and committed atomically
 * (validated first, nothing applied on failure); if a document READ by the
 * attempt changed before commit, the attempt is retried (up to 5 times, then
 * the promise rejects with `aborted`). A document's identity for this check is
 * its structural signature, which also sees changes made by another tab
 * (storage events replace the store).
 */
export const runTransaction = async <T>(
  _db: Firestore,
  updateFunction: (transaction: Transaction) => Promise<T>
): Promise<T> => {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt++) {
    const reads = new Map<string, { ref: DocumentReference; signature: string }>();
    const writes: WriteOp[] = [];
    const transaction: Transaction = {
      async get(ref) {
        if (writes.length > 0) {
          throw new FirebaseError(
            "invalid-argument",
            "Firestore transactions require all reads to be executed before all writes."
          );
        }
        reads.set(ref.path, { ref, signature: signatureOf(readDoc(ref.parentPath, ref.id) ?? null) });
        return makeDocSnapshot(ref);
      },
      set(ref, data, options) {
        writes.push({ kind: "set", ref, data, merge: !!options?.merge });
        return transaction;
      },
      update(ref, first, ...rest) {
        writes.push({ kind: "update", ref, data: normaliseUpdate("Transaction.update", first, rest) });
        return transaction;
      },
      delete(ref) {
        writes.push({ kind: "delete", ref });
        return transaction;
      },
    };
    const result = await updateFunction(transaction);
    const stale = [...reads.values()].some(
      (r) => signatureOf(readDoc(r.ref.parentPath, r.ref.id) ?? null) !== r.signature
    );
    if (stale) continue;
    if (writes.length > 500) {
      throw new FirebaseError("invalid-argument", "maximum 500 writes allowed per request");
    }
    applyOps("Transaction.commit", writes);
    return result;
  }
  throw new FirebaseError("aborted", "Transaction failed: too much contention on the documents it read.");
};
