import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * R4 regression guard: ONE date convention across app/.
 *
 *   A calendar day is a local "YYYY-MM-DD" string.
 *   - `parseDate` / `formatDate` (app/lib/utils/dateUtils.ts) are the only string<->Date conversions.
 *   - "today" comes from `getTodayKey()`.
 *   - Days are iterated by index (`dayNumberOfDate` / `dateFromDayNumber` / `eachDayBetween`),
 *     never by stepping a wall-clock instant.
 *
 * Lint is broken in this repo, so this scan is the guard. It fails on
 *   1. `new Date(<string literal | template | date-string-looking variable>)`
 *      (`new Date("2026-03-01")` is UTC midnight, a day early/late by zone; `new Date(row.scheduledDate)` too),
 *   2. `.toISOString().split(...)` / `.slice(...)` / `.substring(...)` (the UTC day of a local instant),
 *   3. `.setMonth(...)` (month stepping overflows: Jan 31 + 1 month = Mar 3).
 *
 * The scan is syntactic, so variable arguments are recognised by NAME (ending in Date/Str/String/Key/Iso,
 * or called `date`). A justified exception goes in ALLOWED with a reason; an entry that no longer matches
 * anything fails the test, so the list can only shrink.
 */

const APP_DIR = path.resolve(__dirname, "../../app");

interface Violation {
  file: string; // relative to app/, posix separators
  line: number;
  text: string; // the trimmed source line
  rule: "new-Date-string" | "toISOString-slice" | "setMonth";
}

const DATE_STRING_NAME = /(^date$|Date$|DateStr$|DateString$|Str$|String$|Key$|Iso$|IsoString$)/;

/** The identifier or the last member of a property-access chain (`a.b.startDate` -> `startDate`). */
const lastName = (node: ts.Node): string | null => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node))
    return lastName(node.expression);
  return null;
};

const scanSource = (fileName: string, source: string): Violation[] => {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const lines = source.split("\n");
  const out: Violation[] = [];
  const report = (node: ts.Node, rule: Violation["rule"]) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    out.push({ file: fileName, line: line + 1, text: lines[line].trim(), rule });
  };

  const visit = (node: ts.Node) => {
    // 1. new Date(<string-ish>)
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Date"
    ) {
      const args = node.arguments ?? [];
      if (args.length === 1) {
        const arg = args[0];
        const stringy =
          ts.isStringLiteralLike(arg) ||
          ts.isTemplateExpression(arg) ||
          (() => {
            const name = lastName(arg);
            return name !== null && DATE_STRING_NAME.test(name);
          })();
        if (stringy) report(node, "new-Date-string");
      }
    }
    // 2. <x>.toISOString().split|slice|substring|substr(...)
    if (
      ts.isPropertyAccessExpression(node) &&
      ["split", "slice", "substring", "substr"].includes(node.name.text) &&
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === "toISOString"
    ) {
      report(node, "toISOString-slice");
    }
    // 3. <x>.setMonth(...)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "setMonth"
    ) {
      report(node, "setMonth");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};

const listSourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) ? [full] : [];
  });

// ---------------------------------------------------------------------------
// Justified exceptions. Each entry matches a violation by file + exact trimmed line.
// ---------------------------------------------------------------------------

interface Allowed {
  file: string;
  text: string;
  reason: string;
}

const ALLOWED: Allowed[] = [
  {
    file: "lib/logic/creditCardCalculator/payoffCalculator.ts",
    text: "date: new Date(startDate),",
    reason:
      "startDate is a Date parameter, so this only clones a Date (the name heuristic cannot tell); the debt stream already moved this module off setMonth stepping",
  },
];

const relative = (file: string) => path.relative(APP_DIR, file).split(path.sep).join("/");

const scanApp = (): Violation[] =>
  listSourceFiles(APP_DIR).flatMap((file) =>
    scanSource(file, fs.readFileSync(file, "utf8")).map((v) => ({ ...v, file: relative(file) }))
  );

describe("date convention scanner (self-test)", () => {
  const scan = (code: string) => scanSource("x.ts", code).map((v) => v.rule);

  it("flags new Date(<string literal>) and template strings", () => {
    expect(scan('const a = new Date("2026-01-01");')).toEqual(["new-Date-string"]);
    expect(scan("const a = new Date(`${y}-${m}-01`);")).toEqual(["new-Date-string"]);
  });

  it("flags new Date(<date-string variable>)", () => {
    expect(scan("new Date(t.scheduledDate)")).toEqual(["new-Date-string"]);
    expect(scan("new Date(dateStr)")).toEqual(["new-Date-string"]);
    expect(scan("new Date(view.dateKey)")).toEqual(["new-Date-string"]);
    expect(scan("new Date(rule.endDate!)")).toEqual(["new-Date-string"]);
  });

  it("flags .toISOString().split/slice/substring and .setMonth()", () => {
    expect(scan('d.toISOString().split("T")[0]')).toEqual(["toISOString-slice"]);
    expect(scan("new Date().toISOString().slice(0, 10)")).toEqual(["toISOString-slice"]);
    expect(scan("cursor.setMonth(cursor.getMonth() + 1)")).toEqual(["setMonth"]);
  });

  it("leaves numeric constructors, clones-by-time, now, and the sanctioned helpers alone", () => {
    expect(scan("new Date(2026, 0, 31)")).toEqual([]);
    expect(scan("new Date()")).toEqual([]);
    expect(scan("new Date(ms)")).toEqual([]);
    expect(scan("new Date(date.getTime())")).toEqual([]);
    expect(scan("parseDate(t.scheduledDate)")).toEqual([]);
    expect(scan("d.toISOString()")).toEqual([]);
  });
});

describe("date convention across app/**/*.{ts,tsx}", () => {
  const violations = scanApp();

  const isAllowed = (v: Violation) => ALLOWED.some((a) => a.file === v.file && a.text === v.text);

  it("has no unjustified new Date(<date string>), toISOString().split(), or setMonth()", () => {
    const unjustified = violations
      .filter((v) => !isAllowed(v))
      .map((v) => `${v.file}:${v.line} [${v.rule}] ${v.text}`);
    expect(unjustified).toEqual([]);
  });

  it("has no stale allow-list entries (every exception still matches a real violation)", () => {
    const stale = ALLOWED.filter(
      (a) => !violations.some((v) => v.file === a.file && v.text === a.text)
    ).map((a) => `${a.file}: ${a.text}`);
    expect(stale).toEqual([]);
  });

  it("documents every exception with a reason", () => {
    for (const a of ALLOWED) expect(a.reason.length, `${a.file}: ${a.text}`).toBeGreaterThan(10);
  });

  it("scans a meaningful number of files", () => {
    expect(listSourceFiles(APP_DIR).length).toBeGreaterThan(150);
  });
});
