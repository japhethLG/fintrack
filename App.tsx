import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import CalendarView from './pages/CalendarView';
import IncomeManager from './pages/IncomeManager';
import Forecast from './pages/Forecast';
import { MOCK_TRANSACTIONS } from './utils/mockData';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard transactions={MOCK_TRANSACTIONS} />;
      case 'calendar':
        return <CalendarView transactions={MOCK_TRANSACTIONS} />;
      case 'income':
        return <IncomeManager />;
      case 'forecast':
        return <Forecast transactions={MOCK_TRANSACTIONS} />;
      default:
        return <Dashboard transactions={MOCK_TRANSACTIONS} />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#101622] text-white font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 overflow-y-auto relative">
        {/* Grid Background Effect */}
        <div className="absolute inset-0 pointer-events-none opacity-5" style={{
            backgroundImage: 'radial-gradient(#2d3748 1px, transparent 1px)',
            backgroundSize: '24px 24px'
        }}></div>
        
        <div className="relative z-10">
           {renderContent()}
        </div>
      </main>
    </div>
  );
};

export default App;