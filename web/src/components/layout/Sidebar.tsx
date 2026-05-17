import { Bell, BrainCircuit, ChevronLeft, ChevronRight, GitBranch, Home, LineChart, LogOut, Settings, UploadCloud} from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface DashboardSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const topItems = [
  { label: 'Home', to: '/dashboard/home/model-api', icon: Home, match: '/dashboard/home' },
  { label: 'Drift Monitoring', to: '/dashboard/drift-monitoring', icon: LineChart, match: '/dashboard/drift-monitoring' },
  { label: 'Model Training', to: '/dashboard/model-training', icon: BrainCircuit, match: '/dashboard/model-training' },
  { label: 'Model Evolution', to: '/dashboard/model-evolution', icon: GitBranch, match: '/dashboard/model-evolution' },
];

const bottomItems = [
  { label: 'Notification', to: '/dashboard/notifications', icon: Bell, match: '/dashboard/notifications' },
  { label: 'Setting', to: '/dashboard/settings/profile', icon: Settings, match: '/dashboard/settings' },
];

export default function Sidebar({ collapsed, onToggle }: DashboardSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const sidebarWidth = collapsed ? 'w-18' : 'w-60';

  const navClass = (match: string) => {
    const active = location.pathname.startsWith(match);
    return `group flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors ${
      active ? 'bg-black text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
    } ${collapsed ? 'justify-center' : ''}`;
  };

  return (
    <aside className={`${sidebarWidth} flex h-full shrink-0 flex-col border-r border-gray-300 bg-white transition-all`}>
      <div className="flex h-12 items-center justify-between border-b border-gray-100 px-4">
        {!collapsed && <span className="text-sm font-sans tracking-wide text-gray-400">My workspace</span>}
        <button
          type="button"
          onClick={onToggle}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-black"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
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
          {!collapsed && (
            <button
              type="button"
              onClick={() => navigate('/dashboard/home/model-api')}
              className="mb-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:border-black hover:text-black"
            >
              <UploadCloud className="h-4 w-4" />
              Upload Model
            </button>
          )}

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
            className={`flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 ${
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
