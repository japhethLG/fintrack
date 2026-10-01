/**
 * Human label of a stored category code: "debt_payment" and "Debt_payment" both read "Debt Payment".
 *
 * Codes are split on "_" and "-" and every word gets a capital first letter; the rest of a word is
 * kept as written, so a label that is already human ("Salary", "Food & Dining") passes through.
 */
export const categoryLabel = (code: string): string => {
  if (!code) return "";
  return code
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

export default categoryLabel;
