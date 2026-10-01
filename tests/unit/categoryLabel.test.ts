import { describe, expect, it } from "vitest";
import { categoryLabel } from "@/lib/utils/categoryLabel";

describe("categoryLabel", () => {
  it.each([
    ["debt_payment", "Debt Payment"],
    ["Debt_payment", "Debt Payment"],
    ["groceries", "Groceries"],
    ["Salary", "Salary"],
    ["food-and_dining", "Food And Dining"],
    ["Food & Dining", "Food & Dining"],
    ["", ""],
  ])("%s -> %s", (code, label) => {
    expect(categoryLabel(code)).toBe(label);
  });
});
