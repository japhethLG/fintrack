/**
 * Text colour of a signed money figure. A zero amount is neutral: "$0.00" of expenses is not bad
 * news, so it is never printed in the danger (red) or success (green) colour.
 */

/** Neutral colour of a zero amount (the muted gray of the other secondary figures). */
export const ZERO_AMOUNT_CLASS = "text-gray-400";

/** True when the amount rounds to 0.00 (so a displayed "0.00" is never coloured). */
export const isZeroAmount = (amount: number): boolean => Math.abs(amount) < 0.005;

/** `toneClass` of a non-zero amount, the neutral gray for zero. */
export const amountTone = (amount: number, nonZeroClass: string): string =>
  isZeroAmount(amount) ? ZERO_AMOUNT_CLASS : nonZeroClass;
