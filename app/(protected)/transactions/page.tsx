import { MOCK_TRANSACTIONS } from "@/lib/utils/mockData";
import { Transaction } from "@/lib/types";

export default function TransactionsPage() {
  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto animate-fade-in">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Transactions</h1>
        <p className="text-gray-400">View and manage all your transactions</p>
      </header>

      <div className="bg-[#1a2336] border border-gray-800 rounded-2xl p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-gray-300">
            <thead className="text-xs text-gray-500 uppercase border-b border-gray-700">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_TRANSACTIONS.map((t: Transaction) => (
                <tr
                  key={t.id}
                  className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
                >
                  <td className="px-4 py-4 font-medium text-white flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center bg-opacity-10 ${
                        t.type === "income"
                          ? "bg-success text-success"
                          : t.type === "bill"
                            ? "bg-warning text-warning"
                            : "bg-danger text-danger"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {t.type === "income" ? "arrow_downward" : "arrow_upward"}
                      </span>
                    </div>
                    {t.name}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-400">
                    {new Date(t.date).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-4">
                    <span className="px-2 py-1 rounded text-xs font-medium bg-gray-700 text-gray-300">
                      {t.category}
                    </span>
                  </td>
                  <td className="px-4 py-4 capitalize text-gray-400">{t.type}</td>
                  <td className="px-4 py-4">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium capitalize ${
                        t.status === "completed"
                          ? "bg-success/20 text-success"
                          : t.status === "pending"
                            ? "bg-warning/20 text-warning"
                            : "bg-primary/20 text-primary"
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-4 text-right font-bold ${t.type === "income" ? "text-success" : "text-white"}`}
                  >
                    {t.type === "income" ? "+" : "-"}${t.amount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
