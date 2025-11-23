import React from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Cell, PieChart, Pie } from 'recharts';
import { Transaction } from '../types';

interface DashboardProps {
  transactions: Transaction[];
}

const Dashboard: React.FC<DashboardProps> = ({ transactions }) => {
  // Calculate stats
  const income = transactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
  const expenses = transactions.filter(t => ['expense', 'bill', 'loan'].includes(t.type)).reduce((acc, t) => acc + t.amount, 0);
  const balance = 12450 + income - expenses; // Assuming simulated starting balance

  // Prepare chart data (Cash Flow)
  const sortedTransactions = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let runningBalance = 12450;
  const chartData = sortedTransactions.map(t => {
    runningBalance += t.type === 'income' ? t.amount : -t.amount;
    return {
      date: new Date(t.date).getDate(),
      balance: runningBalance,
    };
  });

  // Prepare Pie Chart Data
  const categoryDataMap: Record<string, number> = {};
  transactions
    .filter(t => t.type !== 'income')
    .forEach(t => {
      categoryDataMap[t.category] = (categoryDataMap[t.category] || 0) + t.amount;
    });
  
  const pieData = Object.entries(categoryDataMap).map(([name, value]) => ({ name, value }));
  const COLORS = ['#135bec', '#2ecc71', '#e74c3c', '#f1c40f', '#9b59b6', '#34495e'];

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto animate-fade-in">
      <header className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
          <p className="text-gray-400">Here's your financial overview for October.</p>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-success/20 text-success rounded-lg font-semibold hover:bg-success/30 transition-colors">
            <span className="material-symbols-outlined">add</span> Income
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-danger/20 text-danger rounded-lg font-semibold hover:bg-danger/30 transition-colors">
            <span className="material-symbols-outlined">remove</span> Expense
          </button>
        </div>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-[#1a2336] border border-gray-800 rounded-2xl p-6">
          <p className="text-gray-400 text-sm font-medium mb-2">Current Balance</p>
          <h2 className="text-3xl font-bold text-white">${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</h2>
        </div>
        <div className="bg-[#1a2336] border border-gray-800 rounded-2xl p-6">
          <p className="text-gray-400 text-sm font-medium mb-2">Total Income</p>
          <h2 className="text-3xl font-bold text-success">+${income.toLocaleString('en-US', { minimumFractionDigits: 2 })}</h2>
        </div>
        <div className="bg-[#1a2336] border border-gray-800 rounded-2xl p-6">
          <p className="text-gray-400 text-sm font-medium mb-2">Total Expenses</p>
          <h2 className="text-3xl font-bold text-danger">-${expenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}</h2>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        {/* Main Line Chart */}
        <div className="lg:col-span-2 bg-[#1a2336] border border-gray-800 rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-6">Projected Cash Flow</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#135bec" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#135bec" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" vertical={false} />
                <XAxis dataKey="date" stroke="#6c757d" tickLine={false} axisLine={false} />
                <YAxis stroke="#6c757d" tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#151c2c', borderColor: '#2d3748', borderRadius: '8px', color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Area type="monotone" dataKey="balance" stroke="#135bec" strokeWidth={3} fillOpacity={1} fill="url(#colorBalance)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Donut Chart */}
        <div className="bg-[#1a2336] border border-gray-800 rounded-2xl p-6 flex flex-col">
          <h3 className="text-lg font-bold text-white mb-4">Spending by Category</h3>
          <div className="flex-1 flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height={250}>
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
                <Tooltip contentStyle={{ backgroundColor: '#151c2c', borderColor: '#2d3748', borderRadius: '8px', color: '#fff' }}/>
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
                 <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                 <span className="text-xs text-gray-300">{entry.name}</span>
               </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-[#1a2336] border border-gray-800 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-4">Recent Activity</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-gray-300">
            <thead className="text-xs text-gray-500 uppercase border-b border-gray-700">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.slice(0, 5).map((t) => (
                <tr key={t.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-4 font-medium text-white flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center bg-opacity-10 ${
                      t.type === 'income' ? 'bg-success text-success' : t.type === 'bill' ? 'bg-warning text-warning' : 'bg-danger text-danger'
                    }`}>
                      <span className="material-symbols-outlined text-[18px]">
                        {t.type === 'income' ? 'arrow_downward' : 'arrow_upward'}
                      </span>
                    </div>
                    {t.name}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-400">{new Date(t.date).toLocaleDateString()}</td>
                  <td className="px-4 py-4">
                    <span className="px-2 py-1 rounded text-xs font-medium bg-gray-700 text-gray-300">
                      {t.category}
                    </span>
                  </td>
                  <td className={`px-4 py-4 text-right font-bold ${t.type === 'income' ? 'text-success' : 'text-white'}`}>
                    {t.type === 'income' ? '+' : '-'}${t.amount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
