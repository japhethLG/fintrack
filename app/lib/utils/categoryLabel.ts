import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants";

/**
 * A human label for a stored category code: "debt_payment" -> "Debt Payment".
 * Known expense categories use their canonical label; any other snake / kebab / lowercase code is
 * turned into Title Case words. A value that is already readable ("Salary", "Side Gig") is kept.
 */
export const categoryLabel = (code: string | null | undefined): string => {
  const raw = (code ?? "").trim();
  if (!raw) return "";
  const known = (EXPENSE_CATEGORY_LABELS as Record<string, string>)[raw];
  if (known) return known;
  return raw
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

export default categoryLabel;
