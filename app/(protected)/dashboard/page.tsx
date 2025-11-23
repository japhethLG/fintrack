import Dashboard from "@/components/pages/Dashboard";
import { MOCK_TRANSACTIONS } from "@/lib/utils/mockData";

export default function DashboardPage() {
  return <Dashboard transactions={MOCK_TRANSACTIONS} />;
}
