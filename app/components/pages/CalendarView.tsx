import React from "react";
import { Transaction } from "@/lib/types";
import { Button, Card, PageHeader, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";

interface CalendarViewProps {
  transactions: Transaction[];
}

const CalendarView: React.FC<CalendarViewProps> = ({ transactions }) => {
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Group transactions by category/name for rows
  const uniqueSources: string[] = Array.from(new Set(transactions.map((t) => t.name)));

  // Define color by type
  const getTypeColor = (name: string) => {
    const type = transactions.find((t) => t.name === name)?.type;
    switch (type) {
      case "income":
        return "bg-success";
      case "bill":
        return "bg-warning";
      default:
        return "bg-danger";
    }
  };

  const getIcon = (name: string) => {
    const t = transactions.find((t) => t.name === name);
    if (!t) return "circle";
    switch (t.category) {
      case "Salary":
        return "work";
      case "Housing":
        return "home";
      case "Utilities":
        return "bolt";
      case "Groceries":
        return "shopping_cart";
      case "Transport":
        return "directions_car";
      case "Entertainment":
        return "movie";
      default:
        return "paid";
    }
  };

  return (
    <div className="p-6 lg:p-10 h-full flex flex-col animate-fade-in">
      <PageHeader
        title="Financial Matrix"
        description="Visual overview of cash flow across the month (X: Days, Y: Sources)."
        actions={
          <div className="flex items-center gap-4 bg-[#1a2336] p-2 rounded-lg border border-gray-800">
            <Button
              variant="icon"
              size="sm"
              className="p-1 hover:bg-gray-700 rounded"
              icon={<Icon name="chevron_left" className="text-gray-400" />}
            />
            <span className="font-bold text-white">October 2024</span>
            <Button
              variant="icon"
              size="sm"
              className="p-1 hover:bg-gray-700 rounded"
              icon={<Icon name="chevron_right" className="text-gray-400" />}
            />
          </div>
        }
      />

      <Card padding="none" className="flex-1 overflow-hidden flex flex-col">
        {/* Legend */}
        <div className="p-4 border-b border-gray-800 flex gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-success"></div>
            <span className="text-gray-300">Income</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-danger"></div>
            <span className="text-gray-300">Expense</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-warning"></div>
            <span className="text-gray-300">Bill (Pending)</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="min-w-[1200px]">
            {/* Header Row (Days) */}
            <div className="flex border-b border-gray-800 sticky top-0 bg-[#1a2336] z-10">
              <div className="w-60 shrink-0 p-4 font-bold text-gray-400 border-r border-gray-800 sticky left-0 bg-[#1a2336] z-20 shadow-md">
                Category / Name
              </div>
              {days.map((day) => (
                <div
                  key={day}
                  className="flex-1 min-w-[40px] p-2 text-center text-xs text-gray-500 border-r border-gray-800 border-opacity-30"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Data Rows */}
            {uniqueSources.map((source) => (
              <div
                key={source}
                className="flex border-b border-gray-800 hover:bg-[#1e273b] transition-colors"
              >
                <div className="w-60 shrink-0 p-4 border-r border-gray-800 flex items-center gap-3 sticky left-0 bg-[#1a2336] z-10">
                  <Icon name={getIcon(source)} size="lg" className="text-gray-500" />
                  <span className="text-sm font-medium text-gray-200 truncate">{source}</span>
                </div>
                {days.map((day) => {
                  // Find transaction for this source on this day
                  const t = transactions.find(
                    (trans) => trans.name === source && new Date(trans.date).getDate() === day
                  );

                  return (
                    <div
                      key={day}
                      className="flex-1 min-w-[40px] border-r border-gray-800 border-opacity-30 flex items-center justify-center relative group"
                    >
                      {t && (
                        <>
                          <div
                            className={cn(
                              "w-4 h-4 rounded-full cursor-pointer transform transition-transform hover:scale-125",
                              getTypeColor(source)
                            )}
                            title={`$${t.amount} - ${t.status}`}
                          ></div>
                          {/* Tooltip */}
                          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-30">
                            <div className="bg-gray-900 text-white text-xs p-2 rounded shadow-lg whitespace-nowrap border border-gray-700">
                              <p className="font-bold">${t.amount}</p>
                              <p className="text-gray-400 capitalize">{t.status}</p>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default CalendarView;
