import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Regression guard: ONE currency convention across app/.
 *
 *   Every amount a user sees is rendered through the user's currency by `app/lib/utils/currency.ts`
 *   (`formatCurrency`, `formatCurrencyWithSign`, `formatCompactCurrency`, `getCurrencySymbol`, reached in
 *   components through `useCurrency()`). The default currency is PHP.
 *
 * Lint is broken in this repo, so this scan is the guard. It fails on
 *   1. a currency symbol (the peso, dollar, euro, pound, yen or rupee sign) inside a string literal,
 *      template-string chunk or JSX text: that is a hard-coded symbol (UI-OBS-02, UI-BAL-17/18/19/32/33,
 *      UI-DISP-12, E2E-JRN-19),
 *   2. `new Intl.NumberFormat(...)` outside currency.ts (a second formatter drifts: UI-BAL-28/29/30),
 *   3. `.toLocaleString(...)` outside currency.ts (3-decimal and ragged amounts: UI-DISP-10/11),
 *   4. the literal currency code "USD" outside currency.ts and the Settings option list (the old fallback).
 *
 * The scan is syntactic. A justified exception goes in ALLOWED with a reason; an entry that no longer matches
 * anything fails the test, so the list can only shrink.
 */

const APP_DIR = path.resolve(__dirname, "../../app");

interface Violation {
  file: string; // relative to app/, posix separators
  line: number;
  text: string; // the trimmed source line
  rule: "symbol" | "intl-number-format" | "to-locale-string" | "usd-literal";
}

const SYMBOLS = /[₱$€£¥₹]/;

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
    // 1. a symbol in text. Template chunks are separate nodes, so `${x}` never counts as a `$`.
    if (
      ts.isStringLiteralLike(node) || // string and no-substitution template
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      if (SYMBOLS.test(node.text)) report(node, "symbol");
    }
    // 4. the literal "USD"
    if (ts.isStringLiteralLike(node) && node.text === "USD") report(node, "usd-literal");
    // 2. new Intl.NumberFormat(...)
    if (
      ts.isNewExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Intl" &&
      node.expression.name.text === "NumberFormat"
    ) {
      report(node, "intl-number-format");
    }
    // 3. <x>.toLocaleString(...)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "toLocaleString"
    ) {
      report(node, "to-locale-string");
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
// Justified exceptions. The currency module is excluded wholesale (it IS the one place that maps a
// code to a symbol, a locale and a formatter); every other exception matches a violation by
// file + exact trimmed line.
// ---------------------------------------------------------------------------

const CURRENCY_MODULE = "lib/utils/currency.ts";

interface Allowed {
  file: string;
  text: string;
  reason: string;
}

const ALLOWED: Allowed[] = [
  {
    file: "components/pages/settings/constants.ts",
    text: '{ value: "USD", label: "USD - US Dollar" },',
    reason: "the Settings currency picker lists every supported code; this is data, not a fallback",
  },
];

const relative = (file: string) => path.relative(APP_DIR, file).split(path.sep).join("/");

const scanApp = (): Violation[] =>
  listSourceFiles(APP_DIR).flatMap((file) =>
    scanSource(file, fs.readFileSync(file, "utf8")).map((v) => ({ ...v, file: relative(file) }))
  );

describe("currency convention scanner (self-test)", () => {
  const scan = (code: string, name = "x.tsx") => scanSource(name, code).map((v) => v.rule);

  it("flags a symbol in strings, template chunks and JSX text", () => {
    expect(scan('const a = "₱0";')).toEqual(["symbol"]);
    expect(scan("const a = `Total: $${n}`;")).toEqual(["symbol"]);
    expect(scan("const a = <p>-$</p>;")).toEqual(["symbol"]);
    expect(scan('const a = <Input prefix="€" />;')).toEqual(["symbol"]);
    expect(scan('const a = "C$";')).toEqual(["symbol"]);
  });

  it("does not mistake template substitutions or regexes for a symbol", () => {
    expect(scan("const a = `${n} items`;")).toEqual([]);
    expect(scan("const a = `${a}${b}`;")).toEqual([]);
    expect(scan("const a = /^x$/.test(s);")).toEqual([]);
    expect(scan("// costs $5\nconst a = 1;")).toEqual([]);
  });

  it("flags a second formatter and the USD literal", () => {
    expect(scan('new Intl.NumberFormat("en-US")')).toEqual(["intl-number-format"]);
    expect(scan("n.toLocaleString()")).toEqual(["to-locale-string"]);
    expect(scan('const c = code || "USD";')).toEqual(["usd-literal"]);
  });

  it("leaves the sanctioned helpers alone", () => {
    expect(scan("formatCurrency(n)")).toEqual([]);
    expect(scan("`${currencySymbol}${n}`")).toEqual([]);
  });
});

describe("currency convention across app/**/*.{ts,tsx}", () => {
  const violations = scanApp().filter((v) => v.file !== CURRENCY_MODULE);

  const isAllowed = (v: Violation) => ALLOWED.some((a) => a.file === v.file && a.text === v.text);

  it("has no hard-coded currency symbol, second number formatter, or USD fallback", () => {
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
