/**
 * Types for financial health score calculations
 */

export interface HealthScoreBreakdown {
  /** Overall score from 0-100 */
  score: number;
  /** Grade: A, B, C, D, F */
  grade: "A" | "B" | "C" | "D" | "F";
  /** Color for UI display */
  color: string;
  /** Individual component scores */
  components: {
    /** Days until balance goes negative (0-100) */
    runway: number;
    /** Income minus expenses as % of income (0-100) */
    savingsRate: number;
    /** % of bills paid on time (0-100) */
    billPaymentRate: number;
    /** Balance trend over time (0-100) */
    balanceTrend: number;
  };
  /**
   * True when there is no data at all (no rows of any kind): the numbers are placeholders and the
   * UI shows a neutral "not enough data yet" state instead of a grade.
   */
  insufficientData: boolean;
  /** Human-readable insights */
  insights: string[];
}

export type TrendDirection = "improving" | "stable" | "declining";
