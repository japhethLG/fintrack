"use client";

import React from "react";
import { Icon } from "./Icon";
import { cn } from "@/lib/utils/cn";

export interface TableColumn<T = any> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: any, row: T) => React.ReactNode;
  align?: "left" | "center" | "right";
}

export interface TableProps<T = any> {
  columns: TableColumn<T>[];
  data: T[];
  sortable?: boolean;
  className?: string;
  rowClassName?: (row: T, index: number) => string;
  onRowClick?: (row: T, index: number) => void;
}

export const Table = <T extends Record<string, any>>({
  columns,
  data,
  sortable = false,
  className = "",
  rowClassName,
  onRowClick,
}: TableProps<T>) => {
  const [sortColumn, setSortColumn] = React.useState<string | null>(null);
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("asc");

  const handleSort = (columnKey: string) => {
    if (!sortable) return;

    if (sortColumn === columnKey) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(columnKey);
      setSortDirection("asc");
    }
  };

  const sortedData = React.useMemo(() => {
    if (!sortColumn || !sortable) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortColumn];
      const bValue = b[sortColumn];

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, sortColumn, sortDirection, sortable]);

  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-left text-gray-300", className)}>
        <thead className="text-xs text-gray-500 uppercase border-b border-gray-700">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  "px-4 py-3",
                  column.align === "right" && "text-right",
                  column.align === "center" && "text-center",
                  column.sortable &&
                    sortable &&
                    "cursor-pointer hover:text-gray-300 transition-colors"
                )}
                onClick={() => column.sortable && handleSort(column.key)}
              >
                <div className="flex items-center gap-2">
                  {column.label}
                  {column.sortable && sortable && sortColumn === column.key && (
                    <Icon
                      name={sortDirection === "asc" ? "arrow_upward" : "arrow_downward"}
                      size="sm"
                    />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, index) => {
            const customRowClassName = rowClassName ? rowClassName(row, index) : "";
            const rowStyles = cn(
              "border-b border-gray-800 hover:bg-gray-800/50 transition-colors",
              onRowClick && "cursor-pointer",
              customRowClassName
            );

            return (
              <tr
                key={index}
                className={rowStyles}
                onClick={() => onRowClick && onRowClick(row, index)}
              >
                {columns.map((column) => {
                  const value = row[column.key];
                  const cellContent = column.render ? column.render(value, row) : value;

                  return (
                    <td
                      key={column.key}
                      className={cn(
                        "px-4 py-4",
                        column.align === "right" && "text-right",
                        column.align === "center" && "text-center"
                      )}
                    >
                      {cellContent}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
