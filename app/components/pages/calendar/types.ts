import { DayBalance } from "@/lib/types";

export interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  dayBalance: DayBalance | null;
}
