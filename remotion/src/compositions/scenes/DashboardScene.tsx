import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Manrope";

const { fontFamily } = loadFont();

// =============================================
// DATA - Matching actual FinTrack Dashboard
// =============================================

const periodStats = {
  currentBalance: 12450.0,
  income: 8500.0,
  expenses: 5230.0,
  net: 3270.0,
  completedIncomeCount: 3,
  pendingIncomeCount: 2,
  completedExpenseCount: 8,
  pendingExpenseCount: 5,
};

const healthScore = {
  score: 78,
  grade: "B+",
  color: "#22c55e",
  components: {
    runway: 85,
    savingsRate: 72,
    billPaymentRate: 90,
    balanceTrend: 65,
  },
};

// Cash flow area chart data (matching AreaChart)
const cashFlowData = [
  { day: 1, balance: 10200, label: "1" },
  { day: 3, balance: 10150, label: "3" },
  { day: 5, balance: 12800, label: "5" },
  { day: 8, balance: 12600, label: "8" },
  { day: 10, balance: 11500, label: "10" },
  { day: 12, balance: 11300, label: "12" },
  { day: 15, balance: 14200, label: "15" },
  { day: 18, balance: 13800, label: "18" },
  { day: 20, balance: 13100, label: "20" },
  { day: 23, balance: 12800, label: "23" },
  { day: 25, balance: 15500, label: "25" },
  { day: 28, balance: 14800, label: "28" },
  { day: 30, balance: 12450, label: "30" },
];

// Income vs Expense bar chart data
const incomeExpenseData = [
  { label: "Week 1", income: 4250, expenses: 1200 },
  { label: "Week 2", income: 0, expenses: 1800 },
  { label: "Week 3", income: 4250, expenses: 1500 },
  { label: "Week 4", income: 0, expenses: 730 },
];

// Upcoming transactions
const upcomingTransactions = [
  { name: "Salary", type: "income", amount: 4250, date: "Jan 15", status: "projected" },
  { name: "Rent", type: "expense", amount: 1500, date: "Jan 10", status: "projected" },
  { name: "Netflix", type: "expense", amount: 15.99, date: "Jan 5", status: "projected" },
  { name: "Electric Bill", type: "expense", amount: 120, date: "Jan 12", status: "projected" },
];

export const DashboardScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // =============================================
  // 3D PERSPECTIVE ZOOM-IN CAMERA ANIMATION
  // =============================================

  // Camera starts zoomed out, rotated, then zooms in and straightens
  const cameraProgress = interpolate(
    frame,
    [0, fps * 2, fps * 4, durationInFrames],
    [0, 0.6, 1, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // 3D perspective transforms
  const cameraZ = interpolate(cameraProgress, [0, 0.6, 1], [800, 200, 0]);
  const cameraRotateX = interpolate(cameraProgress, [0, 0.6, 1], [25, 8, 0]);
  const cameraRotateY = interpolate(cameraProgress, [0, 0.6, 1], [-15, -5, 0]);
  const cameraScale = interpolate(cameraProgress, [0, 0.6, 1], [0.7, 0.9, 1]);

  // Parallax effect - elements at different depths
  const getParallaxOffset = (depth: number) => {
    const parallax = interpolate(cameraProgress, [0, 1], [depth * 30, 0]);
    return parallax;
  };

  // Individual element focus animations
  const getElementFocus = (elementIndex: number) => {
    const focusStart = fps * 1.5 + elementIndex * fps * 0.5;
    const focusEnd = focusStart + fps * 1;

    const focusProgress = interpolate(
      frame,
      [focusStart, focusStart + fps * 0.3, focusEnd, focusEnd + fps * 0.3],
      [0, 1, 1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );

    return focusProgress;
  };

  // Staggered element entrance
  const getElementEntrance = (index: number, depth: number = 0) => {
    const delay = fps * 0.2 + index * 4;
    const progress = spring({
      frame: frame - delay,
      fps,
      config: { damping: 20, stiffness: 100 },
    });

    const translateZ = interpolate(progress, [0, 1], [-100 - depth * 50, 0]);
    const opacity = interpolate(progress, [0, 0.5, 1], [0, 0, 1]);
    const scale = interpolate(progress, [0, 1], [0.8, 1]);

    return { translateZ, opacity, scale };
  };

  // Chart animations
  const areaChartProgress = interpolate(frame, [fps * 1.5, fps * 3.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const barChartProgress = interpolate(frame, [fps * 2, fps * 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Health score animation
  const healthProgress = interpolate(frame, [fps * 0.8, fps * 2], [0, healthScore.score], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // =============================================
  // SVG CHART HELPERS
  // =============================================

  // Generate smooth area chart path
  const generateAreaChart = (progress: number) => {
    const width = 480;
    const height = 140;
    const maxVal = 16000;
    const minVal = 9000;

    const visibleCount = Math.ceil(cashFlowData.length * progress);
    const visibleData = cashFlowData.slice(0, visibleCount);

    if (visibleData.length < 2) return { linePath: "", areaPath: "" };

    const points = visibleData.map((d, i) => ({
      x: (i / (cashFlowData.length - 1)) * width,
      y: height - ((d.balance - minVal) / (maxVal - minVal)) * height,
    }));

    // Smooth curve using quadratic bezier
    let linePath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpX = (prev.x + curr.x) / 2;
      linePath += ` Q ${prev.x + (curr.x - prev.x) * 0.5} ${prev.y} ${cpX} ${(prev.y + curr.y) / 2}`;
      if (i === points.length - 1) {
        linePath += ` T ${curr.x} ${curr.y}`;
      }
    }

    // Simple line path for cleaner look
    const simpleLinePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

    // Area fill
    const areaPath = `${simpleLinePath} L ${points[points.length - 1].x} ${height} L 0 ${height} Z`;

    return { linePath: simpleLinePath, areaPath };
  };

  const { linePath: areaLine, areaPath } = generateAreaChart(areaChartProgress);

  // Helper functions
  const getBarColor = (value: number) => {
    if (value >= 60) return "#22c55e";
    if (value >= 30) return "#eab308";
    return "#ef4444";
  };

  // KPI items
  const kpiItems = [
    {
      label: "Current Balance",
      value: `$${periodStats.currentBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      icon: "💳",
      color: "white",
    },
    {
      label: "Total Income",
      value: `+$${periodStats.income.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      icon: "📈",
      color: "#22c55e",
    },
    {
      label: "Total Expenses",
      value: `-$${periodStats.expenses.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      icon: "📉",
      color: "#ef4444",
    },
    {
      label: "Net Flow",
      value: `+$${periodStats.net.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      icon: "💰",
      color: "#22c55e",
    },
  ];

  const healthMetrics = [
    { label: "Cash Runway", value: healthScore.components.runway },
    { label: "Savings Rate", value: healthScore.components.savingsRate },
    { label: "Bill Payments", value: healthScore.components.billPaymentRate },
    { label: "Balance Trend", value: healthScore.components.balanceTrend },
  ];

  return (
    <AbsoluteFill
      style={{
        background: "#101622",
        fontFamily,
        perspective: 2000,
        perspectiveOrigin: "center center",
      }}
    >
      {/* 3D Camera Container */}
      <div
        style={{
          width: "100%",
          height: "100%",
          transformStyle: "preserve-3d",
          transform: `
            translateZ(${-cameraZ}px)
            rotateX(${cameraRotateX}deg)
            rotateY(${cameraRotateY}deg)
            scale(${cameraScale})
          `,
        }}
      >
        {/* Sidebar - Layer 1 (furthest back) */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 220,
            backgroundColor: "#151c2c",
            borderRight: "1px solid #2d3748",
            padding: 18,
            transform: `translateZ(${getParallaxOffset(-2)}px)`,
            opacity: interpolate(getElementEntrance(0, 2).opacity, [0, 1], [0, 1]),
          }}
        >
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: "linear-gradient(135deg, #135bec 0%, #2ecc71 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ fontSize: 16, color: "white" }}>💰</span>
            </div>
            <span style={{ fontSize: 18, fontWeight: 700, color: "white" }}>FinTrack</span>
          </div>

          {/* Nav items */}
          {["Dashboard", "Calendar", "Income", "Expenses", "Transactions", "AI Forecast"].map(
            (item, i) => {
              const isActive = i === 0;
              return (
                <div
                  key={item}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "11px 12px",
                    borderRadius: 8,
                    backgroundColor: isActive ? "rgba(19, 91, 236, 0.15)" : "transparent",
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: isActive ? "#135bec" : "#6c757d",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 13,
                      color: isActive ? "#135bec" : "#9ca3af",
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {item}
                  </span>
                </div>
              );
            }
          )}
        </div>

        {/* Main Content */}
        <div style={{ marginLeft: 220, padding: "28px 36px", height: "100%" }}>
          {/* Header - Layer 2 */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 24,
              transform: `translateZ(${getParallaxOffset(-1)}px)`,
              ...getElementEntrance(1, 1),
            }}
          >
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: "white", marginBottom: 2 }}>
                Dashboard
              </h1>
              <p style={{ fontSize: 13, color: "#9ca3af" }}>
                Financial overview for Jan 1 - Jan 31, 2026
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div
                style={{
                  backgroundColor: "rgba(46, 204, 113, 0.2)",
                  color: "#2ecc71",
                  padding: "7px 14px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span>+</span> Income
              </div>
              <div
                style={{
                  backgroundColor: "rgba(231, 76, 60, 0.2)",
                  color: "#e74c3c",
                  padding: "7px 14px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span>−</span> Expense
              </div>
            </div>
          </div>

          {/* Row 1: KPI Cards + Health Score - Layer 3 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
              marginBottom: 20,
              transform: `translateZ(${getParallaxOffset(0)}px)`,
            }}
          >
            {/* Period Summary */}
            <div
              style={{
                backgroundColor: "#151c2c",
                borderRadius: 12,
                padding: 18,
                border: `2px solid ${getElementFocus(0) > 0.5 ? "#135bec" : "#2d3748"}`,
                boxShadow: getElementFocus(0) > 0.5 ? "0 0 30px rgba(19, 91, 236, 0.3)" : "none",
                ...getElementEntrance(2),
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "white", marginBottom: 14 }}>
                Period Summary
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {kpiItems.map((item, i) => (
                  <div
                    key={item.label}
                    style={{
                      backgroundColor: "#1e273b",
                      borderRadius: 8,
                      padding: 12,
                      border: "1px solid #2d3748",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 500 }}>
                        {item.label}
                      </span>
                      <span style={{ fontSize: 12 }}>{item.icon}</span>
                    </div>
                    <p style={{ fontSize: 16, fontWeight: 700, color: item.color }}>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Financial Health Score */}
            <div
              style={{
                backgroundColor: "#151c2c",
                borderRadius: 12,
                padding: 18,
                border: `2px solid ${getElementFocus(1) > 0.5 ? "#22c55e" : "#2d3748"}`,
                boxShadow: getElementFocus(1) > 0.5 ? "0 0 30px rgba(34, 197, 94, 0.3)" : "none",
                ...getElementEntrance(3),
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
                    Financial Health
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 26, fontWeight: 700, color: "white" }}>
                      {Math.round(healthProgress)}/100
                    </span>
                    <div
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        border: `1px solid ${healthScore.color}`,
                        color: healthScore.color,
                        backgroundColor: `${healthScore.color}20`,
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      Grade {healthScore.grade}
                    </div>
                  </div>
                </div>
                <svg width={55} height={55} viewBox="0 0 55 55">
                  <circle cx={27.5} cy={27.5} r={22} fill="none" stroke="#1f2937" strokeWidth={5} />
                  <circle
                    cx={27.5}
                    cy={27.5}
                    r={22}
                    fill="none"
                    stroke={healthScore.color}
                    strokeWidth={5}
                    strokeDasharray={`${(healthProgress / 100) * 138} 138`}
                    strokeLinecap="round"
                    transform="rotate(-90 27.5 27.5)"
                  />
                  <text x={27.5} y={32} textAnchor="middle" fill={healthScore.color} fontSize={12}>
                    ❤️
                  </text>
                </svg>
              </div>
              <div
                style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
              >
                {healthMetrics.map((m, i) => {
                  const barProgress = interpolate(frame - fps * 1 - i * 6, [0, fps * 0.5], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  });
                  return (
                    <div key={m.label}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 9,
                          color: "#9ca3af",
                          marginBottom: 3,
                        }}
                      >
                        <span>{m.label}</span>
                        <span>{m.value}/100</span>
                      </div>
                      <div
                        style={{
                          height: 5,
                          backgroundColor: "#1f2937",
                          borderRadius: 3,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${m.value * barProgress}%`,
                            backgroundColor: getBarColor(m.value),
                            borderRadius: 3,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Row 2: Cash Flow Chart + Income vs Expenses - Layer 4 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr",
              gap: 20,
              marginBottom: 20,
              transform: `translateZ(${getParallaxOffset(1)}px)`,
            }}
          >
            {/* Projected Cash Flow (Area Chart) */}
            <div
              style={{
                backgroundColor: "#151c2c",
                borderRadius: 12,
                padding: 18,
                border: `2px solid ${getElementFocus(2) > 0.5 ? "#135bec" : "#2d3748"}`,
                boxShadow: getElementFocus(2) > 0.5 ? "0 0 40px rgba(19, 91, 236, 0.4)" : "none",
                ...getElementEntrance(4),
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      backgroundColor: "rgba(19, 91, 236, 0.2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span style={{ fontSize: 14 }}>📊</span>
                  </div>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "white" }}>
                      Projected Cash Flow
                    </h3>
                    <p style={{ fontSize: 10, color: "#9ca3af" }}>Opening to closing balance</p>
                  </div>
                </div>
                <div
                  style={{
                    backgroundColor: "rgba(46, 204, 113, 0.2)",
                    color: "#2ecc71",
                    padding: "5px 10px",
                    borderRadius: 16,
                    fontSize: 12,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  📈 +$2,250 (+22%)
                </div>
              </div>

              {/* Opening/Closing boxes */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    backgroundColor: "rgba(45, 55, 72, 0.5)",
                    borderRadius: 8,
                    padding: 10,
                    border: "1px solid rgba(75, 85, 99, 0.4)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: "#9ca3af" }}>→</span>
                    <span
                      style={{
                        fontSize: 9,
                        color: "#9ca3af",
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      Opening
                    </span>
                  </div>
                  <p style={{ fontSize: 16, fontWeight: 700, color: "white" }}>$10,200</p>
                </div>
                <div
                  style={{
                    backgroundColor: "rgba(45, 55, 72, 0.5)",
                    borderRadius: 8,
                    padding: 10,
                    border: "1px solid rgba(75, 85, 99, 0.4)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: "#9ca3af" }}>←</span>
                    <span
                      style={{
                        fontSize: 9,
                        color: "#9ca3af",
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      Closing
                    </span>
                  </div>
                  <p style={{ fontSize: 16, fontWeight: 700, color: "white" }}>$12,450</p>
                </div>
              </div>

              {/* Area Chart */}
              <svg width={480} height={160} viewBox="0 0 480 160">
                <defs>
                  <linearGradient id="cashFlowGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#135bec" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#135bec" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((r) => (
                  <line
                    key={r}
                    x1={0}
                    y1={140 * r}
                    x2={480}
                    y2={140 * r}
                    stroke="#2d3748"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                ))}
                {/* Area fill */}
                <path d={areaPath} fill="url(#cashFlowGradient)" />
                {/* Line */}
                <path
                  d={areaLine}
                  fill="none"
                  stroke="#135bec"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Data points */}
                {cashFlowData
                  .slice(0, Math.ceil(cashFlowData.length * areaChartProgress))
                  .map((d, i) => (
                    <circle
                      key={i}
                      cx={(i / (cashFlowData.length - 1)) * 480}
                      cy={140 - ((d.balance - 9000) / 7000) * 140}
                      r={4}
                      fill="#135bec"
                      stroke="white"
                      strokeWidth={2}
                    />
                  ))}
                {/* X labels */}
                {cashFlowData
                  .filter((_, i) => i % 3 === 0)
                  .map((d, i) => (
                    <text
                      key={i}
                      x={((i * 3) / (cashFlowData.length - 1)) * 480}
                      y={155}
                      textAnchor="middle"
                      fill="#6c757d"
                      fontSize={10}
                    >
                      {d.label}
                    </text>
                  ))}
              </svg>
            </div>

            {/* Income vs Expenses Bar Chart */}
            <div
              style={{
                backgroundColor: "#151c2c",
                borderRadius: 12,
                padding: 18,
                border: `2px solid ${getElementFocus(3) > 0.5 ? "#22c55e" : "#2d3748"}`,
                boxShadow: getElementFocus(3) > 0.5 ? "0 0 30px rgba(34, 197, 94, 0.3)" : "none",
                ...getElementEntrance(5),
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "white" }}>
                    Income vs Expenses
                  </h3>
                  <span style={{ fontSize: 10, color: "#6c757d" }}>Weekly view</span>
                </div>
              </div>

              {/* Bar Chart */}
              <svg width={200} height={150} viewBox="0 0 200 150">
                {incomeExpenseData.map((d, i) => {
                  const x = i * 50 + 10;
                  const maxVal = 5000;
                  const incomeH = (d.income / maxVal) * 100 * barChartProgress;
                  const expenseH = (d.expenses / maxVal) * 100 * barChartProgress;
                  return (
                    <g key={i}>
                      {/* Income bar */}
                      <rect
                        x={x}
                        y={120 - incomeH}
                        width={18}
                        height={incomeH}
                        fill="#22c55e"
                        rx={3}
                      />
                      {/* Expense bar */}
                      <rect
                        x={x + 20}
                        y={120 - expenseH}
                        width={18}
                        height={expenseH}
                        fill="#ef4444"
                        rx={3}
                      />
                      {/* Label */}
                      <text x={x + 19} y={140} textAnchor="middle" fill="#6c757d" fontSize={9}>
                        {d.label}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Legend */}
              <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div
                    style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: "#22c55e" }}
                  />
                  <span style={{ fontSize: 10, color: "#9ca3af" }}>Income</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div
                    style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: "#ef4444" }}
                  />
                  <span style={{ fontSize: 10, color: "#9ca3af" }}>Expenses</span>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Upcoming Activity - Layer 5 */}
          <div
            style={{
              backgroundColor: "#151c2c",
              borderRadius: 12,
              border: `2px solid ${getElementFocus(4) > 0.5 ? "#9b59b6" : "#2d3748"}`,
              boxShadow: getElementFocus(4) > 0.5 ? "0 0 30px rgba(155, 89, 182, 0.3)" : "none",
              overflow: "hidden",
              transform: `translateZ(${getParallaxOffset(2)}px)`,
              ...getElementEntrance(6),
            }}
          >
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid #2d3748",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "white" }}>Upcoming Activity</h3>
                <span
                  style={{
                    fontSize: 9,
                    color: "#6c757d",
                    backgroundColor: "#2d3748",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  Next 14 days
                </span>
              </div>
            </div>
            <div
              style={{
                padding: 18,
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 12,
              }}
            >
              {upcomingTransactions.map((t, i) => {
                const txProgress = interpolate(frame - fps * 3.5 - i * 5, [0, fps * 0.3], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                });
                return (
                  <div
                    key={t.name}
                    style={{
                      backgroundColor: "#1e273b",
                      borderRadius: 8,
                      padding: 12,
                      border: "1px solid #2d3748",
                      opacity: txProgress,
                      transform: `translateY(${(1 - txProgress) * 20}px)`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          backgroundColor:
                            t.type === "income"
                              ? "rgba(46, 204, 113, 0.2)"
                              : "rgba(231, 76, 60, 0.2)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 14,
                        }}
                      >
                        {t.type === "income" ? "💰" : "💸"}
                      </div>
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "white" }}>{t.name}</p>
                        <p style={{ fontSize: 9, color: "#6c757d" }}>{t.date}</p>
                      </div>
                    </div>
                    <p
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: t.type === "income" ? "#22c55e" : "#ef4444",
                      }}
                    >
                      {t.type === "income" ? "+" : "-"}${t.amount.toLocaleString()}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Vignette overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
