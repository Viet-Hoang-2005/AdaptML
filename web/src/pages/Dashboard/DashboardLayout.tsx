import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import { ModelSelectionProvider } from './ModelSelectionContext';

export default function DashboardLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <ModelSelectionProvider>
      <div className="flex h-screen flex-col bg-gray-50 text-gray-900">
        <Header />
        <div className="flex min-h-0 flex-1">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
          />
          <main className="min-w-0 flex-1 overflow-y-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </ModelSelectionProvider>
  );
}
