/**
 * A human label for a category code: "debt_payment" -> "Debt Payment", "Debt_payment" -> "Debt Payment".
 * Splits on `_` and `-` and title-cases each word. A label that is already readable ("Salary") comes back unchanged.
 */
export const categoryLabel = (code: string): string =>
  String(code ?? "")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
