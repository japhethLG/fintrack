import { describe, expect, it } from "vitest";
import { flatSeriesDomain } from "@/lib/utils/chartAxis";

describe("flatSeriesDomain", () => {
  it("an all-zero series (an empty account) gets 0 .. 1,000, not Recharts' 0 .. 4", () => {
    expect(flatSeriesDomain([0, 0, 0, 0])).toEqual([0, 1_000]);
  });

  it("a flat positive balance is shown from 0 to 20% above it", () => {
    expect(flatSeriesDomain([5_000, 5_000])).toEqual([0, 6_000]);
    expect(flatSeriesDomain([100, 100])).toEqual([0, 1_000]);
  });

  it("a flat negative balance mirrors below 0", () => {
    expect(flatSeriesDomain([-5_000, -5_000])).toEqual([-6_000, 0]);
  });

  it("a moving series, an empty series or a non-finite one is left to Recharts", () => {
    expect(flatSeriesDomain([0, 1])).toBeUndefined();
    expect(flatSeriesDomain([])).toBeUndefined();
    expect(flatSeriesDomain([Number.NaN, Number.NaN])).toBeUndefined();
  });
});
