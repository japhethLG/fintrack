/**
 * Reporter enabled only under E2E_FLIP_KNOWN_DEFECTS=1. For every test carrying
 * a `known-defect` annotation it classifies HOW the test failed:
 *
 *   mismatch         assertion with a real Received value      (what we want)
 *   missing-element  expect() timed out, element(s) not found  (acceptable, weaker)
 *   timeout          test/action timeout (click/fill/goto ...) (test likely broken)
 *   crash            anything else (TypeError, page crash ...) (test likely broken)
 *   PASSED           test passed in flip mode                   (defect is fixed / test asserts nothing)
 *
 * Prints a table and writes test-results/known-defects-flip.json. Exits
 * non-zero at the end if any known-defect test is timeout/crash/PASSED.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

type Kind = "mismatch" | "missing-element" | "timeout" | "crash" | "PASSED" | "skipped";

const classify = (result: TestResult): Kind => {
  if (result.status === "skipped") return "skipped";
  if (result.status === "passed") return "PASSED";
  const msg = result.errors.map((e) => e.message ?? "").join("\n");
  // eslint-disable-next-line no-control-regex
  const plain = msg.replace(/\u001b\[[0-9;]*m/g, "");
  if (/Test timeout of \d+ms exceeded/.test(plain) || /(locator|page|frame)\.\w+: Timeout \d+ms exceeded/.test(plain)) {
    // a failed expect() inside the timeout still reports as timeout of the test
    return /expect\(/.test(plain) && /Expected|Received/.test(plain) ? "missing-element" : "timeout";
  }
  if (/expect\(.*\)\.\w+/.test(plain)) {
    return /Received:\s*<element\(s\) not found>/.test(plain) || /element\(s\) not found/.test(plain)
      ? "missing-element"
      : "mismatch";
  }
  return "crash";
};

class KnownDefectsReporter implements Reporter {
  private rows: Array<{ id: string; title: string; project: string; kind: Kind; detail: string }> = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const anns = test.annotations.filter((a) => a.type === "known-defect");
    if (anns.length === 0) return;
    const first = (result.errors[0]?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0];
    for (const a of anns) {
      this.rows.push({
        id: (a.description ?? "").split(":")[0],
        title: test.titlePath().slice(2).join(" > "),
        project: test.parent.project()?.name ?? "",
        kind: classify(result),
        detail: first,
      });
    }
  }

  onEnd(_result: FullResult): void {
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/known-defects-flip.json", JSON.stringify(this.rows, null, 2));
    const bad = this.rows.filter((r) => ["timeout", "crash", "PASSED"].includes(r.kind));
    console.log("\n=== Known-defect flip report ===");
    for (const r of this.rows) console.log(`${r.kind.padEnd(16)} ${r.id.padEnd(10)} [${r.project}] ${r.title}`);
    console.log(`${this.rows.length} known-defect runs, ${bad.length} need attention (timeout/crash/PASSED)`);
    if (bad.length > 0) process.exitCode = 1;
  }
}

export default KnownDefectsReporter;
