import { Bell, Bot, BrainCircuit, GitBranch, Home, LineChart, LogOut, Menu, Settings } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface DashboardSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const topItems = [
  { label: 'Home', to: '/dashboard/home/models', icon: Home, match: '/dashboard/home' },
  { label: 'Drift Monitoring', to: '/dashboard/drift-monitoring', icon: LineChart, match: '/dashboard/drift-monitoring' },
  { label: 'Model Training', to: '/dashboard/model-training', icon: BrainCircuit, match: '/dashboard/model-training' },
  { label: 'Model Evolution', to: '/dashboard/model-evolution', icon: GitBranch, match: '/dashboard/model-evolution' },
];

const bottomItems = [
  { label: 'Management', to: '/dashboard/api-management', icon: Bot, match: '/dashboard/api-management' },
  { label: 'Notification', to: '/dashboard/notifications', icon: Bell, match: '/dashboard/notifications' },
  { label: 'Setting', to: '/dashboard/settings/profile', icon: Settings, match: '/dashboard/settings' },
];

export default function Sidebar({ collapsed, onToggle }: DashboardSidebarProps) {
  const location = useLocation();
  const { logout } = useAuth();

  const sidebarWidth = collapsed ? 'w-17' : 'w-56';

  const navClass = (match: string) => {
    const active = location.pathname.startsWith(match);
    return `group flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors ${
      active ? 'bg-black text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
    } ${collapsed ? 'justify-center' : ''}`;
  };

  return (
    <aside className={`${sidebarWidth} flex h-full shrink-0 flex-col border-r border-gray-300 bg-white transition-all`}>
      <div className="flex h-12 gap-1 items-center border-b border-gray-300 p-3">
        <button
          type="button"
          onClick={onToggle}
          className={`flex h-10 items-center justify-center rounded-lg text-gray-500 hover:text-black ${
            collapsed ? 'w-10' : 'w-10 shrink-0'
          }`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Menu className="h-5 w-5" />
        </button>
        {!collapsed && <span className="text-sm font-sans tracking-wide text-gray-400">Workspace</span>}
      </div>

      <nav className="flex flex-1 flex-col justify-between p-3">
        <div className="space-y-1">
          {topItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} className={navClass(item.match)} title={collapsed ? item.label : undefined}>
                <Icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </div>

        <div className="space-y-1 mb-2">
          {bottomItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} className={navClass(item.match)} title={collapsed ? item.label : undefined}>
                <Icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}

          <button
            type="button"
            onClick={logout}
            title={collapsed ? 'Logout' : undefined}
            className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </nav>
    </aside>
  );
}
