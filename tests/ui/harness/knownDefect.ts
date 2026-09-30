/**
 * `knownDefect` — declare a test that asserts the CORRECT behaviour of a bug
 * that is still present.
 *
 *   knownDefect("UI-03", "Net Flow ignores skipped expenses", async () => { … });
 *
 * Normal run:            registered as `it.fails("KNOWN DEFECT: UI-03 — …")`
 *                        -> green while the bug exists, RED once it is fixed.
 * FLIP_KNOWN_DEFECTS=1:  registered as a plain `it(...)`, so every failure in
 *                        the report is a defect that is still present and every
 *                        pass is one that has been fixed. Non-destructive: no
 *                        file is rewritten.
 *
 * RULE: the test must reach its money assertion. `it.fails` cannot tell an
 * assertion failure from a crash (a TypeError also "passes"), so assert the
 * preconditions and array lengths FIRST, and put the observed wrong value in a
 * comment (`// observed: 1,750 — expected 1,200`). See tests/ui/README.md.
 */
import { it } from "vitest";

export const FLIP = process.env.FLIP_KNOWN_DEFECTS === "1";

type Body = () => void | Promise<void>;

export function knownDefect(id: string, title: string, fn: Body, timeout?: number): void {
  const name = `KNOWN DEFECT: ${id} — ${title}`;
  if (FLIP) it(name, fn, timeout);
  else it.fails(name, fn, timeout);
}

/** `knownDefect.skip` for defects that cannot be reproduced yet (documented, not run). */
knownDefect.skip = (id: string, title: string, fn: Body): void => {
  it.skip(`KNOWN DEFECT: ${id} — ${title}`, fn);
};
