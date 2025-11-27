import dayjs from "dayjs";

export const CHART_COLORS = [
  "#135bec", // Blue
  "#2ecc71", // Green
  "#e74c3c", // Red
  "#f1c40f", // Yellow
  "#9b59b6", // Purple
  "#34495e", // Dark Blue
  "#1abc9c", // Teal
  "#e67e22", // Orange
];

export const DASHBOARD_PRESETS = [
  {
    value: "thisWeek",
    label: "This Week",
    range: [dayjs().startOf("week"), dayjs().endOf("week")] as [dayjs.Dayjs, dayjs.Dayjs],
  },
  {
    value: "thisMonth",
    label: "This Month",
    range: [dayjs().startOf("month"), dayjs().endOf("month")] as [dayjs.Dayjs, dayjs.Dayjs],
  },
  {
    value: "last30",
    label: "Last 30 Days",
    range: [dayjs().subtract(30, "day"), dayjs()] as [dayjs.Dayjs, dayjs.Dayjs],
  },
  {
    value: "thisQuarter",
    label: "This Quarter",
    range: [dayjs().startOf("quarter"), dayjs().endOf("quarter")] as [dayjs.Dayjs, dayjs.Dayjs],
  },
  {
    value: "last90",
    label: "Last 90 Days",
    range: [dayjs().subtract(90, "day"), dayjs()] as [dayjs.Dayjs, dayjs.Dayjs],
  },
];
