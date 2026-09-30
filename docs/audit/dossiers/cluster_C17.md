# Cluster C17

Forecast horizon end-point semantics inconsistent with rest of engine

Source files implicated:
- app/lib/logic/forecasting/forecastCalculator.ts

## Member findings (from first-round analysts)

### [F79] (low/structure) Forecast horizon end-point semantics differ from the rest of the engine (count-based exclusive vs inclusive getDaysBetween), risking off-by-one horizon length
- File: app/lib/logic/forecasting/forecastCalculator.ts : 42-61
- Why wrong: calculateForecast is count-driven: it emits exactly `daysToForecast` points covering startDate .. startDate+(daysToForecast-1) inclusive (so default 90 = day 0 through day 89). The sibling and caller code that frames a forecast window thinks in terms of an inclusive [start,end] range — e.g. dailyBalance uses `getDaysBetween(start,end)` which is end-inclusive, and Forecast.tsx computes `daysDiff = end.diff(start,'day') + 1`. If a future caller wires up calculateForecast by passing `daysToForecast = end - start` (the natural day-difference, without +1), the last day of the intended window will be silently dropped; conversely passing the inclusive count over-shoots by a day. The function's horizon contract is inconsistent with the project's prevailing inclusive-range convention.
- Scenario: A caller wants a forecast for the inclusive range 2026-06-01..2026-06-30 (30 days) and computes daysToForecast = dayjs('2026-06-30').diff('2026-06-01','day') = 29. calculateForecast then returns points for 2026-06-01..2026-06-29 only, omitting 2026-06-30 (and any transaction on the 30th never affects the reported end-of-horizon balance). Correct: 30 points ending on 2026-06-30. This is latent because nothing currently calls the function, but the contract mismatch invites an off-by-one the moment it is used.
- Suggested fix: Document the horizon contract explicitly (inclusive of startDate, exclusive of startDate+daysToForecast) and either accept an end Date and iterate with the end-inclusive getDaysBetween helper (as dailyBalance does), or have callers always use the inclusive `diff + 1` convention. Aligning on getDaysBetween would also fix the timezone issue from the first finding.
- First-round verification: UNVERIFIED (verifier crashed)
