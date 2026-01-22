import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { loadFont } from "@remotion/google-fonts/Manrope";

const { fontFamily } = loadFont();

// Generate realistic calendar data matching actual CalendarView
const generateCalendarData = () => {
  const days: Array<{
    day: number;
    isCurrentMonth: boolean;
    isToday: boolean;
    closingBalance: number;
    status: "safe" | "warning" | "danger";
    transactions: Array<{
      name: string;
      type: "income" | "expense";
      amount: number;
      status: "completed" | "projected" | "skipped";
    }>;
  }> = [];

  // Previous month days (27-31 for Jan 2026 which starts Thursday)
  for (let i = 28; i <= 31; i++) {
    days.push({
      day: i,
      isCurrentMonth: false,
      isToday: false,
      closingBalance: 10000 + Math.random() * 2000,
      status: "safe",
      transactions: [],
    });
  }

  // Current month days (January 2026)
  const transactionSchedule: Record<
    number,
    Array<{
      name: string;
      type: "income" | "expense";
      amount: number;
      status: "completed" | "projected";
    }>
  > = {
    1: [{ name: "Salary", type: "income", amount: 4250, status: "completed" }],
    5: [{ name: "Netflix", type: "expense", amount: 15.99, status: "completed" }],
    10: [{ name: "Rent", type: "expense", amount: 1500, status: "completed" }],
    12: [{ name: "Electric Bill", type: "expense", amount: 120, status: "completed" }],
    15: [
      { name: "Salary", type: "income", amount: 4250, status: "completed" },
      { name: "Car Insurance", type: "expense", amount: 180, status: "completed" },
    ],
    18: [{ name: "Groceries", type: "expense", amount: 250, status: "projected" }],
    20: [{ name: "Internet", type: "expense", amount: 79.99, status: "projected" }],
    22: [{ name: "Gym", type: "expense", amount: 50, status: "projected" }],
    25: [{ name: "Credit Card", type: "expense", amount: 500, status: "projected" }],
    28: [{ name: "Phone", type: "expense", amount: 85, status: "projected" }],
  };

  let runningBalance = 10200;
  const today = 15; // Simulate today as Jan 15

  for (let i = 1; i <= 31; i++) {
    const dayTransactions = transactionSchedule[i] || [];

    dayTransactions.forEach((t) => {
      if (t.type === "income") {
        runningBalance += t.amount;
      } else {
        runningBalance -= t.amount;
      }
    });

    const status: "safe" | "warning" | "danger" =
      runningBalance > 5000 ? "safe" : runningBalance > 2000 ? "warning" : "danger";

    days.push({
      day: i,
      isCurrentMonth: true,
      isToday: i === today,
      closingBalance: runningBalance,
      status,
      transactions: dayTransactions,
    });
  }

  // Next month days to fill grid (6 weeks = 42 cells)
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    days.push({
      day: i,
      isCurrentMonth: false,
      isToday: false,
      closingBalance: 12000 + Math.random() * 1000,
      status: "safe",
      transactions: [],
    });
  }

  return days;
};

const calendarData = generateCalendarData();
const weekDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekDaysShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Month summary data
const monthSummary = {
  income: 8500,
  expenses: 2780.98,
  net: 5719.02,
  projected: 5,
  completed: 8,
};

export const CalendarScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Header animation
  const headerOpacity = interpolate(frame, [0, fps * 0.4], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Month summary animation
  const summaryOpacity = interpolate(frame, [fps * 0.3, fps * 0.6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Calendar grid animation - staggered by row
  const getDayAnimation = (index: number) => {
    const row = Math.floor(index / 7);
    const col = index % 7;
    const delay = fps * 0.4 + row * 3 + col * 1;

    const scale = spring({
      frame: frame - delay,
      fps,
      config: { damping: 25, stiffness: 200 },
    });

    const opacity = interpolate(frame - delay, [0, fps * 0.15], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

    return { scale: Math.min(scale, 1), opacity };
  };

  // Highlight animation moving across calendar
  const highlightProgress = interpolate(frame, [fps * 1.5, fps * 4], [0, calendarData.length - 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const highlightIndex = Math.floor(highlightProgress);

  // Sidebar animation
  const sidebarOpacity = spring({
    frame: frame - fps * 0.6,
    fps,
    config: { damping: 200 },
  });

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "safe":
        return "#22c55e";
      case "warning":
        return "#eab308";
      case "danger":
        return "#ef4444";
      default:
        return "#6c757d";
    }
  };

  // Get transaction color
  const getTransactionColor = (type: string) => {
    return type === "income"
      ? { bg: "rgba(46, 204, 113, 0.2)", text: "#2ecc71" }
      : { bg: "rgba(231, 76, 60, 0.2)", text: "#e74c3c" };
  };

  // Selected day for sidebar
  const selectedDay = calendarData[highlightIndex];
  const selectedDayTransactions = selectedDay?.transactions || [];

  return (
    <AbsoluteFill
      style={{
        background: "#101622",
        fontFamily,
      }}
    >
      <div style={{ display: "flex", height: "100%", padding: 32, gap: 24 }}>
        {/* Main Calendar Area */}
        <div style={{ flex: 1 }}>
          {/* Header */}
          <div
            style={{
              marginBottom: 24,
              opacity: headerOpacity,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 20,
              }}
            >
              <div>
                <h1 style={{ fontSize: 28, fontWeight: 800, color: "white", marginBottom: 4 }}>
                  Financial Calendar
                </h1>
                <p style={{ fontSize: 14, color: "#9ca3af" }}>
                  Visualize your cash flow and upcoming transactions.
                </p>
              </div>

              {/* View toggle & Today button */}
              <div style={{ display: "flex", gap: 12 }}>
                <div
                  style={{
                    backgroundColor: "#2d3748",
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontSize: 13,
                    color: "white",
                    fontWeight: 500,
                  }}
                >
                  Today
                </div>
                <div
                  style={{
                    display: "flex",
                    backgroundColor: "#1e273b",
                    borderRadius: 8,
                    padding: 4,
                  }}
                >
                  <div
                    style={{
                      backgroundColor: "#135bec",
                      padding: "6px 14px",
                      borderRadius: 6,
                      fontSize: 13,
                      color: "white",
                      fontWeight: 500,
                    }}
                  >
                    Month
                  </div>
                  <div
                    style={{
                      padding: "6px 14px",
                      fontSize: 13,
                      color: "#9ca3af",
                    }}
                  >
                    Week
                  </div>
                </div>
              </div>
            </div>

            {/* Month Summary - matching MonthSummary component */}
            <div
              style={{
                display: "flex",
                gap: 16,
                marginBottom: 16,
                opacity: summaryOpacity,
              }}
            >
              <div
                style={{
                  backgroundColor: "#151c2c",
                  borderRadius: 10,
                  padding: "12px 20px",
                  border: "1px solid #2d3748",
                  flex: 1,
                }}
              >
                <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>Total Income</p>
                <p style={{ fontSize: 20, fontWeight: 700, color: "#2ecc71" }}>
                  +${monthSummary.income.toLocaleString()}
                </p>
              </div>
              <div
                style={{
                  backgroundColor: "#151c2c",
                  borderRadius: 10,
                  padding: "12px 20px",
                  border: "1px solid #2d3748",
                  flex: 1,
                }}
              >
                <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>Total Expenses</p>
                <p style={{ fontSize: 20, fontWeight: 700, color: "#e74c3c" }}>
                  -${monthSummary.expenses.toLocaleString()}
                </p>
              </div>
              <div
                style={{
                  backgroundColor: "#151c2c",
                  borderRadius: 10,
                  padding: "12px 20px",
                  border: "1px solid #2d3748",
                  flex: 1,
                }}
              >
                <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>Net Flow</p>
                <p style={{ fontSize: 20, fontWeight: 700, color: "#2ecc71" }}>
                  +${monthSummary.net.toLocaleString()}
                </p>
              </div>
              <div
                style={{
                  backgroundColor: "#151c2c",
                  borderRadius: 10,
                  padding: "12px 20px",
                  border: "1px solid #2d3748",
                  flex: 1,
                }}
              >
                <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>Transactions</p>
                <p style={{ fontSize: 20, fontWeight: 700, color: "white" }}>
                  {monthSummary.completed + monthSummary.projected}
                </p>
              </div>
            </div>
          </div>

          {/* Calendar Card */}
          <div
            style={{
              backgroundColor: "#151c2c",
              borderRadius: 12,
              border: "1px solid #2d3748",
              overflow: "hidden",
            }}
          >
            {/* Month Navigation Header */}
            <div
              style={{
                padding: 16,
                borderBottom: "1px solid #2d3748",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: "#1e273b",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#9ca3af",
                  fontSize: 18,
                }}
              >
                ‹
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "white" }}>January 2026</h2>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: "#1e273b",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#9ca3af",
                  fontSize: 18,
                }}
              >
                ›
              </div>
            </div>

            {/* Weekday Headers */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                borderBottom: "1px solid #2d3748",
              }}
            >
              {weekDaysShort.map((day) => (
                <div
                  key={day}
                  style={{
                    padding: "10px 4px",
                    textAlign: "center",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#6c757d",
                  }}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
              }}
            >
              {calendarData.map((day, i) => {
                const { scale, opacity } = getDayAnimation(i);
                const isHighlighted = i === highlightIndex && day.isCurrentMonth;

                return (
                  <div
                    key={i}
                    style={{
                      minHeight: 80,
                      padding: 6,
                      border: "1px solid #2d3748",
                      borderWidth: "0 1px 1px 0",
                      backgroundColor: isHighlighted
                        ? "rgba(19, 91, 236, 0.1)"
                        : day.isCurrentMonth
                          ? "rgba(31, 41, 55, 0.3)"
                          : "rgba(31, 41, 55, 0.1)",
                      transform: `scale(${scale})`,
                      opacity: day.isCurrentMonth ? opacity : opacity * 0.4,
                      position: "relative",
                    }}
                  >
                    {/* Day number and balance */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: day.isToday ? "white" : day.isCurrentMonth ? "white" : "#4b5563",
                          backgroundColor: day.isToday ? "#135bec" : "transparent",
                          width: day.isToday ? 22 : "auto",
                          height: day.isToday ? 22 : "auto",
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {day.day}
                      </span>

                      {day.isCurrentMonth && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 500,
                            color: getStatusColor(day.status),
                          }}
                        >
                          ${Math.round(day.closingBalance).toLocaleString()}
                        </span>
                      )}
                    </div>

                    {/* Transaction chips */}
                    {day.isCurrentMonth && day.transactions.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {day.transactions.slice(0, 2).map((t, ti) => {
                          const colors = getTransactionColor(t.type);
                          return (
                            <div
                              key={ti}
                              style={{
                                fontSize: 9,
                                padding: "2px 6px",
                                borderRadius: 4,
                                backgroundColor: colors.bg,
                                color: colors.text,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {t.name}
                            </div>
                          );
                        })}
                        {day.transactions.length > 2 && (
                          <span style={{ fontSize: 9, color: "#6c757d" }}>
                            +{day.transactions.length - 2} more
                          </span>
                        )}
                      </div>
                    )}

                    {/* Transaction count dots */}
                    {day.isCurrentMonth && day.transactions.length > 0 && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: 4,
                          left: 6,
                          display: "flex",
                          gap: 4,
                        }}
                      >
                        {day.transactions.filter((t) => t.type === "income").length > 0 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <div
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                backgroundColor: "#2ecc71",
                              }}
                            />
                            <span style={{ fontSize: 9, color: "#2ecc71" }}>
                              {day.transactions.filter((t) => t.type === "income").length}
                            </span>
                          </div>
                        )}
                        {day.transactions.filter((t) => t.type === "expense").length > 0 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <div
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                backgroundColor: "#e74c3c",
                              }}
                            />
                            <span style={{ fontSize: 9, color: "#e74c3c" }}>
                              {day.transactions.filter((t) => t.type === "expense").length}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Highlight border */}
                    {isHighlighted && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          border: "2px solid #135bec",
                          borderRadius: 4,
                          pointerEvents: "none",
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div
              style={{
                padding: 12,
                borderTop: "1px solid #2d3748",
                display: "flex",
                gap: 24,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: "#2ecc71",
                  }}
                />
                <span style={{ fontSize: 12, color: "#d1d5db" }}>Income</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: "#e74c3c",
                  }}
                />
                <span style={{ fontSize: 12, color: "#d1d5db" }}>Expense</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    backgroundColor: "#135bec",
                  }}
                />
                <span style={{ fontSize: 12, color: "#d1d5db" }}>Today</span>
              </div>
            </div>
          </div>
        </div>

        {/* Day Detail Sidebar - matching DayDetailSidebar component */}
        <div
          style={{
            width: 320,
            opacity: sidebarOpacity,
          }}
        >
          <div
            style={{
              backgroundColor: "#151c2c",
              borderRadius: 12,
              border: "1px solid #2d3748",
              padding: 20,
              height: "100%",
            }}
          >
            {selectedDay?.isCurrentMonth ? (
              <>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "white", marginBottom: 20 }}>
                  January {selectedDay.day}, 2026
                </h3>

                {/* Day Balance Card */}
                <div
                  style={{
                    backgroundColor: "#1e273b",
                    borderRadius: 10,
                    padding: 16,
                    marginBottom: 20,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>
                        Opening Balance
                      </p>
                      <p style={{ fontSize: 18, fontWeight: 700, color: "white" }}>
                        ${(selectedDay.closingBalance - 500).toLocaleString()}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>
                        Closing Balance
                      </p>
                      <p
                        style={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: getStatusColor(selectedDay.status),
                        }}
                      >
                        ${Math.round(selectedDay.closingBalance).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {/* Status bar */}
                  <div
                    style={{
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: getStatusColor(selectedDay.status),
                      opacity: 0.6,
                    }}
                  />
                </div>

                {/* Transactions */}
                <h4 style={{ fontSize: 14, fontWeight: 600, color: "white", marginBottom: 12 }}>
                  Transactions ({selectedDayTransactions.length})
                </h4>

                {selectedDayTransactions.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {selectedDayTransactions.map((t, i) => {
                      const txOpacity = interpolate(
                        frame - fps * 1.5 - i * 6,
                        [0, fps * 0.2],
                        [0, 1],
                        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                      );
                      const colors = getTransactionColor(t.type);

                      return (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: 12,
                            backgroundColor: "#1e273b",
                            borderRadius: 8,
                            opacity: txOpacity,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: 8,
                                backgroundColor: colors.bg,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 16,
                              }}
                            >
                              {t.type === "income" ? "💰" : "💸"}
                            </div>
                            <div>
                              <p style={{ fontSize: 13, fontWeight: 600, color: "white" }}>
                                {t.name}
                              </p>
                              <p
                                style={{
                                  fontSize: 10,
                                  color: "#9ca3af",
                                  textTransform: "capitalize",
                                }}
                              >
                                {t.status}
                              </p>
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: colors.text,
                            }}
                          >
                            {t.type === "income" ? "+" : "-"}${t.amount.toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    style={{
                      textAlign: "center",
                      padding: 24,
                      color: "#6c757d",
                    }}
                  >
                    <span style={{ fontSize: 32, marginBottom: 8, display: "block" }}>📅</span>
                    <p style={{ fontSize: 13 }}>No transactions on this day</p>
                  </div>
                )}
              </>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "#6c757d",
                }}
              >
                <span style={{ fontSize: 48, marginBottom: 12 }}>📅</span>
                <p style={{ fontSize: 14 }}>Select a day to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
