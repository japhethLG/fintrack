import React from 'react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'calendar', label: 'Financial Calendar', icon: 'calendar_month' },
    { id: 'income', label: 'Income Manager', icon: 'account_balance_wallet' },
    { id: 'forecast', label: 'AI Forecast', icon: 'smart_toy' }, // AI feature
    { id: 'transactions', label: 'Transactions', icon: 'receipt_long' },
  ];

  return (
    <aside className="w-20 lg:w-64 bg-[#151c2c] border-r border-gray-800 flex flex-col transition-all duration-300 shrink-0">
      <div className="h-20 flex items-center justify-center lg:justify-start lg:px-6 border-b border-gray-800 gap-3">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-white">account_balance</span>
        </div>
        <span className="text-white font-bold text-xl hidden lg:block">FinTrack</span>
      </div>

      <nav className="flex-1 py-6 flex flex-col gap-2 px-2 lg:px-4">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex items-center gap-3 p-3 rounded-xl transition-colors duration-200 group ${
              activeTab === item.id
                ? 'bg-primary text-white shadow-lg shadow-primary/20'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-[24px]">{item.icon}</span>
            <span className="font-medium hidden lg:block">{item.label}</span>
            {activeTab === item.id && (
              <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white hidden lg:block"></div>
            )}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-800 cursor-pointer transition-colors">
          <img 
            src="https://picsum.photos/40/40" 
            alt="User" 
            className="w-10 h-10 rounded-full border-2 border-gray-700"
          />
          <div className="hidden lg:block overflow-hidden">
            <p className="text-sm font-bold text-white truncate">Alex User</p>
            <p className="text-xs text-gray-500 truncate">alex@example.com</p>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;