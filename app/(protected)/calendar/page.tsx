import CalendarView from "@/components/pages/CalendarView";
import { MOCK_TRANSACTIONS } from "@/lib/utils/mockData";

export default function CalendarPage() {
  return <CalendarView transactions={MOCK_TRANSACTIONS} />;
}
