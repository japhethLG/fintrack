import Forecast from "@/components/pages/Forecast";
import { MOCK_TRANSACTIONS } from "@/lib/utils/mockData";

export default function ForecastPage() {
  return <Forecast transactions={MOCK_TRANSACTIONS} />;
}
