import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultActualDate, getDefaultValues } from "@/components/modals/components/TransactionModal/formHelpers";
import { makeCompletedTransaction, makeProjectedTransaction } from "../helpers/builders";

/** MANUAL-k: paying early recorded a future "actual" date, because Actual Date defaulted to the scheduled date. */
describe("the completion dialog's default Actual Date", () => {
  it("a bill scheduled in the future is paid today", () => {
    expect(defaultActualDate("2026-10-15", "2026-10-01")).toBe("2026-10-01");
  });

  it("a bill due today or earlier keeps its scheduled date", () => {
    expect(defaultActualDate("2026-10-01", "2026-10-01")).toBe("2026-10-01");
    expect(defaultActualDate("2026-09-20", "2026-10-01")).toBe("2026-09-20");
  });

  describe("getDefaultValues (clock frozen at 2026-10-01)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 1, 12, 0, 0));
    });
    afterEach(() => vi.useRealTimers());

    it("an early payment defaults to today", () => {
      const t = makeProjectedTransaction({ scheduledDate: "2026-10-15" });
      expect(getDefaultValues(t).actualDate).toBe("2026-10-01");
    });

    it("an overdue row defaults to its scheduled date", () => {
      const t = makeProjectedTransaction({ scheduledDate: "2026-09-20" });
      expect(getDefaultValues(t).actualDate).toBe("2026-09-20");
    });

    it("an already recorded actual date is never replaced (editing a completed row)", () => {
      const t = makeCompletedTransaction({ scheduledDate: "2026-10-15", actualDate: "2026-10-20" });
      expect(getDefaultValues(t).actualDate).toBe("2026-10-20");
    });
  });
});
