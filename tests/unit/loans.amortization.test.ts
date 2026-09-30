import { describe, expect, it } from "vitest";
import {
  calculateAmortizationSchedule,
  calculateLoanPaymentAmount,
} from "@/lib/logic/amortization";
import { d, ymdAll } from "../helpers/dates";

/**
 * Loan amortization: dates, cent-level invariants, the three calculation types
 * (D2) and the guards for unusable input.
 *
 * Every expected number is derived by hand in the comment next to it, or by a
 * reference implementation written in this file. Nothing is computed with app
 * code: the app functions are the thing under test.
 */

// ---------------------------------------------------------------------------
// Independent reference maths (NOT the app's)
// ---------------------------------------------------------------------------

/** PMT = P r (1+r)^n / ((1+r)^n - 1) */
const pmt = (principal: number, monthlyRate: number, months: number): number => {
  if (monthlyRate === 0) return principal / months;
  const g = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * g) / (g - 1);
};

const round2 = (x: number): number => Math.round(x * 100) / 100;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

type Row = {
  date: Date;
  payment: number;
  principal: number;
  interest: number;
  remainingBalance: number;
};

/**
 * The conservation identity every schedule must obey at EVERY step:
 *   remaining = opening + cumulative interest - cumulative paid
 * `remainingBalance` is emitted rounded to the cent, hence the 2-digit tolerance.
 */
const expectConserved = (opening: number, rows: Row[]) => {
  let interest = 0;
  let paid = 0;
  rows.forEach((row) => {
    interest += row.interest;
    paid += row.payment;
    expect(row.remainingBalance).toBeCloseTo(opening + interest - paid, 2);
    // payment = principal + interest, exactly (up to float noise)
    expect(row.payment).toBeCloseTo(row.principal + row.interest, 9);
  });
};

// ===========================================================================
// Dates: fixed anchor, never skip a month
// ===========================================================================

describe("amortization payment dates", () => {
  const zeroInterest = (start: string, months: number) =>
    calculateAmortizationSchedule({
      principal: months * 100,
      annualRate: 0,
      termMonths: months,
      startDate: d(start),
    });

  it("clamps from a fixed anchor: Jan 31 -> Feb 28 -> Mar 31 -> Apr 30 (not Mar 3, Apr 3)", () => {
    // 2026 is not a leap year, so February ends on the 28th; March has 31 days,
    // April 30, May 31, June 30.
    expect(ymdAll(zeroInterest("2026-01-31", 6).map((s) => s.date))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
  });

  it("uses Feb 29 in a leap year and returns to the 30th afterwards (anchor Jan 30, 2028)", () => {
    expect(ymdAll(zeroInterest("2028-01-30", 4).map((s) => s.date))).toEqual([
      "2028-01-30",
      "2028-02-29",
      "2028-03-30",
      "2028-04-30",
    ]);
  });

  it("never skips or repeats a calendar month from a 29th, 30th or 31st anchor", () => {
    // Independent check: month index (year*12+month) must rise by exactly 1 each step,
    // and the day must be min(anchorDay, daysInThatMonth).
    const daysIn = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();
    for (const start of ["2026-01-29", "2026-01-30", "2026-01-31", "2027-12-31", "2028-01-31"]) {
      const anchor = d(start);
      const rows = zeroInterest(start, 26);
      expect(rows).toHaveLength(26);
      rows.forEach((row, i) => {
        const monthIndex = anchor.getFullYear() * 12 + anchor.getMonth() + i;
        const y = Math.floor(monthIndex / 12);
        const m0 = monthIndex % 12;
        expect(row.date.getFullYear()).toBe(y);
        expect(row.date.getMonth()).toBe(m0);
        expect(row.date.getDate()).toBe(Math.min(anchor.getDate(), daysIn(y, m0)));
      });
    }
  });

  it("honours monthOffset from the SAME anchor (Jan 31 anchor, 1 payment made -> first date Feb 28, next Mar 31)", () => {
    const rows = calculateAmortizationSchedule({
      principal: 300,
      annualRate: 0,
      termMonths: 3,
      startDate: d("2026-01-31"),
      monthOffset: 1,
    });
    // offset 1 = Feb 28; offset 2 = Mar 31 (NOT Mar 28: the clamped Feb date is never re-used)
    expect(ymdAll(rows.map((s) => s.date))).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });
});

// ===========================================================================
// Cent-level invariants (amortized)
// ===========================================================================

describe("amortized schedule invariants (12,000 @ 12% over 24 months)", () => {
  const P = 12_000;
  const r = 0.12 / 12; // 1% a month
  const rows = calculateAmortizationSchedule({
    principal: P,
    annualRate: 12,
    termMonths: 24,
    startDate: d("2026-01-15"),
  });

  it("repays exactly the opening balance in principal", () => {
    expect(sum(rows.map((x) => x.principal))).toBeCloseTo(P, 6);
  });

  it("ends at exactly zero, with no float residue", () => {
    expect(rows[rows.length - 1].remainingBalance).toBe(0);
  });

  it("emits every remainingBalance rounded to whole cents", () => {
    rows.forEach((row) => expect(row.remainingBalance).toBe(round2(row.remainingBalance)));
  });

  it("conserves money at every step: remaining = opening + interest - paid", () => {
    expectConserved(P, rows);
  });

  it("matches the textbook total interest: 24 x PMT - 12,000 = 1,557.16", () => {
    // PMT = 12000 * 0.01 * 1.01^24 / (1.01^24 - 1) = 564.8816667
    // 24 * 564.8816667 = 13,557.16 -> interest = 1,557.16
    const textbook = 24 * pmt(P, r, 24) - P;
    expect(textbook).toBeCloseTo(1_557.16, 2);
    expect(sum(rows.map((x) => x.interest))).toBeCloseTo(textbook, 6);
  });
});

describe("amortized schedule with a rounded / user-supplied payment: the last payment is trued up", () => {
  it("a payment a few cents under PMT still ends at exactly 0 in the last term month (balloon absorbs the shortfall)", () => {
    // PMT = 564.8816667. Paying 564.80 leaves a shortfall of 0.0816667 a month that compounds:
    //   balance after 23 payments is higher than the PMT path by
    //   0.0816667 * (1.01^23 - 1)/0.01 = 0.0816667 * 25.716379 = 2.1002,
    //   plus a month of interest on it (x1.01) = 2.1212, so the 24th payment is
    //   564.8816667 + 2.1212 = 567.003 (cross-checked below by a reference loop).
    let bal = 12_000;
    let lastPayment = 0;
    for (let i = 0; i < 24; i++) {
      const interest = bal * 0.01;
      if (i === 23) {
        lastPayment = bal + interest;
        bal = 0;
      } else {
        bal = bal + interest - 564.8;
      }
    }
    const rows = calculateAmortizationSchedule({
      principal: 12_000,
      annualRate: 12,
      termMonths: 24,
      monthlyPayment: 564.8,
      startDate: d("2026-01-15"),
    });
    expect(rows).toHaveLength(24);
    expect(rows[23].remainingBalance).toBe(0);
    expect(rows[23].payment).toBeCloseTo(lastPayment, 6);
    expect(rows[23].payment).toBeCloseTo(567.0, 1);
    expect(rows[22].payment).toBe(564.8);
    expectConserved(12_000, rows);
  });

  it("a payment above PMT retires early and the final payment is the residual plus its interest", () => {
    const rows = calculateAmortizationSchedule({
      principal: 1_000,
      annualRate: 12,
      termMonths: 24,
      monthlyPayment: 600,
      startDate: d("2026-01-01"),
    });
    // m1: 1000*1.01-600 = 410 ; m2: 410*1.01-600 = -185.9 -> m2 is final:
    //   interest 4.10, principal 410, payment 414.10
    expect(rows).toHaveLength(2);
    expect(rows[0].payment).toBe(600);
    expect(rows[0].remainingBalance).toBe(410);
    expect(rows[1].interest).toBeCloseTo(4.1, 9);
    expect(rows[1].principal).toBeCloseTo(410, 9);
    expect(rows[1].payment).toBeCloseTo(414.1, 9);
    expect(rows[1].remainingBalance).toBe(0);
    expectConserved(1_000, rows);
  });
});

// ===========================================================================
// D2: calculation types
// ===========================================================================

describe("D2 calculation types (12,000 @ 12% a year over 24 months)", () => {
  const base = { principal: 12_000, annualRate: 12, termMonths: 24, startDate: d("2026-01-15") };

  describe("flat_rate: interest is charged on the ORIGINAL principal every month", () => {
    const rows = calculateAmortizationSchedule({ ...base, calculationType: "flat_rate" });

    it("charges 12,000 x 12% / 12 = 120.00 of interest every single month", () => {
      expect(rows).toHaveLength(24);
      rows.forEach((row) => expect(row.interest).toBeCloseTo(120, 9));
    });

    it("repays 12,000 / 24 = 500.00 of principal every month, so the payment is a constant 620.00", () => {
      rows.forEach((row) => {
        expect(row.principal).toBeCloseTo(500, 9);
        expect(row.payment).toBeCloseTo(620, 9);
      });
    });

    it("costs 12,000 x 12% x 2 years = 2,880.00 in total interest (vs 1,557.16 amortized)", () => {
      expect(sum(rows.map((r) => r.interest))).toBeCloseTo(2_880, 6);
      expect(sum(rows.map((r) => r.payment))).toBeCloseTo(14_880, 6);
    });

    it("declines by 500 a month and ends at exactly 0", () => {
      expect(rows[0].remainingBalance).toBe(11_500);
      expect(rows[11].remainingBalance).toBe(6_000);
      expect(rows[23].remainingBalance).toBe(0);
      expectConserved(12_000, rows);
    });

    it("charges flat interest on interestBasis (the original principal) when the balance is partly repaid", () => {
      // basis 12,000 but only 6,000 still owed over 12 months:
      // principal 6000/12 = 500, interest 12000 * 1% = 120 (NOT 6000 * 1% = 60)
      const partial = calculateAmortizationSchedule({
        principal: 6_000,
        interestBasis: 12_000,
        annualRate: 12,
        termMonths: 12,
        startDate: d("2026-01-15"),
        calculationType: "flat_rate",
      });
      expect(partial).toHaveLength(12);
      partial.forEach((row) => {
        expect(row.principal).toBeCloseTo(500, 9);
        expect(row.interest).toBeCloseTo(120, 9);
      });
      expect(partial[11].remainingBalance).toBe(0);
    });
  });

  describe("reducing_balance: equal principal every month, interest on what is still owed", () => {
    const rows = calculateAmortizationSchedule({ ...base, calculationType: "reducing_balance" });

    it("repays 500.00 of principal every month", () => {
      rows.forEach((row) => expect(row.principal).toBeCloseTo(500, 9));
    });

    it("charges interest on the balance before each payment: 120.00, 115.00, 110.00 ... 5.00", () => {
      // month n interest = (12000 - 500 (n-1)) * 1%
      expect(rows[0].interest).toBeCloseTo(120, 9);
      expect(rows[1].interest).toBeCloseTo(115, 9);
      expect(rows[2].interest).toBeCloseTo(110, 9);
      expect(rows[23].interest).toBeCloseTo(5, 9);
    });

    it("so the payment FALLS from 620.00 to 505.00", () => {
      expect(rows[0].payment).toBeCloseTo(620, 9);
      expect(rows[1].payment).toBeCloseTo(615, 9);
      expect(rows[23].payment).toBeCloseTo(505, 9);
    });

    it("costs 1% x 500 x (24+23+...+1 = 300) = 1,500.00 in total interest", () => {
      expect(sum(rows.map((r) => r.interest))).toBeCloseTo(1_500, 6);
      expect(rows[23].remainingBalance).toBe(0);
      expectConserved(12_000, rows);
    });
  });

  it("the three types are pairwise different (reducing_balance is NOT an alias of amortized)", () => {
    const first = (calculationType: "amortized" | "flat_rate" | "reducing_balance") =>
      calculateAmortizationSchedule({ ...base, calculationType })[0];
    // first-month payments: 564.88 (level PMT), 620.00 (flat), 620.00 (reducing) - but the
    // SECOND month separates flat from reducing: 620.00 vs 615.00
    expect(first("amortized").payment).toBeCloseTo(564.88, 2);
    expect(first("flat_rate").payment).toBeCloseTo(620, 9);
    expect(first("reducing_balance").payment).toBeCloseTo(620, 9);
    const second = (t: "amortized" | "flat_rate" | "reducing_balance") =>
      calculateAmortizationSchedule({ ...base, calculationType: t })[1].payment;
    expect(second("amortized")).toBeCloseTo(564.88, 2);
    expect(second("flat_rate")).toBeCloseTo(620, 9);
    expect(second("reducing_balance")).toBeCloseTo(615, 9);
  });

  it("an undefined calculationType is amortized", () => {
    const a = calculateAmortizationSchedule(base);
    const b = calculateAmortizationSchedule({ ...base, calculationType: "amortized" });
    expect(a).toEqual(b);
  });

  describe("calculateLoanPaymentAmount (the headline payment)", () => {
    const args = { principal: 12_000, annualRate: 12, termMonths: 24 };
    it("amortized: PMT 564.8817", () => {
      expect(calculateLoanPaymentAmount(args)).toBeCloseTo(564.8817, 4);
    });
    it("flat_rate: 12000/24 + 12000 * 1% = 620.00", () => {
      expect(calculateLoanPaymentAmount({ ...args, calculationType: "flat_rate" })).toBeCloseTo(620, 9);
    });
    it("reducing_balance: first (largest) payment 12000/24 + 12000 * 1% = 620.00", () => {
      expect(calculateLoanPaymentAmount({ ...args, calculationType: "reducing_balance" })).toBeCloseTo(620, 9);
    });
    it("0% interest divides the principal evenly for every type", () => {
      (["amortized", "flat_rate", "reducing_balance"] as const).forEach((calculationType) => {
        expect(calculateLoanPaymentAmount({ principal: 1_200, annualRate: 0, termMonths: 12, calculationType })).toBe(100);
      });
    });
  });
});

// ===========================================================================
// Unusable input must never yield Infinity / NaN
// ===========================================================================

describe("invalid loan input is reported as 'no schedule', never Infinity or NaN", () => {
  it("a term of 0 has no payment (0) instead of Infinity", () => {
    expect(calculateLoanPaymentAmount({ principal: 1_000, annualRate: 5, termMonths: 0 })).toBe(0);
    expect(calculateLoanPaymentAmount({ principal: 1_000, annualRate: 0, termMonths: 0 })).toBe(0);
  });

  it("a negative or NaN term, a NaN principal and a NaN rate all give 0", () => {
    expect(calculateLoanPaymentAmount({ principal: 1_000, annualRate: 5, termMonths: -3 })).toBe(0);
    expect(calculateLoanPaymentAmount({ principal: 1_000, annualRate: 5, termMonths: NaN })).toBe(0);
    expect(calculateLoanPaymentAmount({ principal: NaN, annualRate: 5, termMonths: 12 })).toBe(0);
    expect(calculateLoanPaymentAmount({ principal: 1_000, annualRate: NaN, termMonths: 12 })).toBe(0);
  });

  it("the schedule is empty for a term of 0 with no explicit payment", () => {
    expect(
      calculateAmortizationSchedule({ principal: 1_000, annualRate: 5, termMonths: 0, startDate: d("2026-01-01") })
    ).toEqual([]);
  });

  it("the schedule is empty for a zero, negative or NaN principal", () => {
    [0, -5, NaN].forEach((principal) => {
      expect(
        calculateAmortizationSchedule({ principal, annualRate: 5, termMonths: 12, startDate: d("2026-01-01") })
      ).toEqual([]);
    });
  });

  it("flat_rate and reducing_balance need a term: without one they return nothing rather than dividing by zero", () => {
    (["flat_rate", "reducing_balance"] as const).forEach((calculationType) => {
      expect(
        calculateAmortizationSchedule({
          principal: 1_000,
          annualRate: 5,
          termMonths: 0,
          startDate: d("2026-01-01"),
          calculationType,
        })
      ).toEqual([]);
    });
  });
});

// ===========================================================================
// Negative amortization (payment below the interest) capitalises
// ===========================================================================

describe("a payment below the interest capitalises the shortfall (balance grows, money is conserved)", () => {
  // 10,000 @ 12%: interest 100.00 in month 1. Paying 50 leaves 50 unpaid -> 10,050.
  // Month 2 interest = 10,050 * 1% = 100.50; paying 50 -> 10,100.50.
  const rows = calculateAmortizationSchedule({
    principal: 10_000,
    annualRate: 12,
    monthlyPayment: 50,
    startDate: d("2026-01-01"),
  });

  it("grows the balance: 10,050.00 then 10,100.50", () => {
    expect(rows[0].remainingBalance).toBe(10_050);
    expect(rows[1].remainingBalance).toBe(10_100.5);
  });

  it("reports the shortfall as negative principal so payment = principal + interest", () => {
    expect(rows[0].principal).toBeCloseTo(-50, 9);
    expect(rows[0].interest).toBeCloseTo(100, 9);
    expect(rows[0].payment).toBe(50);
  });

  it("conserves money at every step", () => {
    expectConserved(10_000, rows);
  });
});
