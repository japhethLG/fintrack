/**
 * Console capture. React reports real problems (duplicate keys, act() races,
 * setState-after-unmount, hydration) through console.error/warn, so silent
 * console output is a test-quality signal.
 *
 * Default: every console.error / console.warn is RECORDED and still printed.
 * `UI_STRICT_CONSOLE=1`: any recorded call not matched by ENV_NOISE,
 * KNOWN_APP_WARNINGS or a spec's `allowConsole()` fails the test in afterEach.
 *
 * Specs can inspect calls with `consoleCalls()` and pre-approve noise with
 * `allowConsole(/pattern/)` (cleared before every test).
 */
/**
 * Noise that comes from running in jsdom rather than a browser. Recorded but
 * neither printed nor counted as a failure in strict mode.
 */
export const ENV_NOISE: RegExp[] = [
  // recharts ResponsiveContainer logs "width(0) and height(0)" while jsdom (which lays nothing out) has not
  // reported a size yet. The browser-only "width(-1)" variant is fixed (initialDimension) and tested in
  // tests/ui/display/charts.test.tsx.
  /of chart should be greater than 0/,
  // Landing page uses styled-jsx (`<style jsx>`), compiled away by Next's SWC.
  /non-boolean attribute[\s\S]*\bjsx\b/,
];

/**
 * Warnings the APP itself emits today. They are real (reported in
 * tests/ui/README.md "Observed defects") but so pervasive that failing every
 * strict-mode spec on them would make strict mode unusable. Still printed.
 */
export const KNOWN_APP_WARNINGS: RegExp[] = [
  // (empty: the Radix "Missing Description" warning, UI-OBS-06, was fixed; BaseModal and the mobile
  // drawer now render a Description, so any new one fails strict mode)
];

export interface ConsoleCall {
  level: "error" | "warn";
  message: string;
}

let calls: ConsoleCall[] = [];
let allowed: RegExp[] = [];
let installed = false;

const format = (args: unknown[]): string =>
  args
    .map((a) =>
      a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : JSON.stringify(a)
    )
    .join(" ");

const install = () => {
  if (installed) return;
  installed = true;
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const message = format(args);
      calls.push({ level, message });
      if (ENV_NOISE.some((re) => re.test(message))) return; // recorded, not printed
      original(...args);
    };
  }
};

export const resetConsoleCapture = (): void => {
  install();
  calls = [];
  allowed = [];
};

/** Everything logged to console.error / console.warn so far in this test. */
export const consoleCalls = (level?: "error" | "warn"): ConsoleCall[] =>
  level ? calls.filter((c) => c.level === level) : [...calls];

/** Pre-approve console noise (matched against the formatted message). */
export const allowConsole = (...patterns: RegExp[]): void => {
  allowed.push(...patterns);
};

export const assertNoUnexpectedConsole = (): void => {
  if (process.env.UI_STRICT_CONSOLE !== "1") return;
  const tolerated = [...ENV_NOISE, ...KNOWN_APP_WARNINGS, ...allowed];
  const bad = calls.filter((c) => !tolerated.some((re) => re.test(c.message)));
  if (bad.length > 0) {
    throw new Error(
      `Unexpected console output (UI_STRICT_CONSOLE=1):\n` +
        bad.map((c) => `  [${c.level}] ${c.message.slice(0, 300)}`).join("\n")
    );
  }
};
