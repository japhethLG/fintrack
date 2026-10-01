/**
 * Chart helpers shared by the Recharts components.
 */

/**
 * Y-axis domain for a series whose values are ALL EQUAL, `undefined` otherwise (let Recharts decide).
 *
 * Recharts' automatic domain for a flat series collapses: an empty account (balance 0 on every day)
 * printed an axis of 0, 1, 2, 3, 4. A flat series gets a readable band instead: from 0 up to 20%
 * above the value (at least 1,000), or the mirror image below 0 for a negative value.
 */
export const flatSeriesDomain = (values: readonly number[]): [number, number] | undefined => {
  if (values.length === 0) return undefined;
  const first = values[0];
  if (!Number.isFinite(first) || values.some((v) => v !== first)) return undefined;
  if (first >= 0) return [0, Math.max(first * 1.2, 1_000)];
  return [Math.min(first * 1.2, -1_000), 0];
};

/**
 * Size a `ResponsiveContainer` assumes until it has measured its parent. Recharts' own default is
 * -1 x -1, which logs "The width(-1) and height(-1) of chart should be greater than 0" on every
 * first render; any positive size silences it and is replaced by the real size straight away.
 */
export const CHART_INITIAL_DIMENSION = { width: 320, height: 200 } as const;
