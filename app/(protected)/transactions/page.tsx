"use client";

import { MOCK_TRANSACTIONS } from "@/lib/utils/mockData";
import { Transaction } from "@/lib/types";
import { Badge, Table, PageHeader, Card, TableColumn, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";

export default function TransactionsPage() {
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
            <Icon
              name={row.type === "income" ? "arrow_downward" : "arrow_upward"}
              size="sm"
            />
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
      key: "type",
      label: "Type",
      render: (value) => <span className="capitalize text-gray-400">{value}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (value) => {
        const variantMap: Record<string, "success" | "warning" | "primary"> = {
          completed: "success",
          pending: "warning",
        };
        return (
          <Badge variant={variantMap[value as string] || "primary"} className="capitalize">
            {value}
          </Badge>
        );
      },
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      render: (value, row) => (
        <span
          className={cn("font-bold", row.type === "income" ? "text-success" : "text-white")}
        >
          {row.type === "income" ? "+" : "-"}${value.toFixed(2)}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto animate-fade-in">
      <PageHeader
        title="Transactions"
        description="View and manage all your transactions"
      />

      <Card padding="md">
        <Table columns={tableColumns} data={MOCK_TRANSACTIONS} />
      </Card>
    </div>
  );
}
