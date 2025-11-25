"use client";

import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import { Transaction } from "@/lib/types";
import { Button, Card, Badge, Table, PageHeader, TableColumn, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";

interface DashboardProps {
  transactions: Transaction[];
}

const Dashboard: React.FC<DashboardProps> = ({ transactions }) => {
  // Calculate stats
  const income = transactions
    .filter((t) => t.type === "income")
    .reduce((acc, t) => acc + t.amount, 0);
  const expenses = transactions
    .filter((t) => ["expense", "bill", "loan"].includes(t.type))
    .reduce((acc, t) => acc + t.amount, 0);
  const balance = 12450 + income - expenses; // Assuming simulated starting balance

  // Prepare chart data (Cash Flow)
  const sortedTransactions = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  let runningBalance = 12450;
  const chartData = sortedTransactions.map((t) => {
    runningBalance += t.type === "income" ? t.amount : -t.amount;
    return {
      date: new Date(t.date).getDate(),
      balance: runningBalance,
    };
  });

  // Prepare Pie Chart Data
  const categoryDataMap: Record<string, number> = {};
  transactions
    .filter((t) => t.type !== "income")
    .forEach((t) => {
      categoryDataMap[t.category] = (categoryDataMap[t.category] || 0) + t.amount;
    });

  const pieData = Object.entries(categoryDataMap).map(([name, value]) => ({ name, value }));
  const COLORS = ["#135bec", "#2ecc71", "#e74c3c", "#f1c40f", "#9b59b6", "#34495e"];

  const tableColumns: TableColumn<Transaction>[] = [
    {
      key: "name",
      label: "Name",
      render: (value, row) => (
        <div className="font-medium text-white flex items-center gap-3">
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center bg-opacity-10",
              row.type === "income" && "bg-success text-success",
              row.type === "bill" && "bg-warning text-warning",
              row.type !== "income" && row.type !== "bill" && "bg-danger text-danger"
            )}
          >
            <Icon name={row.type === "income" ? "arrow_downward" : "arrow_upward"} size="sm" />
          </div>
          {value}
        </div>
      ),
    },
    {
      key: "date",
      label: "Date",
      render: (value) => (
        <span className="text-sm text-gray-400">{new Date(value).toLocaleDateString()}</span>
      ),
    },
    {
      key: "category",
      label: "Category",
      render: (value) => <Badge variant="default">{value}</Badge>,
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      render: (value, row) => (
        <span className={cn("font-bold", row.type === "income" ? "text-success" : "text-white")}>
          {row.type === "income" ? "+" : "-"}${value.toFixed(2)}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto animate-fade-in">
      <PageHeader
        title="Dashboard"
        description="Here's your financial overview for October."
        actions={
          <>
            <Button
              variant="secondary"
              className="bg-success/20 text-success hover:bg-success/30"
              icon={<Icon name="add" />}
              iconPosition="left"
            >
              Income
            </Button>
            <Button variant="danger" icon={<Icon name="remove" />} iconPosition="left">
              Expense
            </Button>
          </>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card padding="md">
          <p className="text-gray-400 text-sm font-medium mb-2">Current Balance</p>
          <h2 className="text-3xl font-bold text-white">
            ${balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </h2>
        </Card>
        <Card padding="md">
          <p className="text-gray-400 text-sm font-medium mb-2">Total Income</p>
          <h2 className="text-3xl font-bold text-success">
            +${income.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </h2>
        </Card>
        <Card padding="md">
          <p className="text-gray-400 text-sm font-medium mb-2">Total Expenses</p>
          <h2 className="text-3xl font-bold text-danger">
            -${expenses.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </h2>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        {/* Main Line Chart */}
        <Card className="lg:col-span-2" padding="md">
          <h3 className="text-lg font-bold text-white mb-6">Projected Cash Flow</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#135bec" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#135bec" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" vertical={false} />
                <XAxis dataKey="date" stroke="#6c757d" tickLine={false} axisLine={false} />
                <YAxis
                  stroke="#6c757d"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${value}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#151c2c",
                    borderColor: "#2d3748",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                  itemStyle={{ color: "#fff" }}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="#135bec"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorBalance)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Donut Chart */}
        <Card padding="md" className="flex flex-col">
          <h3 className="text-lg font-bold text-white mb-4">Spending by Category</h3>
          <div className="flex-1 flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height={250} className="z-10">
              <PieChart>
                <Pie
                  data={pieData}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#fff",
                    borderColor: "#2d3748",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-gray-400 text-xs">Total Spent</span>
              <span className="text-white font-bold text-xl">${expenses.toLocaleString()}</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {pieData.slice(0, 4).map((entry, index) => (
              <div key={entry.name} className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                ></div>
                <span className="text-xs text-gray-300">{entry.name}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card padding="md">
        <h3 className="text-lg font-bold text-white mb-4">Recent Activity</h3>
        <Table columns={tableColumns} data={transactions.slice(0, 5)} />
      </Card>
    </div>
  );
};

export default Dashboard;
